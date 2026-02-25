# Spined — Phase 1b: Shelf Scanner (Replit Agent Prompt)

Phase 1a is already built and running — auth, book search, library CRUD, collections, Goodreads import, profile. This prompt adds the core differentiating feature: point your phone camera at a bookshelf, AI reads the spines via OCR, fuzzy-matches them to Google Books, and lets you add detected books to your library.

**CRITICAL: Do not rewrite, restructure, or refactor any existing Phase 1a code. Only add new files and make the specific edits called out below. All existing features must continue working unchanged.**

---

## Enable Cloud Vision API (No New Env Var Needed)

The existing `GOOGLE_BOOKS_API_KEY` works for Cloud Vision too — Google API keys are project-level. Just enable the Cloud Vision API in the same Google Cloud project: Console → APIs & Services → Enable "Cloud Vision API". That's it — no new secret to add.

---

## Database: Two New Tables

**File: `shared/schema.ts`** — Append these two tables AFTER the existing `goodreadsImports` table definition, BEFORE the line that says `export const insertUserSchema`.

```typescript
export const scanSessions = pgTable("scan_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  status: text("status").default("active").notNull(),
  framesProcessed: integer("frames_processed").default(0),
  booksDetected: integer("books_detected").default(0),
  booksAdded: integer("books_added").default(0),
  scanDurationMs: integer("scan_duration_ms"),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const scanResults = pgTable("scan_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  scanSessionId: uuid("scan_session_id")
    .references(() => scanSessions.id, { onDelete: "cascade" })
    .notNull(),
  googleBooksId: text("google_books_id"),
  matchedTitle: text("matched_title"),
  matchedAuthors: text("matched_authors").array(),
  coverImageUrl: text("cover_image_url"),
  ocrTextFragments: text("ocr_text_fragments").array(),
  confidenceScore: numeric("confidence_score", { precision: 4, scale: 3 }),
  matchTier: text("match_tier"),
  wasAdded: boolean("was_added").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});
```

Then append these insert schemas and types alongside the existing ones (after the existing `insertCollectionBookSchema`):

```typescript
export const insertScanSessionSchema = createInsertSchema(scanSessions).omit({
  id: true, createdAt: true, completedAt: true,
});
export const insertScanResultSchema = createInsertSchema(scanResults).omit({
  id: true, createdAt: true,
});

export type ScanSession = typeof scanSessions.$inferSelect;
export type InsertScanSession = z.infer<typeof insertScanSessionSchema>;
export type ScanResult = typeof scanResults.$inferSelect;
export type InsertScanResult = z.infer<typeof insertScanResultSchema>;
```

After saving, run `npm run db:push` (or `npx drizzle-kit push`) to sync the new tables to Supabase.

---

## New Server Files (2 files)

### File 1: `server/vision.ts` — Cloud Vision OCR Client

This file sends a base64-encoded camera frame to Google Cloud Vision's TEXT_DETECTION endpoint and returns structured OCR data.

```typescript
import { log } from "./index";

interface OcrFragment {
  text: string;
  bounds: { x: number; y: number; width: number; height: number };
}

interface OcrResult {
  fullText: string;
  fragments: OcrFragment[];
}

export async function extractTextFromImage(base64Image: string): Promise<OcrResult> {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_BOOKS_API_KEY is not set");
  }

  // Strip data URI prefix if present
  const imageData = base64Image.replace(/^data:image\/[a-zA-Z]+;base64,/, "");

  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: imageData },
            features: [{ type: "TEXT_DETECTION", maxResults: 50 }],
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    log(`Cloud Vision API error: ${response.status} ${errText}`);
    throw new Error(`Cloud Vision API error: ${response.status}`);
  }

  const data = await response.json();
  const annotations = data.responses?.[0]?.textAnnotations;

  if (!annotations || annotations.length === 0) {
    return { fullText: "", fragments: [] };
  }

  // First annotation is the full aggregated text
  const fullText = annotations[0].description || "";

  // Remaining annotations are individual word/phrase fragments with bounding boxes
  const fragments: OcrFragment[] = annotations.slice(1).map((ann: any) => {
    const vertices = ann.boundingPoly?.vertices || [];
    const xs = vertices.map((v: any) => v.x || 0);
    const ys = vertices.map((v: any) => v.y || 0);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return {
      text: ann.description || "",
      bounds: {
        x: minX,
        y: minY,
        width: Math.max(...xs) - minX,
        height: Math.max(...ys) - minY,
      },
    };
  });

  return { fullText, fragments };
}
```

