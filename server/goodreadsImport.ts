import { parse } from "csv-parse";
import { storage } from "./storage";
import { db } from "./db";
import { goodreadsImports } from "@shared/schema";
import { eq } from "drizzle-orm";
import { log } from "./index";
import { embedBook } from "./embeddings";

interface GoodreadsRow {
  "Book Id": string;
  Title: string;
  Author: string;
  "Author l-f": string;
  "Additional Authors": string;
  ISBN: string;
  ISBN13: string;
  "My Rating": string;
  "Average Rating": string;
  Publisher: string;
  Binding: string;
  "Number of Pages": string;
  "Year Published": string;
  "Original Publication Year": string;
  "Date Read": string;
  "Date Added": string;
  Bookshelves: string;
  "Bookshelves with positions": string;
  "Exclusive Shelf": string;
  "My Review": string;
  Spoiler: string;
  "Private Notes": string;
  "Read Count": string;
  "Owned Copies": string;
}

function mapStatus(exclusiveShelf: string): string {
  switch (exclusiveShelf?.trim().toLowerCase()) {
    case "read":
      return "read";
    case "currently-reading":
      return "currently_reading";
    case "to-read":
      return "want_to_read";
    default:
      return "want_to_read";
  }
}

function cleanIsbn(raw: string): string {
  if (!raw) return "";
  return raw.replace(/^="?/, "").replace(/"$/, "").trim();
}

