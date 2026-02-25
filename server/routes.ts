import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { supabaseAdmin } from "./supabase";
import { extractTextFromImage } from "./vision";
import { matchBooksFromOCR } from "./bookMatcher";
import { embedBook, embedMissingBooks, findSimilarBooks } from "./embeddings";
import { generateRecommendations } from "./recommendations";
import multer from "multer";
import { processGoodreadsImport } from "./goodreadsImport";
import { db } from "./db";
import { scanSessions, scanResults, recommendations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { log } from "./index";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      supabaseUserId?: string;
    }
  }
}

async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ message: "Invalid token" });
    }

    req.supabaseUserId = user.id;

    const appUser = await storage.getUserBySupabaseId(user.id);
    if (appUser) {
      req.userId = appUser.id;
    }

    next();
  } catch (err: any) {
    log(`Auth error: ${err.message}`);
    return res.status(401).json({ message: "Authentication failed" });
  }
}

function requireAppUser(req: Request, res: Response, next: NextFunction) {
  if (!req.userId) {
    return res.status(403).json({ message: "User profile not found. Please complete signup." });
  }
  next();
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

async function searchGoogleBooks(query: string) {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
  const baseUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=20`;
  const url = apiKey ? `${baseUrl}&key=${apiKey}` : baseUrl;

  const res = await fetch(url);
  if (!res.ok) {
    log(`Google Books API error: ${res.status} ${res.statusText}`);
    return [];
  }
  const data = await res.json();

  return (data.items || []).map((item: any) => {
    const info = item.volumeInfo || {};
    const identifiers = info.industryIdentifiers || [];
    let coverUrl = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || null;
    if (coverUrl) {
      coverUrl = coverUrl.replace("http://", "https://").replace("&edge=curl", "");
    }

    return {
      id: item.id,
      title: info.title || "Untitled",
      subtitle: info.subtitle,
      authors: info.authors || ["Unknown Author"],
      publishedDate: info.publishedDate,
      pageCount: info.pageCount,
      coverImageUrl: coverUrl,
      description: info.description,
      isbn13: identifiers.find((i: any) => i.type === "ISBN_13")?.identifier,
      isbn10: identifiers.find((i: any) => i.type === "ISBN_10")?.identifier,
      categories: info.categories,
      publisher: info.publisher,
      averageRating: info.averageRating,
      language: info.language,
    };
  });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.post("/api/auth/signup", requireAuth, async (req: Request, res: Response) => {
    try {
      const { email, username, displayName } = req.body;
      if (!email || !username) {
        return res.status(400).json({ message: "Email and username are required" });
      }

      const existingUser = await storage.getUserBySupabaseId(req.supabaseUserId!);
      if (existingUser) {
        const { password: _, ...safeUser } = existingUser;
        return res.json({ user: safeUser });
      }

      const existingUsername = await storage.getUserByUsername(username);
      if (existingUsername) {
        return res.status(409).json({ message: "Username already taken" });
      }

      const user = await storage.createUser({
        email,
        username,
        password: "supabase-managed",
        displayName: displayName || username,
        supabaseUserId: req.supabaseUserId!,
      });

      await storage.createCollection({
        userId: user.id,
        name: "Favorites",
        description: "Your favorite books",
        isPublic: true,
        sortOrder: 0,
      });

      req.userId = user.id;
      const { password: _, ...safeUser } = user;
      res.status(201).json({ user: safeUser });
    } catch (err: any) {
      log(`Signup error: ${err.message}`);
      res.status(500).json({ message: "Failed to create account" });
    }
  });

  app.get("/api/auth/me", requireAuth, async (req: Request, res: Response) => {
    if (!req.userId) {
      return res.status(404).json({ message: "Profile not found", needsProfile: true });
    }
    const user = await storage.getUser(req.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    const { password: _, ...safeUser } = user;
    res.json({ user: safeUser });
  });

  app.get("/api/books/search", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const q = req.query.q as string;
      if (!q || q.length < 2) {
        return res.json({ results: [] });
      }
      const results = await searchGoogleBooks(q);
      res.json({ results });
    } catch (err: any) {
      log(`Search error: ${err.message}`);
      res.status(500).json({ message: "Search failed" });
    }
  });

  app.post("/api/library", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const { bookData, status, source } = req.body;
      if (!bookData || !status) {
        return res.status(400).json({ message: "Book data and status are required" });
      }

      const book = await storage.upsertBook({
        googleBooksId: bookData.googleBooksId || bookData.id,
        openLibraryKey: bookData.openLibraryKey,
        title: bookData.title,
        authors: bookData.authors || ["Unknown Author"],
        subtitle: bookData.subtitle,
        publishedDate: bookData.publishedDate,
        pageCount: bookData.pageCount,
        coverImageUrl: bookData.coverImageUrl,
        description: bookData.description,
        isbn13: bookData.isbn13,
        isbn10: bookData.isbn10,
        categories: bookData.categories,
        publisher: bookData.publisher,
        averageRating: bookData.averageRating?.toString(),
        language: bookData.language,
      });

      const userBook = await storage.addUserBook({
        userId: req.userId!,
        bookId: book.id,
        status,
        source: source || "search",
        startDate: status === "currently_reading" ? new Date().toISOString().split("T")[0] : undefined,
      });

      res.status(201).json({ userBook, book });

      embedBook(book.id).catch((err) => log(`Background embed error: ${err.message}`));

    } catch (err: any) {
      if (err.message?.includes("duplicate") || err.code === "23505") {
        return res.status(409).json({ message: "Book already in your library" });
      }
      log(`Add to library error: ${err.message}`);
      res.status(500).json({ message: "Failed to add book" });
    }
  });

  app.get("/api/library", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const books = await storage.getUserBooks(req.userId!);
      res.json({ books });
    } catch (err: any) {
      log(`Get library error: ${err.message}`);
      res.status(500).json({ message: "Failed to get library" });
    }
  });

  app.get("/api/library/:id", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const userBook = await storage.getUserBook(req.params.id, req.userId!);
      if (!userBook) {
        return res.status(404).json({ message: "Book not found in library" });
      }
      res.json({ userBook });
    } catch (err: any) {
      log(`Get user book error: ${err.message}`);
      res.status(500).json({ message: "Failed to get book" });
    }
  });

  app.patch("/api/library/:id", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const userBook = await storage.updateUserBook(req.params.id, req.userId!, req.body);
      if (!userBook) {
        return res.status(404).json({ message: "Book not found" });
      }
      res.json({ userBook });
    } catch (err: any) {
      log(`Update user book error: ${err.message}`);
      res.status(500).json({ message: "Failed to update book" });
    }
  });

  app.delete("/api/library/:id", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const deleted = await storage.deleteUserBook(req.params.id, req.userId!);
      if (!deleted) {
        return res.status(404).json({ message: "Book not found" });
      }
      res.json({ ok: true });
    } catch (err: any) {
      log(`Delete user book error: ${err.message}`);
      res.status(500).json({ message: "Failed to remove book" });
    }
  });

  app.get("/api/collections", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const collections = await storage.getCollections(req.userId!);
      res.json({ collections });
    } catch (err: any) {
      log(`Get collections error: ${err.message}`);
      res.status(500).json({ message: "Failed to get collections" });
    }
  });

  app.get("/api/collections/:id", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const collection = await storage.getCollection(req.params.id, req.userId!);
      if (!collection) {
        return res.status(404).json({ message: "Collection not found" });
      }
      const books = await storage.getCollectionBooks(collection.id);
      res.json({ collection, books });
    } catch (err: any) {
      log(`Get collection error: ${err.message}`);
      res.status(500).json({ message: "Failed to get collection" });
    }
  });

  app.post("/api/collections", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const { name, description } = req.body;
      if (!name) {
        return res.status(400).json({ message: "Collection name is required" });
      }
      const collection = await storage.createCollection({
        userId: req.userId!,
        name,
        description,
      });
      res.status(201).json({ collection });
    } catch (err: any) {
      log(`Create collection error: ${err.message}`);
      res.status(500).json({ message: "Failed to create collection" });
    }
  });

  app.patch("/api/collections/:id", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const collection = await storage.updateCollection(req.params.id, req.userId!, req.body);
      if (!collection) {
        return res.status(404).json({ message: "Collection not found" });
      }
      res.json({ collection });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to update collection" });
    }
  });

  app.delete("/api/collections/:id", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const deleted = await storage.deleteCollection(req.params.id, req.userId!);
      if (!deleted) {
        return res.status(404).json({ message: "Collection not found" });
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to delete collection" });
    }
  });

  app.post("/api/collections/:id/books", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const collection = await storage.getCollection(req.params.id, req.userId!);
      if (!collection) {
        return res.status(404).json({ message: "Collection not found" });
      }
      await storage.addBookToCollection(collection.id, req.body.bookId);
      res.status(201).json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to add book to collection" });
    }
  });

  app.delete("/api/collections/:id/books/:bookId", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const collection = await storage.getCollection(req.params.id, req.userId!);
      if (!collection) {
        return res.status(404).json({ message: "Collection not found" });
      }
      await storage.removeBookFromCollection(collection.id, req.params.bookId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to remove book from collection" });
    }
  });

  app.get("/api/profile", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    const user = await storage.getUser(req.userId!);
    if (!user) return res.status(404).json({ message: "User not found" });
    const { password: _, ...safeUser } = user;
    res.json({ user: safeUser });
  });

  app.patch("/api/profile", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const user = await storage.updateUser(req.userId!, req.body);
      if (!user) return res.status(404).json({ message: "User not found" });
      const { password: _, ...safeUser } = user;
      res.json({ user: safeUser });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  app.post("/api/scan/frame", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const { image } = req.body;
      if (!image) {
        return res.status(400).json({ message: "Image data is required" });
      }

      const ocrResult = await extractTextFromImage(image);
      if (ocrResult.fragments.length === 0) {
        return res.json({ matches: [], fragmentCount: 0 });
      }

      const matchResults = await matchBooksFromOCR(ocrResult.fragments);

      const userLibrary = await storage.getUserBooks(req.userId!);
      const libraryMap = new Map<string, string>();
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
        fullText: ocrResult.fullText.slice(0, 500),
      });
    } catch (err: any) {
      log(`Scan frame error: ${err.message}`);
      res.status(500).json({ message: "Failed to process frame" });
    }
  });

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

  app.get("/api/recommendations", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const recs = await generateRecommendations(req.userId!);
      res.json({ recommendations: recs });
    } catch (err: any) {
      log(`Get recommendations error: ${err.message}`);
      res.status(500).json({ message: "Failed to get recommendations" });
    }
  });

  app.post("/api/recommendations/refresh", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      await embedMissingBooks();
      const recs = await generateRecommendations(req.userId!, true);
      res.json({ recommendations: recs });
    } catch (err: any) {
      log(`Refresh recommendations error: ${err.message}`);
      res.status(500).json({ message: "Failed to refresh recommendations" });
    }
  });

  app.post("/api/recommendations/:id/feedback", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const { feedback } = req.body;
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

  app.get("/api/books/:bookId/similar", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const { bookId } = req.params;
      const limit = parseInt(req.query.limit as string) || 5;

      await embedBook(bookId);

      const userLibrary = await storage.getUserBooks(req.userId!);
      const ownedBookIds = userLibrary.map((ub) => ub.bookId);

      const similar = await findSimilarBooks(bookId, limit, ownedBookIds);

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

  app.post("/api/embeddings/generate", requireAuth, requireAppUser, async (req: Request, res: Response) => {
    try {
      const count = await embedMissingBooks();
      res.json({ embedded: count });
    } catch (err: any) {
      log(`Embedding generation error: ${err.message}`);
      res.status(500).json({ message: "Failed to generate embeddings" });
    }
  });

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

        const firstLine = csvContent.split("\n")[0] || "";
        if (!firstLine.includes("Title") || !firstLine.includes("Author")) {
          return res.status(400).json({
            message:
              "This doesn't look like a Goodreads export CSV. Expected columns: Title, Author, ISBN, etc.",
          });
        }

        const importRecord = await storage.createGoodreadsImport(req.userId!);

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

  return httpServer;
}