### File 2: `server/bookMatcher.ts` — Fuzzy Matching Engine

This is the brain of the scanner. Takes OCR fragments, clusters them by physical position on the shelf (each cluster = one book spine), queries Google Books for each cluster, and scores the results.

```typescript
import { log } from "./index";

interface OcrFragment {
  text: string;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface MatchedBook {
  googleBooksId: string;
  title: string;
  subtitle?: string;
  authors: string[];
  publishedDate?: string;
  pageCount?: number;
  coverImageUrl?: string;
  description?: string;
  isbn13?: string;
  isbn10?: string;
  categories?: string[];
  publisher?: string;
  averageRating?: number;
  language?: string;
  confidenceScore: number;
  matchedFragments: string[];
}

/**
 * Cluster OCR fragments by x-position into vertical strips (book spines).
 * Fragments whose x-center is within `proximityPx` of each other belong to the same spine.
 */
function clusterFragments(fragments: OcrFragment[], proximityPx = 80): string[][] {
  if (fragments.length === 0) return [];

  // Sort by x-center
  const sorted = [...fragments].sort(
    (a, b) => (a.bounds.x + a.bounds.width / 2) - (b.bounds.x + b.bounds.width / 2)
  );

  const clusters: OcrFragment[][] = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i++) {
    const frag = sorted[i];
    const fragCenter = frag.bounds.x + frag.bounds.width / 2;
    const lastCluster = clusters[clusters.length - 1];
    const lastCenter =
      lastCluster[lastCluster.length - 1].bounds.x +
      lastCluster[lastCluster.length - 1].bounds.width / 2;

    if (Math.abs(fragCenter - lastCenter) <= proximityPx) {
      lastCluster.push(frag);
    } else {
      clusters.push([frag]);
    }
  }

  // Within each cluster, sort top-to-bottom by y, then extract text strings
  return clusters
    .map((cluster) =>
      cluster
        .sort((a, b) => a.bounds.y - b.bounds.y)
        .map((f) => f.text)
    )
    .filter((texts) => texts.join(" ").trim().length >= 3); // Skip tiny clusters
}

/** Levenshtein edit distance */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** Normalized similarity: 1.0 = identical, 0.0 = completely different */
function normalizedSimilarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const maxLen = Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / maxLen;
}

/** Score a Google Books result against its source OCR cluster text */
function scoreMatch(clusterText: string, bookTitle: string, bookAuthors: string[]): number {
  const normCluster = clusterText.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const normTitle = bookTitle.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();

  // Title similarity (70% weight)
  const titleScore = normalizedSimilarity(normCluster, normTitle);

  // Author match (30% weight) — check if any author name parts appear in cluster text
  let authorScore = 0;
  if (bookAuthors.length > 0) {
    for (const author of bookAuthors) {
      const parts = author.toLowerCase().split(/\s+/);
      for (const part of parts) {
        if (part.length >= 3 && normalizedSimilarity(normCluster, part) > 0.3) {
          // Check if this author part actually appears somewhere in the cluster
          if (normCluster.includes(part) || normalizedSimilarity(normCluster, part) > 0.8) {
            authorScore = Math.max(authorScore, 1.0);
          }
        }
      }
    }
  }

  let score = titleScore * 0.7 + authorScore * 0.3;

  // Short-text penalty: very short queries produce noisy matches
  if (normCluster.length < 4) score *= 0.5;
  else if (normCluster.length < 8) score *= 0.8;

  return Math.round(score * 1000) / 1000;
}

/** Search Google Books with a short query (3 results, for speed) */
async function searchGoogleBooksForCluster(query: string): Promise<any[]> {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
  const encoded = encodeURIComponent(query.slice(0, 100)); // Cap query length
  const baseUrl = `https://www.googleapis.com/books/v1/volumes?q=${encoded}&maxResults=3`;
  const url = apiKey ? `${baseUrl}&key=${apiKey}` : baseUrl;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();

    return (data.items || []).map((item: any) => {
      const info = item.volumeInfo || {};
      const ids = info.industryIdentifiers || [];
      let coverUrl = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || null;
      if (coverUrl) {
        coverUrl = coverUrl.replace("http://", "https://").replace("&edge=curl", "");
      }
      return {
        googleBooksId: item.id,
        title: info.title || "Untitled",
        subtitle: info.subtitle,
        authors: info.authors || ["Unknown Author"],
        publishedDate: info.publishedDate,
        pageCount: info.pageCount,
        coverImageUrl: coverUrl,
        description: info.description,
        isbn13: ids.find((i: any) => i.type === "ISBN_13")?.identifier,
        isbn10: ids.find((i: any) => i.type === "ISBN_10")?.identifier,
        categories: info.categories,
        publisher: info.publisher,
        averageRating: info.averageRating,
        language: info.language,
      };
    });
  } catch (err) {
    log(`Google Books search error for "${query}": ${err}`);
    return [];
  }
}

