import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import { storage } from "./storage";
import { log } from "./index";

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
}

async function searchOpenLibrary(query: string) {
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=20&fields=key,title,author_name,first_publish_year,number_of_pages_median,cover_i,isbn,subject,publisher`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();

  return (data.docs || []).map((doc: any) => ({
    id: doc.key?.replace("/works/", ""),
    title: doc.title || "Untitled",
    authors: doc.author_name || ["Unknown Author"],
    publishedDate: doc.first_publish_year?.toString(),
    pageCount: doc.number_of_pages_median,
    coverImageUrl: doc.cover_i
      ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
      : null,
    isbn13: doc.isbn?.find((i: string) => i.length === 13),
    isbn10: doc.isbn?.find((i: string) => i.length === 10),
    categories: doc.subject?.slice(0, 5),
  }));
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "spined-session-secret-dev",
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        sameSite: "lax",
      },
    })
  );

  app.post("/api/auth/signup", async (req: Request, res: Response) => {
    try {
      const { email, username, password, displayName } = req.body;
      if (!email || !username || !password) {
        return res.status(400).json({ message: "Email, username and password are required" });
      }

      const existingEmail = await storage.getUserByEmail(email);
      if (existingEmail) {
        return res.status(409).json({ message: "Email already in use" });
      }

      const existingUsername = await storage.getUserByUsername(username);
      if (existingUsername) {
        return res.status(409).json({ message: "Username already taken" });
      }

      const user = await storage.createUser({
        email,
        username,
        password,
        displayName: displayName || username,
      });

      await storage.createCollection({
        userId: user.id,
        name: "Favorites",
        description: "Your favorite books",
        isPublic: true,
        sortOrder: 0,
      });

      req.session.userId = user.id;
      const { password: _, ...safeUser } = user;
      res.status(201).json({ user: safeUser });
    } catch (err: any) {
      log(`Signup error: ${err.message}`);
      res.status(500).json({ message: "Failed to create account" });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      const user = await storage.verifyPassword(email, password);
      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      req.session.userId = user.id;
      const { password: _, ...safeUser } = user;
      res.json({ user: safeUser });
    } catch (err: any) {
      log(`Login error: ${err.message}`);
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }
    const { password: _, ...safeUser } = user;
    res.json({ user: safeUser });
  });

  app.get("/api/books/search", requireAuth, async (req: Request, res: Response) => {
    try {
      const q = req.query.q as string;
      if (!q || q.length < 2) {
        return res.json({ results: [] });
      }
      const results = await searchOpenLibrary(q);
      res.json({ results });
    } catch (err: any) {
      log(`Search error: ${err.message}`);
      res.status(500).json({ message: "Search failed" });
    }
  });

  app.post("/api/library", requireAuth, async (req: Request, res: Response) => {
    try {
      const { bookData, status, source } = req.body;
      if (!bookData || !status) {
        return res.status(400).json({ message: "Book data and status are required" });
      }

      const book = await storage.upsertBook({
        openLibraryKey: bookData.openLibraryKey,
        googleBooksId: bookData.googleBooksId,
        title: bookData.title,
        authors: bookData.authors || ["Unknown Author"],
        publishedDate: bookData.publishedDate,
        pageCount: bookData.pageCount,
        coverImageUrl: bookData.coverImageUrl,
        description: bookData.description,
        isbn13: bookData.isbn13,
        isbn10: bookData.isbn10,
        categories: bookData.categories,
      });

      const userBook = await storage.addUserBook({
        userId: req.session.userId!,
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

  app.get("/api/library", requireAuth, async (req: Request, res: Response) => {
    try {
      const books = await storage.getUserBooks(req.session.userId!);
      res.json({ books });
    } catch (err: any) {
      log(`Get library error: ${err.message}`);
      res.status(500).json({ message: "Failed to get library" });
    }
  });

  app.get("/api/library/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userBook = await storage.getUserBook(req.params.id, req.session.userId!);
      if (!userBook) {
        return res.status(404).json({ message: "Book not found in library" });
      }
      res.json({ userBook });
    } catch (err: any) {
      log(`Get user book error: ${err.message}`);
      res.status(500).json({ message: "Failed to get book" });
    }
  });

  app.patch("/api/library/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userBook = await storage.updateUserBook(req.params.id, req.session.userId!, req.body);
      if (!userBook) {
        return res.status(404).json({ message: "Book not found" });
      }
      res.json({ userBook });
    } catch (err: any) {
      log(`Update user book error: ${err.message}`);
      res.status(500).json({ message: "Failed to update book" });
    }
  });

  app.delete("/api/library/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const deleted = await storage.deleteUserBook(req.params.id, req.session.userId!);
      if (!deleted) {
        return res.status(404).json({ message: "Book not found" });
      }
      res.json({ ok: true });
    } catch (err: any) {
      log(`Delete user book error: ${err.message}`);
      res.status(500).json({ message: "Failed to remove book" });
    }
  });

  app.get("/api/collections", requireAuth, async (req: Request, res: Response) => {
    try {
      const collections = await storage.getCollections(req.session.userId!);
      res.json({ collections });
    } catch (err: any) {
      log(`Get collections error: ${err.message}`);
      res.status(500).json({ message: "Failed to get collections" });
    }
  });

  app.get("/api/collections/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const collection = await storage.getCollection(req.params.id, req.session.userId!);
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

  app.post("/api/collections", requireAuth, async (req: Request, res: Response) => {
    try {
      const { name, description } = req.body;
      if (!name) {
        return res.status(400).json({ message: "Collection name is required" });
      }
      const collection = await storage.createCollection({
        userId: req.session.userId!,
        name,
        description,
      });
      res.status(201).json({ collection });
    } catch (err: any) {
      log(`Create collection error: ${err.message}`);
      res.status(500).json({ message: "Failed to create collection" });
    }
  });

  app.patch("/api/collections/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const collection = await storage.updateCollection(req.params.id, req.session.userId!, req.body);
      if (!collection) {
        return res.status(404).json({ message: "Collection not found" });
      }
      res.json({ collection });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to update collection" });
    }
  });

  app.delete("/api/collections/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const deleted = await storage.deleteCollection(req.params.id, req.session.userId!);
      if (!deleted) {
        return res.status(404).json({ message: "Collection not found" });
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to delete collection" });
    }
  });

  app.post("/api/collections/:id/books", requireAuth, async (req: Request, res: Response) => {
    try {
      const collection = await storage.getCollection(req.params.id, req.session.userId!);
      if (!collection) {
        return res.status(404).json({ message: "Collection not found" });
      }
      await storage.addBookToCollection(collection.id, req.body.bookId);
      res.status(201).json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to add book to collection" });
    }
  });

  app.delete("/api/collections/:id/books/:bookId", requireAuth, async (req: Request, res: Response) => {
    try {
      const collection = await storage.getCollection(req.params.id, req.session.userId!);
      if (!collection) {
        return res.status(404).json({ message: "Collection not found" });
      }
      await storage.removeBookFromCollection(collection.id, req.params.bookId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to remove book from collection" });
    }
  });

  app.get("/api/profile", requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUser(req.session.userId!);
    if (!user) return res.status(404).json({ message: "User not found" });
    const { password: _, ...safeUser } = user;
    res.json({ user: safeUser });
  });

  app.patch("/api/profile", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.updateUser(req.session.userId!, req.body);
      if (!user) return res.status(404).json({ message: "User not found" });
      const { password: _, ...safeUser } = user;
      res.json({ user: safeUser });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  return httpServer;
}
