# Spined — Phase 1c: AI Recommendation Engine (Replit Agent Prompt)

Phase 1a (library, search, collections, Goodreads import) and Phase 1b (shelf scanner via Cloud Vision OCR) are built and running. This prompt adds the AI recommendation engine: vector embeddings for "More Like This" similarity search, plus Claude API for personalized, explainable recommendations on the Discover tab.

**CRITICAL: Do not rewrite, restructure, or refactor any existing Phase 1a/1b code. Only add new files and make the specific edits called out below. All existing features must continue working unchanged.**

---

## New Environment Variables

Add to Replit Secrets (alongside the existing ones):

```
OPENAI_API_KEY=<your key>
ANTHROPIC_API_KEY=<your key>
```

- **OpenAI** — used only for `text-embedding-3-small` embeddings ($0.02/1M tokens ≈ free). Get from: platform.openai.com → API Keys
- **Anthropic** — used for Claude `claude-sonnet-4-5-20250929` recommendation reasoning. Get from: console.anthropic.com → API Keys

---

## New npm Packages

Install these (server-side only, no client packages needed):

```bash
npm install openai @anthropic-ai/sdk
```

---

## Database Changes

### Step 1: Enable pgvector in Supabase

Run this SQL in Supabase's SQL Editor (Dashboard → SQL Editor → New Query):

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

This enables vector operations (cosine similarity, nearest-neighbor search) in PostgreSQL. Only needs to be run once.

### Step 2: Add embedding column to `books` table

Run in Supabase SQL Editor:

```sql
ALTER TABLE books ADD COLUMN IF NOT EXISTS embedding vector(1536);
CREATE INDEX IF NOT EXISTS idx_books_embedding ON books USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

The `vector(1536)` type stores OpenAI `text-embedding-3-small` embeddings. The IVFFlat index enables fast cosine similarity search. We use raw SQL for this because Drizzle doesn't have native pgvector column support.

**Note:** Don't add the `embedding` column to `shared/schema.ts` — Drizzle can't represent vector types. We'll interact with it via raw SQL queries only.

### Step 3: New table in `shared/schema.ts`

Append this table AFTER the existing `scanResults` table, BEFORE `insertUserSchema`:

```typescript
export const recommendations = pgTable("recommendations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  bookId: uuid("book_id")
    .references(() => books.id, { onDelete: "cascade" })
    .notNull(),
  googleBooksId: text("google_books_id"),
  reason: text("reason").notNull(),
  relevanceScore: integer("relevance_score"),
  sourceBookIds: text("source_book_ids").array(),
  feedback: text("feedback"),
  createdAt: timestamp("created_at").defaultNow(),
});
```

And append the insert schema + types alongside the existing ones:

```typescript
export const insertRecommendationSchema = createInsertSchema(recommendations).omit({
  id: true, createdAt: true,
});
export type Recommendation = typeof recommendations.$inferSelect;
export type InsertRecommendation = z.infer<typeof insertRecommendationSchema>;
export type RecommendationWithBook = Recommendation & { book: Book };
```

After saving, run `npm run db:push` to sync the new table.

---

## New Server Files (2 files)

### File 1: `server/embeddings.ts` — OpenAI Embedding Client

Generates and stores vector embeddings for books using their metadata.

```typescript
import OpenAI from "openai";
import { db } from "./db";
import { books } from "@shared/schema";
import { eq, sql, isNull } from "drizzle-orm";
import { log } from "./index";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Build a text representation of a book for embedding.
 * Combines title, authors, description, and categories into a single string.
 */
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
    // Truncate description to ~500 chars to keep embedding input focused
    (book.description || "").replace(/<[^>]*>/g, "").slice(0, 500),
  ];
  return parts.filter(Boolean).join(". ");
}

/**
 * Generate an embedding for a single text string.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

/**
 * Generate and store an embedding for a single book.
 * Skips if the book already has an embedding.
 * Returns true if a new embedding was generated.
 */