/**
 * Main entry point: takes OCR fragments, returns matched books.
 * Process: cluster fragments → search Google Books per cluster → score → deduplicate → filter by threshold.
 */
export async function matchBooksFromOCR(
  fragments: OcrFragment[],
  confidenceThreshold = 0.45
): Promise<Array<{ book: MatchedBook; ocrFragments: string[] }>> {
  const clusters = clusterFragments(fragments);

  if (clusters.length === 0) return [];

  const seenIds = new Set<string>();
  const allMatches: Array<{ book: MatchedBook; ocrFragments: string[] }> = [];

  // Process clusters in batches of 5 to avoid hammering Google Books
  for (let i = 0; i < clusters.length; i += 5) {
    const batch = clusters.slice(i, i + 5);
    const batchResults = await Promise.all(
      batch.map(async (clusterTexts) => {
        const queryText = clusterTexts.join(" ").trim();
        if (queryText.length < 3) return null;

        const results = await searchGoogleBooksForCluster(queryText);
        if (results.length === 0) return null;

        // Score each result and pick the best
        let bestMatch: MatchedBook | null = null;
        let bestScore = 0;

        for (const result of results) {
          const score = scoreMatch(queryText, result.title, result.authors);
          if (score > bestScore && score >= confidenceThreshold) {
            bestScore = score;
            bestMatch = { ...result, confidenceScore: score, matchedFragments: clusterTexts };
          }
        }

        if (bestMatch && !seenIds.has(bestMatch.googleBooksId)) {
          seenIds.add(bestMatch.googleBooksId);
          return { book: bestMatch, ocrFragments: clusterTexts };
        }
        return null;
      })
    );

    for (const result of batchResults) {
      if (result) allMatches.push(result);
    }
  }

  // Sort by confidence descending
  return allMatches.sort((a, b) => b.book.confidenceScore - a.book.confidenceScore);
}
```

---

## Server Edits (2 existing files)

### Edit 1: `server/index.ts` — Increase JSON body size limit

Camera frames are 200KB–3MB as base64. The default Express limit is 100KB. Find this block:

```typescript
app.use(
  express.json({
    verify: (req, _res, buf) => {
```

Add `limit: "10mb"` so it becomes:

```typescript
app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
```

**Without this change, every frame POST will silently fail with 413 Payload Too Large.**

### Edit 2: `server/routes.ts` — Add 4 scan endpoints

Add these imports at the top of the file (alongside the existing imports):

```typescript
import { extractTextFromImage } from "./vision";
import { matchBooksFromOCR } from "./bookMatcher";
import { db } from "./db";
import { scanSessions, scanResults } from "@shared/schema";
import { eq } from "drizzle-orm";
```

Add these 4 routes inside `registerRoutes`, BEFORE the `return httpServer;` line:

```typescript
  // ═══════════════════════════════════════════
  // SCAN ROUTES (Phase 1b)
  // ═══════════════════════════════════════════

  // Process a single camera frame: OCR → match → classify against user library
  app.post("/api/scan/frame", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const { image } = req.body;
      if (!image) {
        return res.status(400).json({ message: "Image data is required" });
      }

      // Step 1: Extract text via Cloud Vision
      const ocrResult = await extractTextFromImage(image);
      if (ocrResult.fragments.length === 0) {
        return res.json({ matches: [], fragmentCount: 0 });
      }

      // Step 2: Fuzzy match against Google Books
      const matchResults = await matchBooksFromOCR(ocrResult.fragments);

      // Step 3: Classify each match against user's existing library
      const userLibrary = await storage.getUserBooks(req.userId!);
      const libraryMap = new Map<string, string>(); // googleBooksId → status
      for (const ub of userLibrary) {
        if (ub.book.googleBooksId) {
          libraryMap.set(ub.book.googleBooksId, ub.status);
        }
      }

      const enrichedMatches = matchResults.map(({ book, ocrFragments }) => {
        const libraryStatus = libraryMap.get(book.googleBooksId);
        let matchTier: string;
        if (libraryStatus === "want_to_read") {
          matchTier = "want_to_read";
        } else if (libraryStatus) {
          matchTier = "already_owned";
        } else {
          matchTier = "other";
        }

        return {
          ...book,
          ocrFragments,
          matchTier,
        };
      });

      res.json({
        matches: enrichedMatches,
        fragmentCount: ocrResult.fragments.length,
        fullText: ocrResult.fullText.slice(0, 500), // Truncated for debugging
      });
    } catch (err: any) {
      log(`Scan frame error: ${err.message}`);
      res.status(500).json({ message: "Failed to process frame" });
    }
  });

  // Create a new scan session
  app.post("/api/scan/sessions", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const [session] = await db
        .insert(scanSessions)
        .values({ userId: req.userId!, status: "active" })
        .returning();
      res.status(201).json({ session });
    } catch (err: any) {
      log(`Create scan session error: ${err.message}`);
      res.status(500).json({ message: "Failed to create scan session" });
    }
  });

  // Update scan session (complete or cancel)
  app.patch("/api/scan/sessions/:id", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const { status, framesProcessed, booksDetected, booksAdded, scanDurationMs } = req.body;
      const [updated] = await db
        .update(scanSessions)
        .set({
          status,
          framesProcessed,
          booksDetected,
          booksAdded,
          scanDurationMs,
          completedAt: status === "completed" || status === "cancelled" ? new Date() : undefined,
        })
        .where(eq(scanSessions.id, req.params.id))
        .returning();
      if (!updated) {
        return res.status(404).json({ message: "Session not found" });
      }
      res.json({ session: updated });
    } catch (err: any) {
      log(`Update scan session error: ${err.message}`);
      res.status(500).json({ message: "Failed to update session" });
    }
  });

  // Batch-save scan results
  app.post("/api/scan/sessions/:id/results", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const { results } = req.body;
      if (!results || !Array.isArray(results) || results.length === 0) {
        return res.json({ saved: 0 });
      }

      const rows = results.map((r: any) => ({
        scanSessionId: req.params.id,
        googleBooksId: r.googleBooksId,
        matchedTitle: r.title,
        matchedAuthors: r.authors,
        coverImageUrl: r.coverImageUrl,
        ocrTextFragments: r.ocrFragments || r.matchedFragments,
        confidenceScore: r.confidenceScore?.toString(),
        matchTier: r.matchTier,
        wasAdded: r.wasAdded || false,
      }));

      await db.insert(scanResults).values(rows);
      res.json({ saved: rows.length });
    } catch (err: any) {
      log(`Save scan results error: ${err.message}`);
      res.status(500).json({ message: "Failed to save results" });
    }
  });
