import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { supabaseAdmin } from "./supabase";
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

  return httpServer;
}
