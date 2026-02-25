# Spined — Goodreads CSV Import (Replit Agent Prompt)

Phases 1a (library), 1b (scanning), and 1c (recommendations) are built and running. The `goodreads_imports` table already exists in the database schema, but nothing else for Goodreads import was implemented — no CSV parsing, no matching logic, no API endpoints, no storage methods, no UI. This prompt builds the complete Goodreads import feature end-to-end.

**CRITICAL: Do not rewrite, restructure, or refactor any existing code. Only add new files and make the specific edits called out below. All existing features must continue working unchanged.**

---

## New npm Packages

Install two server-side packages:

```bash
npm install csv-parse multer @types/multer
```

- `csv-parse` — streaming CSV parser for Goodreads export files
- `multer` — Express middleware for handling multipart file uploads

---

## Overview: What Gets Built

1. **`server/goodreadsImport.ts`** — CSV parser + Google Books matching engine (NEW FILE)
2. **`server/storage.ts`** — 3 new methods for goodreads_imports table (EDIT)
3. **`server/routes.ts`** — 3 new API endpoints + multer setup (EDIT)
4. **`client/src/pages/ImportPage.tsx`** — Full import UI with upload, progress, results (NEW FILE)
5. **`client/src/App.tsx`** — Add /import route (EDIT)
6. **`client/src/pages/SettingsPage.tsx`** — Add "Import from Goodreads" card (EDIT)

---

## File 1 (NEW): `server/goodreadsImport.ts`

This is the core engine. It parses Goodreads CSV exports, maps fields to Spined's data model, and matches each row against Google Books API by ISBN first, then title+author fallback.

```typescript
import { parse } from "csv-parse";
import { storage } from "./storage";
import { db } from "./db";
import { goodreadsImports } from "@shared/schema";
import { eq } from "drizzle-orm";
import { log } from "./index";
import { embedBook } from "./embeddings";

// Goodreads CSV column names (these are the actual headers in the export)
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

/**
 * Map Goodreads "Exclusive Shelf" value to Spined reading status.
 */
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

/**
 * Clean ISBN strings from Goodreads CSV.
 * Goodreads wraps ISBNs in ="..." format, e.g. ="0374529256"
 */
function cleanIsbn(raw: string): string {
  if (!raw) return "";
  return raw.replace(/^="?/, "").replace(/"$/, "").trim();
}

/**
 * Search Google Books API with a single query string.
 * Returns the first match or null.
 */
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

/**
 * Try to find a book via Google Books API.
 * Strategy: ISBN13 → ISBN10 → title+author search.
 */
async function findBookOnGoogle(
  title: string,
  author: string,
  isbn13: string,
  isbn10: string
): Promise<any | null> {
  // Strategy 1: ISBN13 (most reliable)
  if (isbn13) {
    const result = await queryGoogleBooks(`isbn:${isbn13}`);
    if (result) return result;
  }

  // Strategy 2: ISBN10
  if (isbn10) {
    const result = await queryGoogleBooks(`isbn:${isbn10}`);
    if (result) return result;
  }

  // Strategy 3: Title + Author (fuzzy)
  if (title) {
    // Remove series info in parentheses, e.g. "The Name of the Wind (The Kingkiller Chronicle, #1)"
    const cleanTitle = title.replace(/\s*\(.*?\)\s*$/, "").trim();
    const query = author
      ? `intitle:${cleanTitle} inauthor:${author}`
      : `intitle:${cleanTitle}`;
    const result = await queryGoogleBooks(query);
    if (result) return result;
  }

  return null;
}

/**
 * Parse a Goodreads date string into a YYYY-MM-DD string or undefined.
 * Goodreads uses formats like "2024/01/15", "2024/01", or empty string.
 */
function parseGoodreadsDate(dateStr: string): string | undefined {
  if (!dateStr || !dateStr.trim()) return undefined;
  const cleaned = dateStr.trim().replace(/\//g, "-");
  // Validate it looks like a date
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;
  if (/^\d{4}-\d{2}$/.test(cleaned)) return `${cleaned}-01`;
  return undefined;
}

/**
 * Process a full Goodreads CSV import.
 * This runs asynchronously after the upload endpoint returns.
 * It parses every row, matches against Google Books, and adds matched books to the user's library.
 * Progress is tracked in the goodreads_imports table so the frontend can poll.
 */
export async function processGoodreadsImport(
  importId: string,
  userId: string,
  csvContent: string
): Promise<void> {
  // Mark as processing
  await db
    .update(goodreadsImports)
    .set({ status: "processing", startedAt: new Date() })
    .where(eq(goodreadsImports.id, importId));

  try {
    // Parse CSV into rows
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
          // Upsert into the books table (reuses existing book if googleBooksId matches)
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

          // Add to user's library — skip silently if duplicate (user already has this book)
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
            // Duplicate user_book — book already in library, skip it
            if (
              dupErr.message?.includes("duplicate") ||
              dupErr.code === "23505"
            ) {
              // Silently skip
            } else {
              throw dupErr;
            }
          }

          booksMatched++;

          // Fire-and-forget embedding generation for recommendation engine
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

      // Update progress every 10 rows so frontend can poll
      if ((i + 1) % 10 === 0 || i === rows.length - 1) {
        await db
          .update(goodreadsImports)
          .set({ booksMatched, booksUnmatched })
          .where(eq(goodreadsImports.id, importId));
      }

      // Small delay every 5 rows to avoid hammering Google Books API rate limits
      if ((i + 1) % 5 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    // Mark completed
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
```