async function queryGoogleBooks(query: string): Promise<any | null> {
  try {
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
    const baseUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=1`;
    const url = apiKey ? `${baseUrl}&key=${apiKey}` : baseUrl;

    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    const item = data.items?.[0];
    if (!item) return null;

    const info = item.volumeInfo || {};
    const identifiers = info.industryIdentifiers || [];
    let coverUrl =
      info.imageLinks?.thumbnail ||
      info.imageLinks?.smallThumbnail ||
      null;
    if (coverUrl) {
      coverUrl = coverUrl
        .replace("http://", "https://")
        .replace("&edge=curl", "");
    }

    return {
      googleBooksId: item.id,
      title: info.title || "Untitled",
      subtitle: info.subtitle || null,
      authors: info.authors || ["Unknown Author"],
      publishedDate: info.publishedDate || null,
      pageCount: info.pageCount || null,
      coverImageUrl: coverUrl,
      description: info.description || null,
      isbn13:
        identifiers.find((i: any) => i.type === "ISBN_13")?.identifier || null,
      isbn10:
        identifiers.find((i: any) => i.type === "ISBN_10")?.identifier || null,
      categories: info.categories || null,
      publisher: info.publisher || null,
      averageRating: info.averageRating?.toString() || null,
      language: info.language || null,
    };
  } catch (err: any) {
    log(`Google Books query error: ${err.message}`);
    return null;
  }
}

async function findBookOnGoogle(
  title: string,
  author: string,
  isbn13: string,
  isbn10: string
): Promise<any | null> {
  if (isbn13) {
    const result = await queryGoogleBooks(`isbn:${isbn13}`);
    if (result) return result;
  }

  if (isbn10) {
    const result = await queryGoogleBooks(`isbn:${isbn10}`);
    if (result) return result;
  }

  if (title) {
    const cleanTitle = title.replace(/\s*\(.*?\)\s*$/, "").trim();
    const query = author
      ? `intitle:${cleanTitle} inauthor:${author}`
      : `intitle:${cleanTitle}`;
    const result = await queryGoogleBooks(query);
    if (result) return result;
  }

  return null;
}

function parseGoodreadsDate(dateStr: string): string | undefined {
  if (!dateStr || !dateStr.trim()) return undefined;
  const cleaned = dateStr.trim().replace(/\//g, "-");
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;
  if (/^\d{4}-\d{2}$/.test(cleaned)) return `${cleaned}-01`;
  return undefined;
}

export async function processGoodreadsImport(
  importId: string,
  userId: string,
  csvContent: string
): Promise<void> {
  await db
    .update(goodreadsImports)
    .set({ status: "processing", startedAt: new Date() })
    .where(eq(goodreadsImports.id, importId));

  try {
    const rows = await new Promise<GoodreadsRow[]>((resolve, reject) => {
      const results: GoodreadsRow[] = [];
      const parser = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true,
      });
      parser.on("data", (row: GoodreadsRow) => results.push(row));
      parser.on("error", reject);
      parser.on("end", () => resolve(results));
    });

    const totalRows = rows.length;
    await db
      .update(goodreadsImports)
      .set({ totalRows })
      .where(eq(goodreadsImports.id, importId));

    log(`Goodreads import ${importId}: processing ${totalRows} rows`);

    let booksMatched = 0;
    let booksUnmatched = 0;
    const unmatchedBooks: Array<{
      title: string;
      author: string;
      isbn: string;
      shelf: string;
      rating: string;
    }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const title = row.Title?.trim();
      const author = row.Author?.trim();
      const isbn13 = cleanIsbn(row.ISBN13);
      const isbn10 = cleanIsbn(row.ISBN);
      const status = mapStatus(row["Exclusive Shelf"]);
      const rating = parseInt(row["My Rating"]) || 0;
      const review = row["My Review"]?.trim() || undefined;
      const dateRead = parseGoodreadsDate(row["Date Read"]);
      const dateAdded = parseGoodreadsDate(row["Date Added"]);

      if (!title) continue;

      try {
        const bookData = await findBookOnGoogle(title, author, isbn13, isbn10);

        if (bookData) {
          const book = await storage.upsertBook({
            googleBooksId: bookData.googleBooksId,
            title: bookData.title,
            subtitle: bookData.subtitle,
            authors: bookData.authors,
            publishedDate: bookData.publishedDate,
            pageCount: bookData.pageCount,
            coverImageUrl: bookData.coverImageUrl,
            description: bookData.description,
            isbn13: bookData.isbn13 || isbn13 || undefined,
            isbn10: bookData.isbn10 || isbn10 || undefined,
            categories: bookData.categories,
            publisher: bookData.publisher,
            averageRating: bookData.averageRating,
            language: bookData.language,
          });

          try {
            await storage.addUserBook({
              userId,
              bookId: book.id,
              status,
              source: "goodreads",
              userRating: rating > 0 ? rating.toString() : undefined,
              userReview: review,
              startDate:
                status === "read" && dateRead ? dateRead : undefined,
              finishDate:
                status === "read" && dateRead ? dateRead : undefined,
            });
          } catch (dupErr: any) {
            if (
              dupErr.message?.includes("duplicate") ||
              dupErr.code === "23505"
            ) {
            } else {
              throw dupErr;
            }
          }

          booksMatched++;

          embedBook(book.id).catch(() => {});
        } else {
          booksUnmatched++;
          unmatchedBooks.push({
            title,
            author: author || "",
            isbn: isbn13 || isbn10 || "",
            shelf: row["Exclusive Shelf"] || "",
            rating: row["My Rating"] || "0",
          });
        }
      } catch (rowErr: any) {
        log(`Import row error for "${title}": ${rowErr.message}`);
        booksUnmatched++;
        unmatchedBooks.push({
          title,
          author: author || "",
          isbn: isbn13 || isbn10 || "",
          shelf: row["Exclusive Shelf"] || "",
          rating: row["My Rating"] || "0",
        });
      }

      if ((i + 1) % 10 === 0 || i === rows.length - 1) {
        await db
          .update(goodreadsImports)
          .set({ booksMatched, booksUnmatched })
          .where(eq(goodreadsImports.id, importId));
      }

      if ((i + 1) % 5 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    await db
      .update(goodreadsImports)
      .set({
        status: "completed",
        booksMatched,
        booksUnmatched,
        unmatchedData: unmatchedBooks.length > 0 ? unmatchedBooks : null,
        completedAt: new Date(),
      })
      .where(eq(goodreadsImports.id, importId));

    log(
      `Goodreads import ${importId} completed: ${booksMatched} matched, ${booksUnmatched} unmatched`
    );
  } catch (err: any) {
    log(`Goodreads import ${importId} failed: ${err.message}`);
    await db
      .update(goodreadsImports)
      .set({
        status: "failed",
        errorMessage: err.message,
        completedAt: new Date(),
      })
      .where(eq(goodreadsImports.id, importId));
  }
}