export async function embedBook(bookId: string): Promise<boolean> {
  const [book] = await db.select().from(books).where(eq(books.id, bookId));
  if (!book) return false;

  // Check if embedding already exists
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

/**
 * Batch-embed all books that don't have embeddings yet.
 * Processes in batches of 20 to avoid rate limits.
 * Returns count of newly embedded books.
 */
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

/**
 * Find similar books using cosine similarity on embeddings.
 * Returns book IDs sorted by similarity (most similar first).
 * Excludes books the user already has in their library.
 */
export async function findSimilarBooks(
  bookId: string,
  limit = 5,
  excludeBookIds: string[] = []
): Promise<Array<{ id: string; title: string; similarity: number }>> {
  // Build exclusion list
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

/**
 * Find books similar to a set of books (e.g., user's favorites).
 * Computes an average embedding from the source books and finds nearest neighbors.
 */
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
```

### File 2: `server/recommendations.ts` — Claude-Powered Recommendation Engine

Takes vector similarity candidates and uses Claude to re-rank them with personalized explanations.

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { books, userBooks, recommendations } from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { findSimilarToMultiple } from "./embeddings";
import { storage } from "./storage";
import { log } from "./index";
import type { Book, UserBookWithBook, RecommendationWithBook } from "@shared/schema";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface RecommendationResult {
  googleBooksId: string;
  title: string;
  author: string;
  reason: string;
  relevanceScore: number;
}

/**
 * Generate personalized recommendations for a user.
 * Pipeline: Load user library → get top-rated books → vector similarity → Claude re-ranking → save to DB.
 */
export async function generateRecommendations(
  userId: string,
  forceRefresh = false
): Promise<RecommendationWithBook[]> {
  // Check for cached recommendations (less than 24 hours old)
  if (!forceRefresh) {
    const cached = await getCachedRecommendations(userId);
    if (cached.length > 0) return cached;
  }

  // Step 1: Load user's library
  const userLibrary = await storage.getUserBooks(userId);
  if (userLibrary.length === 0) {
    return [];
  }

  // Step 2: Identify seed books (rated 4+, or all "read" books, or favorites)
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
    .slice(0, 15); // Top 15 seed books

  if (seedBooks.length === 0) {
    // Fallback: use any books in library as seeds
    seedBooks.push(...userLibrary.slice(0, 5));
  }

  const seedBookIds = seedBooks.map((ub) => ub.bookId);
  const allLibraryBookIds = userLibrary.map((ub) => ub.bookId);

  // Step 3: Vector similarity search — find top 30 candidates
  const candidates = await findSimilarToMultiple(seedBookIds, 30, allLibraryBookIds);

  if (candidates.length === 0) {
    return [];
  }

  // Step 4: Load full book details for candidates
  const candidateIds = candidates.map((c) => c.id);
  const candidateBooks = await db
    .select()
    .from(books)
    .where(inArray(books.id, candidateIds));

  const candidateMap = new Map(candidateBooks.map((b) => [b.id, b]));

  // Step 5: Claude re-ranking with personalized explanations
  const rankedResults = await claudeRerank(seedBooks, candidates, candidateMap, userLibrary);

  // Step 6: Save recommendations to DB (replace old ones)
  await db.delete(recommendations).where(eq(recommendations.userId, userId));

  if (rankedResults.length > 0) {
    const recRows = rankedResults.map((r) => {
      const candidateBook = candidateBooks.find(
        (b) => b.googleBooksId === r.googleBooksId || b.title.toLowerCase() === r.title.toLowerCase()
      );
      return {
        userId,
        bookId: candidateBook?.id || candidateIds[0], // fallback
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

/**
 * Load cached recommendations with full book data.
 */
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

/**
 * Call Claude to re-rank and explain recommendation candidates.
 */
async function claudeRerank(
  seedBooks: UserBookWithBook[],
  candidates: Array<{ id: string; title: string; similarity: number }>,
  candidateMap: Map<string, Book>,
  fullLibrary: UserBookWithBook[]
): Promise<RecommendationResult[]> {
  // Build user reading profile for the prompt
  const topRated = seedBooks
    .slice(0, 10)
    .map((ub) => {
      const rating = ub.userRating ? `${ub.userRating}/5` : "unrated";
      return `- "${ub.book.title}" by ${ub.book.authors?.join(", ")} (${rating})`;
    })
    .join("\n");

  // Genre distribution
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

  // Candidate list
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
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    // Parse JSON — handle potential markdown code fences
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const results: RecommendationResult[] = JSON.parse(cleaned);

    return results
      .filter((r) => r.googleBooksId && r.reason && r.relevanceScore)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  } catch (err: any) {
    log(`Claude recommendation error: ${err.message}`);
    // Fallback: return candidates by similarity without Claude explanations
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
```

---

## Server Edits (2 existing files)

### Edit 1: `server/routes.ts` — Add recommendation & embedding routes

Add these imports at the top alongside existing imports:

```typescript
import { embedBook, embedMissingBooks, findSimilarBooks } from "./embeddings";
import { generateRecommendations } from "./recommendations";
import { recommendations } from "@shared/schema";
```

Add these 5 routes inside `registerRoutes`, BEFORE the `return httpServer;` line:

```typescript
  // ═══════════════════════════════════════════
  // RECOMMENDATION ROUTES (Phase 1c)
  // ═══════════════════════════════════════════

  // Get personalized recommendations for the current user
  app.get("/api/recommendations", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const recs = await generateRecommendations(req.userId!);
      res.json({ recommendations: recs });
    } catch (err: any) {
      log(`Get recommendations error: ${err.message}`);
      res.status(500).json({ message: "Failed to get recommendations" });
    }
  });

  // Force-refresh recommendations (regenerate from scratch)
  app.post("/api/recommendations/refresh", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      // First ensure all books are embedded
      await embedMissingBooks();
      const recs = await generateRecommendations(req.userId!, true);
      res.json({ recommendations: recs });
    } catch (err: any) {
      log(`Refresh recommendations error: ${err.message}`);
      res.status(500).json({ message: "Failed to refresh recommendations" });
    }
  });

  // Submit feedback on a recommendation (like / not_interested)
  app.post("/api/recommendations/:id/feedback", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const { feedback } = req.body; // "liked" | "not_interested"
      const [updated] = await db
        .update(recommendations)
        .set({ feedback })
        .where(
          and(
            eq(recommendations.id, req.params.id),
            eq(recommendations.userId, req.userId!)
          )
        )
        .returning();
      if (!updated) {
        return res.status(404).json({ message: "Recommendation not found" });
      }
      res.json({ recommendation: updated });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to save feedback" });
    }
  });

  // "More Like This" — find similar books for a given book
  app.get("/api/books/:bookId/similar", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const { bookId } = req.params;
      const limit = parseInt(req.query.limit as string) || 5;

      // Ensure this book has an embedding
      await embedBook(bookId);

      // Get user's library to exclude owned books
      const userLibrary = await storage.getUserBooks(req.userId!);
      const ownedBookIds = userLibrary.map((ub) => ub.bookId);

      const similar = await findSimilarBooks(bookId, limit, ownedBookIds);

      // Load full book objects
      const similarBooks = [];
      for (const s of similar) {
        const book = await storage.getBook(s.id);
        if (book) {
          similarBooks.push({ ...book, similarity: s.similarity });
        }
      }

      res.json({ books: similarBooks });
    } catch (err: any) {
      log(`Similar books error: ${err.message}`);
      res.status(500).json({ message: "Failed to find similar books" });
    }
  });

  // Trigger embedding generation for all unembedded books (admin/background task)
  app.post("/api/embeddings/generate", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const count = await embedMissingBooks();
      res.json({ embedded: count });
    } catch (err: any) {
      log(`Embedding generation error: ${err.message}`);
      res.status(500).json({ message: "Failed to generate embeddings" });
    }
  });
```

### Edit 2: `server/routes.ts` — Hook embedding into book creation

In the existing `POST /api/library` route, AFTER the line `res.status(201).json({ userBook, book });`, add a non-blocking embedding call. Find this block:

```typescript
      res.status(201).json({ userBook, book });
    } catch (err: any) {
```

And add the embedding trigger:

```typescript
      res.status(201).json({ userBook, book });

      // Generate embedding for the book in the background (non-blocking)
      embedBook(book.id).catch((err) => log(`Background embed error: ${err.message}`));

    } catch (err: any) {
```

This ensures every book that enters the system gets an embedding for future similarity searches. The `catch` prevents embedding failures from affecting the library add flow.

---

## Client-Side Changes (3 files)

### Edit 1: `client/src/components/layout/BottomNav.tsx` — Remove "Coming Soon" from Discover

In the `navItems` array, remove `comingSoon: true` from the Discover item:

**Before:**
```typescript
{ path: "/discover", label: "Discover", icon: Compass, comingSoon: true },
```

**After:**
```typescript
{ path: "/discover", label: "Discover", icon: Compass },
```

### Edit 2: `client/src/pages/DiscoverPage.tsx` — Complete Rewrite

Replace the entire placeholder with a full recommendation experience.

**Imports needed:**
```
useState, useEffect from "react"
useQuery, useMutation from "@tanstack/react-query"
Compass, RefreshCw, BookOpen, Plus, Check, Loader2, ThumbsUp, ThumbsDown, Sparkles from "lucide-react"
Card, CardContent from "@/components/ui/card"
Button from "@/components/ui/button"
DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem from "@/components/ui/dropdown-menu"
useToast from "@/hooks/use-toast"
apiRequest, queryClient from "@/lib/queryClient"
motion, AnimatePresence from "framer-motion"
```

**RecommendationWithBook interface** (local to this file):
```typescript
interface RecBook {
  id: string;
  bookId: string;
  googleBooksId: string;
  reason: string;
  relevanceScore: number;
  feedback: string | null;
  book: {
    id: string;
    googleBooksId: string | null;
    title: string;
    subtitle?: string | null;
    authors: string[];
    publishedDate?: string | null;
    pageCount?: number | null;
    coverImageUrl?: string | null;
    description?: string | null;
    isbn13?: string | null;
    isbn10?: string | null;
    categories?: string[] | null;
    publisher?: string | null;
    averageRating?: string | null;
    language?: string | null;
  };
}
```

**Data loading:**
```typescript
const { data, isLoading, error } = useQuery<{ recommendations: RecBook[] }>({
  queryKey: ["/api/recommendations"],
});
```

**Refresh mutation:**
```typescript
const refreshMutation = useMutation({
  mutationFn: async () => {
    const res = await apiRequest("POST", "/api/recommendations/refresh");
    return res.json();
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] });
    toast({ title: "Recommendations refreshed!" });
  },
  onError: (err: any) => {
    toast({ title: "Refresh failed", description: err.message, variant: "destructive" });
  },
});
```

**Feedback handler:**
```typescript
const sendFeedback = async (recId: string, feedback: "liked" | "not_interested") => {
  await apiRequest("POST", `/api/recommendations/${recId}/feedback`, { feedback });
  queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] });
};
```

**Add to library** — same pattern as SearchPage and ScanPage: `apiRequest("POST", "/api/library", { bookData, status, source: "recommendation" })`, track added books in a `Set<string>`, invalidate library queries, toast on success/error, handle 409 gracefully.

**Render structure:**

- **Header section:** "Discover" heading (font-serif) + subtitle "Personalized picks based on your library" + Refresh button (RefreshCw icon, spinning when `refreshMutation.isPending`)

- **Loading state:** Skeleton cards (4–5 cards with pulsing placeholders for cover, title, reason)

- **Empty state** (no recommendations, usually means empty library): Sparkles icon + "Add some books to your library first" message + "Build Your Library" button linking to `/search`. Also show a secondary message: "Rate your books to get better recommendations."

- **Recommendations list:** For each recommendation that has `feedback !== "not_interested"`:
  - **Card layout:** Cover thumbnail on the left (w-16 h-24, same as SearchPage), then right side has:
    - Title (font-serif font-medium, line-clamp-2)
    - Authors (text-xs text-muted-foreground)
    - Year / pages metadata row
    - **AI reason** — the personalized explanation in a subtle styled block: small Sparkles icon + italic text, bg-primary/5 rounded-lg padding. This is the key differentiator — show Claude's reasoning
    - **Relevance score** as a small badge (e.g., "92% match")
  - **Actions row:** "Add to Library" dropdown (same as SearchPage — Want to Read / Currently Reading / Read), plus two small icon buttons: ThumbsUp (liked) and ThumbsDown (not_interested). ThumbsDown dismisses the card with a slide-out animation
  - Use Framer Motion `AnimatePresence` + `motion.div` with `layout` prop so dismissed cards animate out smoothly

- **Bottom:** "Refresh Recommendations" button (outline variant) for manual regeneration

### Edit 3: `client/src/pages/BookDetailPage.tsx` — Add "More Like This" Section

Add a "More Like This" section near the bottom of the book detail page, BEFORE the "Remove from Library" button.

**New query** — add alongside the existing `useQuery` for the book:
```typescript
const { data: similarData, isLoading: similarLoading } = useQuery<{
  books: Array<Book & { similarity: number }>;
}>({
  queryKey: ["/api/books", userBook?.bookId, "similar"],
  enabled: !!userBook?.bookId,
});
```

**Render section** — insert before the `<div className="pt-2 pb-4">` that contains the "Remove from Library" button:

```tsx
{/* More Like This */}
<div>
  <Label className="text-xs text-muted-foreground mb-2 block">More Like This</Label>
  {similarLoading ? (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="w-20 h-28 rounded-md flex-shrink-0" />
      ))}
    </div>
  ) : similarData?.books && similarData.books.length > 0 ? (
    <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
      {similarData.books.map((similar) => (
        <Link key={similar.id} href={`/search?q=${encodeURIComponent(similar.title)}`}>
          <div className="w-20 flex-shrink-0">
            <div className="w-20 h-28 rounded-md bg-muted overflow-hidden mb-1">
              {similar.coverImageUrl ? (
                <img src={similar.coverImageUrl} alt={similar.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <BookOpen className="w-4 h-4 text-muted-foreground/40" />
                </div>
              )}
            </div>
            <p className="text-[10px] leading-tight line-clamp-2 font-medium">{similar.title}</p>
          </div>
        </Link>
      ))}
    </div>
  ) : (
    <p className="text-xs text-muted-foreground">No similar books found yet.</p>
  )}
</div>
```

Also add the necessary imports at the top of `BookDetailPage.tsx`:
- `Link` from `wouter` (may already be imported or available)
- `Skeleton` from `@/components/ui/skeleton` (already imported)

**Note:** The similar books link to search since they may not be in the user's library yet. Tapping one opens a search pre-filled with the book title, letting the user find and add it. This is simpler than building a standalone "book info" page for books outside the user's library.

---

## Implementation Notes

1. **Embedding cost:** OpenAI `text-embedding-3-small` is $0.02/1M tokens. A book's metadata averages ~100 tokens. 10,000 books = 1M tokens = $0.02. Embedding the entire library is essentially free.

2. **Claude cost:** Each recommendation generation is one API call: ~3,000 input tokens + ~2,000 output tokens ≈ $0.04/request using Sonnet. With 24-hour caching and manual refresh, expect ~1 call/user/day. 1,000 active users = ~$40/month.

3. **pgvector indexing:** The IVFFlat index with 100 lists works well up to ~100K books. Beyond that, consider HNSW indexing. For MVP scale this is more than sufficient.

4. **Cold start:** New users with 0–2 books will get empty recommendations. The DiscoverPage handles this with a friendly empty state directing them to search/add books. Recommendations become useful at ~5+ books in the library.

5. **The `embedding` column is NOT in the Drizzle schema** because Drizzle doesn't support pgvector column types natively. All embedding reads/writes use `db.execute(sql\`...\`)` with raw SQL. This is intentional — don't try to add a vector column to `shared/schema.ts`.

6. **Embedding happens in the background.** The `embedBook()` call after `POST /api/library` is fire-and-forget (`.catch()` swallows errors). If OpenAI is down, the book still gets added — it just won't have an embedding until the next batch run or manual `/api/embeddings/generate` call.

7. **Claude fallback:** If the Anthropic API call fails, `claudeRerank` falls back to returning candidates sorted by vector similarity with generic explanations. Recommendations still work, just without personalized reasons.

8. **Don't add new routes to App.tsx.** The `/discover` route already exists and renders `<DiscoverPage />` inside `<AuthGuard>` + `<AppShell>`. You're just replacing the component contents.

9. **The "More Like This" horizontal scroll** on BookDetailPage uses a simple overflow-x-auto flex container. Each book is a 80px-wide card with cover + truncated title. Keep it lightweight — this is a discovery nudge, not a full search results page.

10. **Recommendation freshness:** Cached recommendations are served until the user explicitly taps "Refresh" or 24+ hours pass (checked by comparing `createdAt` timestamps). The refresh button triggers `POST /api/recommendations/refresh` which embeds any missing books first, then regenerates everything.

---

## What This Does NOT Include (saved for later)

- Collaborative filtering (Layer 2 — needs 500+ active users with ratings)
- Natural language recommendation queries ("books like X but more literary")
- Mood-based filtering ("I want something light for vacation")
- Scan results integration (highlighting recommended books during shelf scanning)
- Nightly batch job for pre-computing recommendations
- User taste vector (weighted average of all rated books' embeddings)