```

---

## Client-Side Changes (2 files)

### Edit 1: `client/src/components/layout/BottomNav.tsx` — Remove "Coming Soon" from Scan

In the `navItems` array, find the Scan entry and remove `comingSoon: true`:

**Before:**
```typescript
{ path: "/scan", label: "Scan", icon: Camera, comingSoon: true, center: true },
```

**After:**
```typescript
{ path: "/scan", label: "Scan", icon: Camera, center: true },
```

This removes the amber "Soon" badge from the center scan button.

### Edit 2: `client/src/pages/ScanPage.tsx` — Complete Rewrite

Replace the entire file. The new `ScanPage` is a state machine with 3 modes: `idle`, `scanning`, and `results`.

**Imports needed:**
```
useState, useEffect, useRef, useCallback from "react"
Camera, X, BookOpen, Plus, Check, Loader2, ChevronDown, ChevronUp, AlertCircle from "lucide-react"
Card, CardContent from "@/components/ui/card"
Button from "@/components/ui/button"
DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem from "@/components/ui/dropdown-menu"
useToast from "@/hooks/use-toast"
apiRequest, queryClient from "@/lib/queryClient"
motion, AnimatePresence from "framer-motion"
```

**DetectedBook interface** (local to this file):
```typescript
interface DetectedBook {
  googleBooksId: string;
  title: string;
  subtitle?: string;
  authors: string[];
  publishedDate?: string;
  pageCount?: number;
  coverImageUrl?: string;
  description?: string;
  isbn13?: string;
  isbn10?: string;
  categories?: string[];
  publisher?: string;
  averageRating?: number;
  language?: string;
  confidenceScore: number;
  matchedFragments: string[];
  ocrFragments: string[];
  matchTier: "want_to_read" | "already_owned" | "other";
}
```

**Component state:**
```typescript
const [mode, setMode] = useState<"idle" | "scanning" | "results">("idle");
const [detectedBooks, setDetectedBooks] = useState<DetectedBook[]>([]);
const [framesProcessed, setFramesProcessed] = useState(0);
const [isProcessingFrame, setIsProcessingFrame] = useState(false);
const [cameraError, setCameraError] = useState<string | null>(null);
const [addedBooks, setAddedBooks] = useState<Set<string>>(new Set());
const [addingBook, setAddingBook] = useState<string | null>(null);
const [showAlreadyOwned, setShowAlreadyOwned] = useState(false);
const [sessionId, setSessionId] = useState<string | null>(null);
const [scanStartTime, setScanStartTime] = useState<number>(0);