---

## File 2 (EDIT): `server/storage.ts`

### Edit 2a: Add import to the top

Add `goodreadsImports` and its type to the existing import block from `@shared/schema`. Find the import that starts with:

```typescript
import {
  users,
  books,
  ...
```

Add `goodreadsImports` and `type GoodreadsImport` to that import list.

### Edit 2b: Add 3 methods to IStorage interface

Add these three method signatures inside the existing `export interface IStorage { ... }` block, after the last collection method (`removeBookFromCollection`):

```typescript
  // Goodreads imports
  createGoodreadsImport(userId: string): Promise<GoodreadsImport>;
  getGoodreadsImport(id: string, userId: string): Promise<GoodreadsImport | undefined>;
  getLatestGoodreadsImport(userId: string): Promise<GoodreadsImport | undefined>;
```

### Edit 2c: Add 3 method implementations to DatabaseStorage

Add these three methods inside the existing `export class DatabaseStorage implements IStorage { ... }` class, after the last collection method (`removeBookFromCollection`):

```typescript
  async createGoodreadsImport(userId: string): Promise<GoodreadsImport> {
    const [row] = await db
      .insert(goodreadsImports)
      .values({ userId, status: "pending" })
      .returning();
    return row;
  }

  async getGoodreadsImport(id: string, userId: string): Promise<GoodreadsImport | undefined> {
    const [row] = await db
      .select()
      .from(goodreadsImports)
      .where(and(eq(goodreadsImports.id, id), eq(goodreadsImports.userId, userId)));
    return row;
  }

  async getLatestGoodreadsImport(userId: string): Promise<GoodreadsImport | undefined> {
    const [row] = await db
      .select()
      .from(goodreadsImports)
      .where(eq(goodreadsImports.userId, userId))
      .orderBy(desc(goodreadsImports.createdAt))
      .limit(1);
    return row;
  }
```

---

## File 3 (EDIT): `server/routes.ts`

### Edit 3a: Add imports at the top

Add these two imports near the top of routes.ts, after the existing import lines:

```typescript
import multer from "multer";
import { processGoodreadsImport } from "./goodreadsImport";
```

### Edit 3b: Add multer config

Add this line right after the `requireAppUser` function definition (around line 55), before the `async function searchGoogleBooks` function:

```typescript
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
```

### Edit 3c: Add 3 Goodreads import routes

Add these three routes inside the `registerRoutes` function, BEFORE the final `return httpServer;` line. Place them after the existing `/api/embeddings/generate` route:

```typescript
  // === Goodreads Import Routes ===

  // POST /api/import/goodreads — Upload CSV file and start async import
  app.post(
    "/api/import/goodreads",
    requireAuth,
    requireAppUser,
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        if (!req.file) {
          return res.status(400).json({ message: "CSV file is required" });
        }

        const csvContent = req.file.buffer.toString("utf-8");

        // Basic validation: check for expected Goodreads headers
        const firstLine = csvContent.split("\n")[0] || "";
        if (!firstLine.includes("Title") || !firstLine.includes("Author")) {
          return res.status(400).json({
            message:
              "This doesn't look like a Goodreads export CSV. Expected columns: Title, Author, ISBN, etc.",
          });
        }

        // Create import record
        const importRecord = await storage.createGoodreadsImport(req.userId!);

        // Start processing asynchronously (don't await — return immediately)
        processGoodreadsImport(importRecord.id, req.userId!, csvContent).catch(
          (err) => log(`Goodreads import async error: ${err.message}`)
        );

        res.status(201).json({ import: importRecord });
      } catch (err: any) {
        log(`Goodreads upload error: ${err.message}`);
        res.status(500).json({ message: "Failed to start import" });
      }
    }
  );

  // GET /api/import/:id — Check import status and progress
  app.get(
    "/api/import/:id",
    requireAuth,
    requireAppUser,
    async (req: Request, res: Response) => {
      try {
        const importRecord = await storage.getGoodreadsImport(
          req.params.id,
          req.userId!
        );
        if (!importRecord) {
          return res.status(404).json({ message: "Import not found" });
        }
        res.json({ import: importRecord });
      } catch (err: any) {
        log(`Get import error: ${err.message}`);
        res.status(500).json({ message: "Failed to get import status" });
      }
    }
  );

  // GET /api/import/latest — Get the user's most recent import (for resuming/viewing results)
  app.get(
    "/api/import/latest",
    requireAuth,
    requireAppUser,
    async (req: Request, res: Response) => {
      try {
        const importRecord = await storage.getLatestGoodreadsImport(
          req.userId!
        );
        if (!importRecord) {
          return res.json({ import: null });
        }
        res.json({ import: importRecord });
      } catch (err: any) {
        log(`Get latest import error: ${err.message}`);
        res.status(500).json({ message: "Failed to get import status" });
      }
    }
  );
```

**IMPORTANT route ordering note:** The `/api/import/latest` route MUST be registered BEFORE `/api/import/:id` — otherwise Express will treat "latest" as an `:id` parameter. Reorder the two GET routes so `latest` comes first.

---

## File 4 (NEW): `client/src/pages/ImportPage.tsx`

Full import UI with file upload, real-time progress polling, results summary, and unmatched books display.

