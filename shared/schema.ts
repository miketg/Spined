import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  numeric,
  date,
  uuid,
  uniqueIndex,
  index,
  primaryKey,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  bio: text("bio"),
  readingGoal: integer("reading_goal"),
  preferredPace: text("preferred_pace"),
  isPublic: boolean("is_public").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const books = pgTable("books", {
  id: uuid("id").primaryKey().defaultRandom(),
  googleBooksId: text("google_books_id").unique(),
  openLibraryKey: text("open_library_key"),
  isbn10: text("isbn10"),
  isbn13: text("isbn13"),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  authors: text("authors").array().notNull(),
  publisher: text("publisher"),
  publishedDate: text("published_date"),
  description: text("description"),
  pageCount: integer("page_count"),
  categories: text("categories").array(),
  coverImageUrl: text("cover_image_url"),
  averageRating: numeric("average_rating", { precision: 3, scale: 2 }),
  language: text("language"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userBooks = pgTable(
  "user_books",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    bookId: uuid("book_id")
      .references(() => books.id, { onDelete: "cascade" })
      .notNull(),
    status: text("status").notNull(),
    userRating: numeric("user_rating", { precision: 2, scale: 1 }),
    userReview: text("user_review"),
    startDate: date("start_date"),
    finishDate: date("finish_date"),
    currentPage: integer("current_page"),
    dateAdded: timestamp("date_added").defaultNow(),
    source: text("source"),
    isFavorite: boolean("is_favorite").default(false),
    physicalLocation: text("physical_location"),
    queuePosition: integer("queue_position"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("user_book_unique").on(table.userId, table.bookId),
    index("idx_user_books_user_id").on(table.userId),
    index("idx_user_books_status").on(table.userId, table.status),
  ]
);

export const collections = pgTable("collections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  description: text("description"),
  isPublic: boolean("is_public").default(true),
  sortOrder: integer("sort_order"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const collectionBooks = pgTable(
  "collection_books",
  {
    collectionId: uuid("collection_id")
      .references(() => collections.id, { onDelete: "cascade" })
      .notNull(),
    bookId: uuid("book_id")
      .references(() => books.id, { onDelete: "cascade" })
      .notNull(),
    sortOrder: integer("sort_order"),
    addedAt: timestamp("added_at").defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.collectionId, table.bookId] }),
  ]
);

export const goodreadsImports = pgTable("goodreads_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  status: text("status").default("pending"),
  totalRows: integer("total_rows"),
  booksMatched: integer("books_matched").default(0),
  booksUnmatched: integer("books_unmatched").default(0),
  unmatchedData: jsonb("unmatched_data"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBookSchema = createInsertSchema(books).omit({
  id: true,
  createdAt: true,
});

export const insertUserBookSchema = createInsertSchema(userBooks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  dateAdded: true,
});

export const insertCollectionSchema = createInsertSchema(collections).omit({
  id: true,
  createdAt: true,
});

export const insertCollectionBookSchema = createInsertSchema(collectionBooks).omit({
  addedAt: true,
});

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Book = typeof books.$inferSelect;
export type InsertBook = z.infer<typeof insertBookSchema>;
export type UserBook = typeof userBooks.$inferSelect;
export type InsertUserBook = z.infer<typeof insertUserBookSchema>;
export type Collection = typeof collections.$inferSelect;
export type InsertCollection = z.infer<typeof insertCollectionSchema>;
export type CollectionBook = typeof collectionBooks.$inferSelect;
export type InsertCollectionBook = z.infer<typeof insertCollectionBookSchema>;
export type GoodreadsImport = typeof goodreadsImports.$inferSelect;

export type UserBookWithBook = UserBook & { book: Book };
export type CollectionWithCount = Collection & { bookCount: number };