const videoRef = useRef<HTMLVideoElement>(null);
const canvasRef = useRef<HTMLCanvasElement>(null);
const streamRef = useRef<MediaStream | null>(null);
const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
const detectedMapRef = useRef<Map<string, DetectedBook>>(new Map());
```

**`startScanning` callback:**
1. Reset state (detectedBooks, framesProcessed, cameraError, detectedMapRef)
2. Set `scanStartTime = Date.now()`
3. Try `navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } })`
4. On error: if `err.name === "NotAllowedError"` set cameraError to "Camera permission denied. Please allow camera access in your browser settings." Otherwise "Could not access camera. Please ensure no other app is using it."
5. On success: attach stream to `videoRef.current.srcObject`, set mode to `"scanning"`, call `POST /api/scan/sessions` (wrapped in try/catch — non-blocking), start the frame capture interval

**Frame capture interval** (every 2000ms):
1. If `isProcessingFrame` is true, skip (don't pile up requests)
2. Draw `videoRef.current` onto `canvasRef.current` (resize: max 1280px wide, maintain aspect ratio)
3. **Brightness gate:** Sample every ~40th pixel from the canvas ImageData, compute average `(r+g+b)/3`. If average < 40 or > 240, skip the frame (too dark or washed out)
4. Convert to base64: `canvasRef.current.toDataURL("image/jpeg", 0.7)`
5. Set `isProcessingFrame = true`
6. `POST /api/scan/frame` with `{ image: base64Data }` via `apiRequest`
7. Parse response. For each match: if not already in `detectedMapRef`, add it. If already there but new confidence is higher, update it
8. Sync `detectedMapRef` → `setDetectedBooks(Array.from(detectedMapRef.current.values()))`
9. Increment `framesProcessed`
10. Set `isProcessingFrame = false`
11. Wrap everything in try/catch — frame errors should be silent (log to console, don't toast)

**`finishScanning` callback:**
1. Clear the interval
2. Stop all tracks on the MediaStream (`streamRef.current.getTracks().forEach(t => t.stop())`)
3. Set mode to `"results"`
4. In a try/catch (non-blocking analytics): `PATCH /api/scan/sessions/${sessionId}` with `{ status: "completed", framesProcessed, booksDetected: detectedBooks.length, scanDurationMs: Date.now() - scanStartTime }`, then `POST /api/scan/sessions/${sessionId}/results` with the detected books array

**`cancelScanning` callback:**
1. Clear interval, stop media stream
2. Set mode to `"idle"`
3. PATCH session with `status: "cancelled"` (non-blocking)

**Cleanup effect:** `useEffect` return that clears interval and stops stream on unmount.

**`addToLibrary` function** — follow the exact same pattern as `SearchPage.tsx`:
```typescript
const addToLibrary = async (book: DetectedBook, status: string) => {
  setAddingBook(book.googleBooksId);
  try {
    await apiRequest("POST", "/api/library", {
      bookData: {
        googleBooksId: book.googleBooksId,
        title: book.title,
        subtitle: book.subtitle,
        authors: book.authors,
        publishedDate: book.publishedDate,
        pageCount: book.pageCount,
        coverImageUrl: book.coverImageUrl,
        description: book.description,
        isbn13: book.isbn13,
        isbn10: book.isbn10,
        categories: book.categories,
        publisher: book.publisher,
        averageRating: book.averageRating,
        language: book.language,
      },
      status,
      source: "shelf_scan",
    });
    setAddedBooks((prev) => new Set(prev).add(book.googleBooksId));
    queryClient.invalidateQueries({ queryKey: ["/api/library"] });
    toast({ title: "Added to library!" });
  } catch (err: any) {
    if (err.message?.includes("409")) {
      setAddedBooks((prev) => new Set(prev).add(book.googleBooksId));
      toast({ title: "Already in library" });
    } else {
      toast({ title: "Failed to add", description: err.message, variant: "destructive" });
    }
  } finally {
    setAddingBook(null);
  }
};
```

**Render — `idle` state:**
- Camera icon in a large circle (bg-primary/10), same style as the current placeholder
- "Shelf Scanner" heading (font-serif)
- Instruction text: "Point your camera at a bookshelf to identify books and add them to your library."
- Large primary "Start Scanning" Button (full width, max-w-[300px])
- If `cameraError`, show an Alert with the error message and a "Try Again" button
- Wrap in `motion.div` with fadeIn animation

**Render — `scanning` state:**
- `<video>` element: `ref={videoRef}`, `autoPlay`, `playsInline`, `muted`, `className="w-full h-[60vh] object-cover rounded-xl"`
- `<canvas>` element: hidden (`className="hidden"`), `ref={canvasRef}`
- Overlay bar on top of the video: semi-transparent dark background, pulsing green dot (CSS animation), "Scanning..." text, frame counter
- Live counter below video: `"{detectedBooks.length} books detected"` with a subtle pulse animation when the count changes
- Processing indicator: if `isProcessingFrame`, show a small spinner
- Bottom controls: "Done" button (primary, large) and "Cancel" button (ghost/outline, smaller)

**Render — `results` state:**
- Header: "Scan Results" with total count badge
- **If 0 books detected:** Empty state card with "No books detected. Try holding your camera steady and closer to the shelf." and a "Scan Again" button
- **Priority Section 1: "Want to Read Matches"** (books with `matchTier === "want_to_read"`): green left-border on each card, green "On your list!" badge. These are the hero results — "this person owns a book you want to read!"
- **Priority Section 2: "New Books"** (books with `matchTier === "other"`): standard styling, these are the main "add" candidates
- **Priority Section 3: "Already in Library"** (books with `matchTier === "already_owned"`): collapsed by default behind a toggle button "Show N already owned". Muted text styling when expanded
- **Each book card** uses the same visual layout as SearchPage results: cover thumbnail (w-16 h-24 rounded-md bg-muted), title (font-serif font-medium), authors, year/pages metadata row. Action: `DropdownMenu` with "Want to Read", "Currently Reading", "Read" options. Already-added books show disabled "Added" button with Check icon
- "Scan Again" button at the bottom — resets everything to `idle` state

---

## Implementation Notes

1. **Cost math:** Cloud Vision is ~$1.50/1,000 images. A 30-second scan at 2-second intervals = 15 frames ≈ $0.02/scan. The 2-second interval + brightness gate + 1280px resize are the main cost controls.

2. **The hardest problem** is OCR fragment clustering — grouping disconnected words into "this is one book spine." The 80px x-proximity threshold is a starting point tuned for typical phone photos at arm's length. It may need adjustment; consider making it proportional to image width.

3. **Short titles** ("IT", "Dune", "1984") will produce noisy matches. The short-text penalty in `scoreMatch` helps but expect some false positives. Acceptable for v1 — users dismiss wrong matches easily.

4. **Don't refactor the existing `searchGoogleBooks()` in routes.ts.** The book matcher needs its own version because it uses different parameters (maxResults=3 vs 20, different query construction). Keep them separate.

5. **Body size limit is the #1 gotcha.** A 1280px JPEG at 70% quality is 200KB–800KB as base64. Without the `limit: "10mb"` change in `server/index.ts`, every frame POST returns a silent 413 error.

6. **Camera permissions on iOS:** Safari requires HTTPS for `getUserMedia`. Replit's dev URL uses HTTPS, so this works. `facingMode: "environment"` gives the rear camera on phones; falls back to front camera on desktop (fine for testing).

7. **Don't add new routes to App.tsx.** The `/scan` route already exists and renders `<ScanPage />` inside `<AuthGuard>` + `<AppShell>`. You're just replacing the component contents.

8. **Stale closure fix:** The frame capture interval runs in a `setInterval`, so it won't see updated React state. Use `detectedMapRef` (a `useRef` holding a `Map<string, DetectedBook>`) as the source of truth during scanning, then sync to `setDetectedBooks` state for rendering.

9. **Deduplication:** The same book will appear across multiple frames as the user pans. `detectedMapRef` keyed by `googleBooksId` handles this — same book = same key = no duplicate. Only update if the new confidence score is higher.

10. **The existing `POST /api/library`** endpoint returns 409 if the book is already in the user's library. Catch this gracefully in the results page — show "Already in library" rather than an error toast.

---

## What This Does NOT Include (saved for later)

- ISBN barcode scanning (not needed at this time)
- AI recommendations based on scan results (Phase 1c)
- Social features / sharing scan results
- Scan history page (the `scanSessions` table supports this but no UI yet)
- Offline frame queueing (frames are dropped if offline)
