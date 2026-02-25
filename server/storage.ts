import { db } from "./db";
import { eq, and, sql, desc, asc, ilike } from "drizzle-orm";
import {
  users,
  books,
  userBooks,
  collections,
  collectionBooks,
  type User,
  type InsertUser,
  type Book,
  type InsertBook,
  type UserBook,
  type InsertUserBook,
  type Collection,
  type InsertCollection,
  type UserBookWithBook,
  type CollectionWithCount,
} from "@shared/schema";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswords(supplied: string, stored: string): Promise<boolean> {
  const [hashed, salt] = stored.split(".");
  const buf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(Buffer.from(hashed, "hex"), buf);
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, data: Partial<User>): Promise<User | undefined>;
  verifyPassword(email: string, password: string): Promise<User | null>;

  getBook(id: string): Promise<Book | undefined>;
  getBookByOpenLibraryKey(key: string): Promise<Book | undefined>;
  upsertBook(data: InsertBook): Promise<Book>;

  getUserBooks(userId: string): Promise<UserBookWithBook[]>;
  getUserBook(id: string, userId: string): Promise<UserBookWithBook | undefined>;
  addUserBook(data: InsertUserBook): Promise<UserBook>;
  updateUserBook(id: string, userId: string, data: Partial<UserBook>): Promise<UserBook | undefined>;
  deleteUserBook(id: string, userId: string): Promise<boolean>;

  getCollections(userId: string): Promise<CollectionWithCount[]>;
  getCollection(id: string, userId: string): Promise<Collection | undefined>;
  getCollectionBooks(collectionId: string): Promise<Book[]>;
  createCollection(data: InsertCollection): Promise<Collection>;
  updateCollection(id: string, userId: string, data: Partial<Collection>): Promise<Collection | undefined>;
  deleteCollection(id: string, userId: string): Promise<boolean>;
  addBookToCollection(collectionId: string, bookId: string): Promise<void>;
  removeBookFromCollection(collectionId: string, bookId: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(data: InsertUser): Promise<User> {
    const hashedPassword = await hashPassword(data.password);
    const [user] = await db.insert(users).values({ ...data, password: hashedPassword }).returning();
    return user;
  }

  async updateUser(id: string, data: Partial<User>): Promise<User | undefined> {
    const { id: _, password, ...updateData } = data as any;
    const [user] = await db.update(users).set({ ...updateData, updatedAt: new Date() }).where(eq(users.id, id)).returning();
    return user;
  }

  async verifyPassword(email: string, password: string): Promise<User | null> {
    const user = await this.getUserByEmail(email);
    if (!user) return null;
    const valid = await comparePasswords(password, user.password);
    return valid ? user : null;
  }

  async getBook(id: string): Promise<Book | undefined> {
    const [book] = await db.select().from(books).where(eq(books.id, id));
    return book;
  }

  async getBookByOpenLibraryKey(key: string): Promise<Book | undefined> {
    const [book] = await db.select().from(books).where(eq(books.openLibraryKey, key));
    return book;
  }

  async upsertBook(data: InsertBook): Promise<Book> {
    if (data.openLibraryKey) {
      const existing = await this.getBookByOpenLibraryKey(data.openLibraryKey);
      if (existing) return existing;
    }
    const [book] = await db.insert(books).values(data).returning();
    return book;
  }

  async getUserBooks(userId: string): Promise<UserBookWithBook[]> {
    const results = await db
      .select()
      .from(userBooks)
      .innerJoin(books, eq(userBooks.bookId, books.id))
      .where(eq(userBooks.userId, userId))
      .orderBy(desc(userBooks.dateAdded));

    return results.map((r) => ({
      ...r.user_books,
      book: r.books,
    }));
  }

  async getUserBook(id: string, userId: string): Promise<UserBookWithBook | undefined> {
    const [result] = await db
      .select()
      .from(userBooks)
      .innerJoin(books, eq(userBooks.bookId, books.id))
      .where(and(eq(userBooks.id, id), eq(userBooks.userId, userId)));

    if (!result) return undefined;
    return { ...result.user_books, book: result.books };
  }

  async addUserBook(data: InsertUserBook): Promise<UserBook> {
    const [userBook] = await db.insert(userBooks).values(data).returning();
    return userBook;
  }

  async updateUserBook(id: string, userId: string, data: Partial<UserBook>): Promise<UserBook | undefined> {
    const { id: _, userId: __, bookId, ...updateData } = data as any;
    const [userBook] = await db
      .update(userBooks)
      .set({ ...updateData, updatedAt: new Date() })
      .where(and(eq(userBooks.id, id), eq(userBooks.userId, userId)))
      .returning();
    return userBook;
  }

  async deleteUserBook(id: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(userBooks)
      .where(and(eq(userBooks.id, id), eq(userBooks.userId, userId)))
      .returning();
    return result.length > 0;
  }

  async getCollections(userId: string): Promise<CollectionWithCount[]> {
    const cols = await db
      .select()
      .from(collections)
      .where(eq(collections.userId, userId))
      .orderBy(asc(collections.sortOrder));

    const result: CollectionWithCount[] = [];
    for (const col of cols) {
      const [count] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(collectionBooks)
        .where(eq(collectionBooks.collectionId, col.id));
      result.push({ ...col, bookCount: count?.count || 0 });
    }
    return result;
  }

  async getCollection(id: string, userId: string): Promise<Collection | undefined> {
    const [col] = await db
      .select()
      .from(collections)
      .where(and(eq(collections.id, id), eq(collections.userId, userId)));
    return col;
  }

  async getCollectionBooks(collectionId: string): Promise<Book[]> {
    const results = await db
      .select({ book: books })
      .from(collectionBooks)
      .innerJoin(books, eq(collectionBooks.bookId, books.id))
      .where(eq(collectionBooks.collectionId, collectionId))
      .orderBy(asc(collectionBooks.sortOrder));
    return results.map((r) => r.book);
  }

  async createCollection(data: InsertCollection): Promise<Collection> {
    const [col] = await db.insert(collections).values(data).returning();
    return col;
  }

  async updateCollection(id: string, userId: string, data: Partial<Collection>): Promise<Collection | undefined> {
    const { id: _, ...updateData } = data as any;
    const [col] = await db
      .update(collections)
      .set(updateData)
      .where(and(eq(collections.id, id), eq(collections.userId, userId)))
      .returning();
    return col;
  }

  async deleteCollection(id: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(collections)
      .where(and(eq(collections.id, id), eq(collections.userId, userId)))
      .returning();
    return result.length > 0;
  }

  async addBookToCollection(collectionId: string, bookId: string): Promise<void> {
    await db.insert(collectionBooks).values({ collectionId, bookId }).onConflictDoNothing();
  }

  async removeBookFromCollection(collectionId: string, bookId: string): Promise<void> {
    await db
      .delete(collectionBooks)
      .where(and(eq(collectionBooks.collectionId, collectionId), eq(collectionBooks.bookId, bookId)));
  }
}

export const storage = new DatabaseStorage();
