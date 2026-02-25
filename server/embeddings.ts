import OpenAI from "openai";
import { db } from "./db";
import { books } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { log } from "./index";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildBookText(book: {
  title: string;
  authors: string[];
  description?: string | null;
  categories?: string[] | null;
  subtitle?: string | null;
}): string {
  const parts: string[] = [
    book.title,
    book.subtitle || "",
    `by ${book.authors.join(", ")}`,
    book.categories?.join(", ") || "",
    (book.description || "").replace(/<[^>]*>/g, "").slice(0, 500),
  ];
  return parts.filter(Boolean).join(". ");
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

export async function embedBook(bookId: string): Promise<boolean> {
  const [book] = await db.select().from(books).where(eq(books.id, bookId));
  if (!book) return false;

  const [existing] = await db.execute(
    sql`SELECT embedding IS NOT NULL as has_embedding FROM books WHERE id = ${bookId}`
  );
  if ((existing as any)?.has_embedding) return false;

  const text = buildBookText(book);
  try {
    const embedding = await generateEmbedding(text);
    await db.execute(
      sql`UPDATE books SET embedding = ${JSON.stringify(embedding)}::vector WHERE id = ${bookId}`
    );
    return true;
  } catch (err: any) {
    log(`Embedding generation failed for book ${bookId}: ${err.message}`);
    return false;
  }
}

export async function embedMissingBooks(): Promise<number> {
  const unembedded = await db.execute(
    sql`SELECT id FROM books WHERE embedding IS NULL LIMIT 100`
  );

  const rows = unembedded.rows as Array<{ id: string }>;
  if (rows.length === 0) return 0;

  let count = 0;
  for (let i = 0; i < rows.length; i += 20) {
    const batch = rows.slice(i, i + 20);
    const results = await Promise.all(batch.map((r) => embedBook(r.id)));
    count += results.filter(Boolean).length;
  }

  log(`Embedded ${count} books (${rows.length} checked)`);
  return count;
}

export async function findSimilarBooks(
  bookId: string,
  limit = 5,
  excludeBookIds: string[] = []
): Promise<Array<{ id: string; title: string; similarity: number }>> {
  const excludeList = [bookId, ...excludeBookIds];
  const excludePlaceholders = excludeList.map((id) => `'${id}'`).join(",");

  const result = await db.execute(sql`
    SELECT b.id, b.title, 
           1 - (b.embedding <=> (SELECT embedding FROM books WHERE id = ${bookId})) as similarity
    FROM books b
    WHERE b.embedding IS NOT NULL
      AND b.id NOT IN (${sql.raw(excludePlaceholders)})
      AND (SELECT embedding FROM books WHERE id = ${bookId}) IS NOT NULL
    ORDER BY b.embedding <=> (SELECT embedding FROM books WHERE id = ${bookId})
    LIMIT ${limit}
  `);

  return (result.rows as any[]).map((r) => ({
    id: r.id,
    title: r.title,
    similarity: parseFloat(r.similarity) || 0,
  }));
}

export async function findSimilarToMultiple(
  bookIds: string[],
  limit = 30,
  excludeBookIds: string[] = []
): Promise<Array<{ id: string; title: string; similarity: number }>> {
  if (bookIds.length === 0) return [];

  const bookIdList = bookIds.map((id) => `'${id}'`).join(",");
  const excludeList = [...bookIds, ...excludeBookIds].map((id) => `'${id}'`).join(",");

  const result = await db.execute(sql`
    WITH avg_embedding AS (
      SELECT AVG(embedding) as embedding
      FROM books
      WHERE id IN (${sql.raw(bookIdList)}) AND embedding IS NOT NULL
    )
    SELECT b.id, b.title,
           1 - (b.embedding <=> (SELECT embedding FROM avg_embedding)) as similarity
    FROM books b, avg_embedding ae
    WHERE b.embedding IS NOT NULL
      AND b.id NOT IN (${sql.raw(excludeList)})
      AND ae.embedding IS NOT NULL
    ORDER BY b.embedding <=> ae.embedding
    LIMIT ${limit}
  `);

  return (result.rows as any[]).map((r) => ({
    id: r.id,
    title: r.title,
    similarity: parseFloat(r.similarity) || 0,
  }));
}