```tsx
import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Upload,
  CheckCircle2,
  XCircle,
  Loader2,
  BookOpen,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import { useAuthStore } from "@/hooks/useAuth";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type ImportStatus = "idle" | "uploading" | "processing" | "completed" | "failed";

interface ImportRecord {
  id: string;
  status: string;
  totalRows: number | null;
  booksMatched: number;
  booksUnmatched: number;
  unmatchedData: Array<{
    title: string;
    author: string;
    isbn: string;
    shelf: string;
    rating: string;
  }> | null;
  errorMessage: string | null;
  createdAt: string;
}

export default function ImportPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uiStatus, setUiStatus] = useState<ImportStatus>("idle");
  const [importId, setImportId] = useState<string | null>(null);
  const [importData, setImportData] = useState<ImportRecord | null>(null);

  // Poll for import progress when we have an active import
  const { data: pollData } = useQuery<{ import: ImportRecord }>({
    queryKey: ["/api/import", importId],
    enabled: !!importId && (uiStatus === "processing" || uiStatus === "uploading"),
    refetchInterval: 1500, // Poll every 1.5 seconds
  });

  // Check for existing recent import on page load
  const { data: latestData } = useQuery<{ import: ImportRecord | null }>({
    queryKey: ["/api/import/latest"],
    enabled: uiStatus === "idle" && !importId,
  });

  // Restore state from a recent in-progress or completed import
  useEffect(() => {
    if (latestData?.import && !importId) {
      const latest = latestData.import;
      if (latest.status === "processing" || latest.status === "pending") {
        setImportId(latest.id);
        setImportData(latest);
        setUiStatus("processing");
      } else if (latest.status === "completed" || latest.status === "failed") {
        // Show results of last import if it was within the last hour
        const age = Date.now() - new Date(latest.createdAt).getTime();
        if (age < 60 * 60 * 1000) {
          setImportData(latest);
          setUiStatus(latest.status as ImportStatus);
        }
      }
    }
  }, [latestData, importId]);

  // Update local state when poll returns new data
  useEffect(() => {
    if (pollData?.import) {
      setImportData(pollData.import);
      if (pollData.import.status === "completed") {
        setUiStatus("completed");
        // Invalidate library cache so new books show up
        queryClient.invalidateQueries({ queryKey: ["/api/library"] });
        toast({ title: "Import complete!", description: `${pollData.import.booksMatched} books added to your library.` });
      } else if (pollData.import.status === "failed") {
        setUiStatus("failed");
        toast({ title: "Import failed", description: pollData.import.errorMessage || "Unknown error", variant: "destructive" });
      }
    }
  }, [pollData]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".csv")) {
      toast({ title: "Invalid file", description: "Please upload a .csv file exported from Goodreads.", variant: "destructive" });
      return;
    }

    setUiStatus("uploading");

    try {
      const token = useAuthStore.getState().accessToken;
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/import/goodreads", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || "Upload failed");
      }

      const data = await res.json();
      setImportId(data.import.id);
      setImportData(data.import);
      setUiStatus("processing");
    } catch (err: any) {
      setUiStatus("failed");
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    }

    // Reset file input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const progressPercent =
    importData?.totalRows && importData.totalRows > 0
      ? Math.round(
          ((importData.booksMatched + importData.booksUnmatched) /
            importData.totalRows) *
            100
        )
      : 0;

  const handleStartNew = () => {
    setUiStatus("idle");
    setImportId(null);
    setImportData(null);
  };

  return (
    <div className="px-4 py-6 pb-24 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/settings")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="text-xl font-bold font-serif">Import from Goodreads</h1>
      </div>

      {/* Instructions */}
      {uiStatus === "idle" && (
        <>
          <Card className="mb-4">
            <CardHeader className="pb-2">
              <h2 className="text-sm font-semibold">How to export from Goodreads</h2>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>1. Go to <a href="https://www.goodreads.com/review/import" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-1">goodreads.com/review/import <ExternalLink className="w-3 h-3" /></a></p>
              <p>2. Click <strong>"Export Library"</strong> at the top of the page</p>
              <p>3. Wait for the export to generate, then download the CSV file</p>
              <p>4. Upload that CSV file below</p>
            </CardContent>
          </Card>

          <Card className="mb-4">
            <CardContent className="pt-6">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                className="hidden"
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-14 text-base"
                size="lg"
              >
                <Upload className="w-5 h-5 mr-2" />
                Upload Goodreads CSV
              </Button>
              <p className="text-xs text-center text-muted-foreground mt-3">
                Your ratings, reviews, and reading status will be imported.
              </p>
            </CardContent>
          </Card>
        </>
      )}

      {/* Uploading state */}
      {uiStatus === "uploading" && (
        <Card>
          <CardContent className="pt-6 flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm font-medium">Uploading your library...</p>
          </CardContent>
        </Card>
      )}

      {/* Processing state */}
      {uiStatus === "processing" && importData && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-primary flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">Importing your books...</p>
                <p className="text-xs text-muted-foreground">
                  Matching each book against Google Books. This may take a few minutes for large libraries.
                </p>
              </div>
            </div>

            <Progress value={progressPercent} className="h-2" />

            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{importData.booksMatched + importData.booksUnmatched} of {importData.totalRows || "?"} processed</span>
              <span>{progressPercent}%</span>
            </div>

            <div className="flex gap-4 text-sm">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span>{importData.booksMatched} matched</span>
              </div>
              <div className="flex items-center gap-1.5">
                <XCircle className="w-4 h-4 text-orange-400" />
                <span>{importData.booksUnmatched} unmatched</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Completed state */}
      {uiStatus === "completed" && importData && (
        <>
          <Card className="mb-4">
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-green-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Import complete!</p>
                  <p className="text-xs text-muted-foreground">
                    {importData.totalRows} books processed
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-green-700">{importData.booksMatched}</p>
                  <p className="text-xs text-green-600">Books added</p>
                </div>
                <div className="bg-orange-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-orange-700">{importData.booksUnmatched}</p>
                  <p className="text-xs text-orange-600">Couldn't match</p>
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={() => navigate("/library")} className="flex-1">
                  <BookOpen className="w-4 h-4 mr-2" />
                  View Library
                </Button>
                <Button onClick={handleStartNew} variant="outline" className="flex-1">
                  Import Again
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Unmatched books list */}
          {importData.unmatchedData && importData.unmatchedData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-orange-400" />
                  <h2 className="text-sm font-semibold">
                    Unmatched Books ({importData.unmatchedData.length})
                  </h2>
                </div>
                <p className="text-xs text-muted-foreground">
                  These books couldn't be found on Google Books. You can search for them manually.
                </p>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {importData.unmatchedData.map((book, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-2 py-2 border-b border-border/50 last:border-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{book.title}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {book.author}
                          {book.shelf ? ` · ${book.shelf}` : ""}
                          {book.rating && book.rating !== "0" ? ` · ${book.rating}★` : ""}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-shrink-0 text-xs"
                        onClick={() =>
                          navigate(
                            `/search?q=${encodeURIComponent(book.title + " " + book.author)}`
                          )
                        }
                      >
                        Search
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Failed state */}
      {uiStatus === "failed" && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-3">
              <XCircle className="w-6 h-6 text-red-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold">Import failed</p>
                <p className="text-xs text-muted-foreground">
                  {importData?.errorMessage || "Something went wrong. Please try again."}
                </p>
              </div>
            </div>
            <Button onClick={handleStartNew} className="w-full">
              Try Again
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

---

## File 5 (EDIT): `client/src/App.tsx`

### Edit 5a: Add import for ImportPage

Add this line with the other page imports (around line 19, after the `CollectionPage` import):

```typescript
import ImportPage from "@/pages/ImportPage";
```

### Edit 5b: Add /import route

Add this route block inside the `<Switch>`, after the `/settings` route and before the `/scan` route:

```tsx
      <Route path="/import">
        <AuthGuard>
          <AppShell><ImportPage /></AppShell>
        </AuthGuard>
      </Route>
