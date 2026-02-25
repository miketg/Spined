import OpenAI from "openai";
import { db } from "./db";
import { books, recommendations } from "@shared/schema";
import { eq, desc, inArray } from "drizzle-orm";
import { findSimilarToMultiple } from "./embeddings";
import { storage } from "./storage";
import { log } from "./index";
import type { Book, UserBookWithBook, RecommendationWithBook } from "@shared/schema";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface RecommendationResult {
  googleBooksId: string;
  title: string;
  author: string;
  reason: string;
  relevanceScore: number;
}

export async function generateRecommendations(
  userId: string,
  forceRefresh = false
): Promise<RecommendationWithBook[]> {
  if (!forceRefresh) {
    const cached = await getCachedRecommendations(userId);
    if (cached.length > 0) return cached;
  }

  const userLibrary = await storage.getUserBooks(userId);
  if (userLibrary.length === 0) {
    return [];
  }

  const seedBooks = userLibrary
    .filter((ub) => {
      const rating = parseFloat(ub.userRating?.toString() || "0");
      return rating >= 4 || ub.isFavorite || ub.status === "read";
    })
    .sort((a, b) => {
      const ratingA = parseFloat(a.userRating?.toString() || "0");
      const ratingB = parseFloat(b.userRating?.toString() || "0");
      return ratingB - ratingA;
    })
    .slice(0, 15);

  if (seedBooks.length === 0) {
    seedBooks.push(...userLibrary.slice(0, 5));
  }

  const seedBookIds = seedBooks.map((ub) => ub.bookId);
  const allLibraryBookIds = userLibrary.map((ub) => ub.bookId);

  const candidates = await findSimilarToMultiple(seedBookIds, 30, allLibraryBookIds);

  if (candidates.length === 0) {
    return [];
  }

  const candidateIds = candidates.map((c) => c.id);
  const candidateBooks = await db
    .select()
    .from(books)
    .where(inArray(books.id, candidateIds));

  const candidateMap = new Map(candidateBooks.map((b) => [b.id, b]));

  const rankedResults = await openaiRerank(seedBooks, candidates, candidateMap, userLibrary);

  await db.delete(recommendations).where(eq(recommendations.userId, userId));

  if (rankedResults.length > 0) {
    const recRows = rankedResults.map((r) => {
      const candidateBook = candidateBooks.find(
        (b) => b.googleBooksId === r.googleBooksId || b.title.toLowerCase() === r.title.toLowerCase()
      );
      return {
        userId,
        bookId: candidateBook?.id || candidateIds[0],
        googleBooksId: r.googleBooksId,
        reason: r.reason,
        relevanceScore: r.relevanceScore,
        sourceBookIds: seedBookIds.slice(0, 5),
      };
    }).filter((r) => r.bookId);

    if (recRows.length > 0) {
      await db.insert(recommendations).values(recRows);
    }
  }

  return getCachedRecommendations(userId);
}

async function getCachedRecommendations(userId: string): Promise<RecommendationWithBook[]> {
  const recs = await db
    .select()
    .from(recommendations)
    .innerJoin(books, eq(recommendations.bookId, books.id))
    .where(eq(recommendations.userId, userId))
    .orderBy(desc(recommendations.relevanceScore));

  return recs.map((r) => ({
    ...r.recommendations,
    book: r.books,
  }));
}

async function openaiRerank(
  seedBooks: UserBookWithBook[],
  candidates: Array<{ id: string; title: string; similarity: number }>,
  candidateMap: Map<string, Book>,
  fullLibrary: UserBookWithBook[]
): Promise<RecommendationResult[]> {
  const topRated = seedBooks
    .slice(0, 10)
    .map((ub) => {
      const rating = ub.userRating ? `${ub.userRating}/5` : "unrated";
      return `- "${ub.book.title}" by ${ub.book.authors?.join(", ")} (${rating})`;
    })
    .join("\n");

  const genreCounts = new Map<string, number>();
  for (const ub of fullLibrary) {
    for (const cat of ub.book.categories || []) {
      genreCounts.set(cat, (genreCounts.get(cat) || 0) + 1);
    }
  }
  const topGenres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([genre]) => genre)
    .join(", ");

  const candidateList = candidates
    .map((c) => {
      const book = candidateMap.get(c.id);
      if (!book) return null;
      return `- "${book.title}" by ${book.authors?.join(", ")} | Categories: ${book.categories?.join(", ") || "N/A"} | Pages: ${book.pageCount || "?"} | Google Books ID: ${book.googleBooksId} | Similarity: ${(c.similarity * 100).toFixed(0)}%`;
    })
    .filter(Boolean)
    .join("\n");

  const prompt = `You are a literary recommendation expert. Based on a reader's library and preferences, select and rank the best 10-15 books from the candidates below.

## Reader's Top-Rated Books:
${topRated}

## Reader's Preferred Genres:
${topGenres || "Varied"}

## Library Size: ${fullLibrary.length} books

## Candidate Books (from vector similarity search):
${candidateList}

## Instructions:
1. Select the 10-15 BEST candidates for this specific reader
2. Rank them by relevance (most relevant first)
3. Write a 1-2 sentence personalized explanation for each, referencing specific books from their library
4. Assign a relevance score (1-100) to each

Respond ONLY with a JSON array, no other text. Each element:
{
  "googleBooksId": "the Google Books ID from the candidate list",
  "title": "Book Title",
  "author": "Author Name",
  "reason": "Because you loved [specific book], you'll enjoy this for [specific reason]...",
  "relevanceScore": 85
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const text = response.choices[0]?.message?.content || "[]";
    const parsed = JSON.parse(text);
    const results: RecommendationResult[] = Array.isArray(parsed) ? parsed : parsed.recommendations || parsed.books || [];

    return results
      .filter((r) => r.googleBooksId && r.reason && r.relevanceScore)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  } catch (err: any) {
    log(`OpenAI recommendation error: ${err.message}`);
    return candidates.slice(0, 10).map((c) => {
      const book = candidateMap.get(c.id);
      return {
        googleBooksId: book?.googleBooksId || "",
        title: book?.title || c.title,
        author: book?.authors?.join(", ") || "Unknown",
        reason: "Recommended based on similarity to books in your library.",
        relevanceScore: Math.round(c.similarity * 100),
      };
    }).filter((r) => r.googleBooksId);
  }
}