```

---

## File 6 (EDIT): `client/src/pages/SettingsPage.tsx`

### Edit 6a: Add imports

Add these to the existing imports at the top of the file:

```typescript
import { BookOpen } from "lucide-react";
```

(The `useLocation` import already exists.)

### Edit 6b: Add "Import Library" card

Add a new `<Card>` block between the existing "Profile" card and the "Account" card. Find the closing `</Card>` of the Profile card and insert this right after it:

```tsx
      <Card className="mb-4">
        <CardHeader className="pb-2">
          <h2 className="text-sm font-semibold">Import Library</h2>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => navigate("/import")}
          >
            <BookOpen className="w-4 h-4 mr-2" />
            Import from Goodreads
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            Upload your Goodreads CSV export to bring in your entire library.
          </p>
        </CardContent>
      </Card>
```

---

## Implementation Notes

1. **File upload handling:** The existing `apiRequest` helper in `queryClient.ts` always sets `Content-Type: application/json`, so the ImportPage uses a raw `fetch()` call with `FormData` for the CSV upload. This is intentional — don't modify `apiRequest`.

2. **Async processing:** The upload endpoint returns immediately with the import record ID. The CSV processing runs in the background via `processGoodreadsImport()`. The frontend polls `GET /api/import/:id` every 1.5 seconds to show progress.

3. **Google Books rate limits:** The import adds a 300ms delay every 5 rows to stay well within Google Books API rate limits. A 500-book library takes roughly 3-4 minutes to process.

4. **Duplicate handling:** If a book already exists in the user's library (matching on `userId + bookId` unique constraint), the import silently skips it. This means re-importing the same CSV is safe — it won't create duplicates.

5. **Goodreads CSV format quirks:**
   - ISBNs are wrapped in `="0374529256"` format — the `cleanIsbn()` function strips this
   - "Exclusive Shelf" determines reading status (not "Bookshelves" which can have multiple)
   - Dates use `YYYY/MM/DD` format
   - Some rows may have empty titles — these are skipped

6. **Embedding generation:** Each matched book gets a background embedding call for the recommendation engine. This is fire-and-forget — if it fails, the book is still imported fine and will get embedded later via the batch endpoint.

7. **Source tracking:** Imported books use `source: "goodreads"` in the user_books table. The existing source field in the schema is a free-text field with no constraint, so "goodreads" works without any schema change.

8. **Route ordering matters:** The `GET /api/import/latest` route MUST be registered before `GET /api/import/:id` in Express. Otherwise, Express will interpret "latest" as an `:id` value. The code above shows them in the correct order.

9. **Progress UI:** The Progress component from shadcn/ui should already be installed. If not, run: `npx shadcn-ui@latest add progress`

10. **SearchPage integration:** The "Search" button next to unmatched books navigates to `/search?q=title+author`. If your SearchPage doesn't read the `q` query parameter to pre-fill the search input, you may want to add that — but it's not required for the import to work. Users can just type in the search manually.
