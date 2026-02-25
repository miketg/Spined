import { db } from "./db";
import { users, books, userBooks, collections, collectionBooks } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

export async function seedDatabase() {
  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, "demo@spined.app"));

  if (existingUser) {
    return;
  }

  const hashedPassword = await hashPassword("demo123");

  const [demoUser] = await db
    .insert(users)
    .values({
      email: "demo@spined.app",
      username: "booklover",
      password: hashedPassword,
      displayName: "Alex Reader",
      bio: "Avid reader, coffee enthusiast, and lifelong learner.",
      readingGoal: 24,
      isPublic: true,
    })
    .returning();

  const seedBooks = [
    {
      openLibraryKey: "OL45883W",
      title: "Project Hail Mary",
      authors: ["Andy Weir"],
      publishedDate: "2021",
      pageCount: 476,
      coverImageUrl: "https://covers.openlibrary.org/b/id/10539416-M.jpg",
      description: "Ryland Grace is the sole survivor on a desperate, last-chance mission—and if he fails, humanity and the Earth itself are finished.",
      categories: ["Science Fiction", "Adventure"],
      isbn13: "9780593135204",
    },
    {
      openLibraryKey: "OL82563W",
      title: "Atomic Habits",
      authors: ["James Clear"],
      publishedDate: "2018",
      pageCount: 320,
      coverImageUrl: "https://covers.openlibrary.org/b/id/10958382-M.jpg",
      description: "An Easy & Proven Way to Build Good Habits & Break Bad Ones.",
      categories: ["Self-Help", "Psychology"],
      isbn13: "9780735211292",
    },
    {
      openLibraryKey: "OL27448W",
      title: "Dune",
      authors: ["Frank Herbert"],
      publishedDate: "1965",
      pageCount: 688,
      coverImageUrl: "https://covers.openlibrary.org/b/id/11153085-M.jpg",
      description: "Set on the desert planet Arrakis, Dune is the story of the boy Paul Atreides, heir to a noble family tasked with ruling an inhospitable world.",
      categories: ["Science Fiction", "Fantasy"],
      isbn13: "9780441013593",
    },
    {
      openLibraryKey: "OL17930368W",
      title: "The Midnight Library",
      authors: ["Matt Haig"],
      publishedDate: "2020",
      pageCount: 304,
      coverImageUrl: "https://covers.openlibrary.org/b/id/10389354-M.jpg",
      description: "Between life and death there is a library, and within that library, the shelves go on forever.",
      categories: ["Fiction", "Fantasy"],
      isbn13: "9780525559474",
    },
    {
      openLibraryKey: "OL5735363W",
      title: "Sapiens: A Brief History of Humankind",
      authors: ["Yuval Noah Harari"],
      publishedDate: "2011",
      pageCount: 443,
      coverImageUrl: "https://covers.openlibrary.org/b/id/8409965-M.jpg",
      description: "A groundbreaking narrative of humanity's creation and evolution.",
      categories: ["History", "Non-Fiction"],
      isbn13: "9780062316097",
    },
    {
      openLibraryKey: "OL20930924W",
      title: "Klara and the Sun",
      authors: ["Kazuo Ishiguro"],
      publishedDate: "2021",
      pageCount: 303,
      coverImageUrl: "https://covers.openlibrary.org/b/id/10392674-M.jpg",
      description: "A magnificent new novel from the Nobel laureate Kazuo Ishiguro.",
      categories: ["Science Fiction", "Literary Fiction"],
      isbn13: "9780571364886",
    },
    {
      openLibraryKey: "OL82536W",
      title: "Educated",
      authors: ["Tara Westover"],
      publishedDate: "2018",
      pageCount: 334,
      coverImageUrl: "https://covers.openlibrary.org/b/id/8587047-M.jpg",
      description: "A memoir about a young girl who, kept out of school, leaves her survivalist family and goes on to earn a PhD from Cambridge University.",
      categories: ["Memoir", "Non-Fiction"],
      isbn13: "9780399590504",
    },
  ];

  const insertedBooks = [];
  for (const bookData of seedBooks) {
    const [book] = await db.insert(books).values(bookData).returning();
    insertedBooks.push(book);
  }

  const userBooksData = [
    { bookIndex: 0, status: "currently_reading", currentPage: 234, startDate: "2026-02-10", source: "search" },
    { bookIndex: 1, status: "read", userRating: "4.5", startDate: "2026-01-05", finishDate: "2026-01-20", source: "search", userReview: "Incredible book on habit formation. The 1% improvement concept changed how I think about progress." },
    { bookIndex: 2, status: "read", userRating: "5", startDate: "2025-12-01", finishDate: "2025-12-28", source: "search", isFavorite: true },
    { bookIndex: 3, status: "want_to_read", queuePosition: 1, source: "recommendation" },
    { bookIndex: 4, status: "read", userRating: "4", startDate: "2025-11-10", finishDate: "2025-12-05", source: "search" },
    { bookIndex: 5, status: "want_to_read", queuePosition: 2, source: "search" },
    { bookIndex: 6, status: "currently_reading", currentPage: 112, startDate: "2026-02-18", source: "search" },
  ];

  for (const ubData of userBooksData) {
    await db.insert(userBooks).values({
      userId: demoUser.id,
      bookId: insertedBooks[ubData.bookIndex].id,
      status: ubData.status,
      currentPage: ubData.currentPage,
      startDate: ubData.startDate,
      finishDate: ubData.finishDate,
      source: ubData.source,
      userRating: ubData.userRating,
      userReview: ubData.userReview,
      isFavorite: ubData.isFavorite || false,
      queuePosition: ubData.queuePosition,
    });
  }

  const [favCollection] = await db
    .insert(collections)
    .values({
      userId: demoUser.id,
      name: "Favorites",
      description: "Your favorite books",
      sortOrder: 0,
    })
    .returning();

  const [scifiCollection] = await db
    .insert(collections)
    .values({
      userId: demoUser.id,
      name: "Sci-Fi Essentials",
      description: "Must-read science fiction",
      sortOrder: 1,
    })
    .returning();

  await db.insert(collectionBooks).values({ collectionId: favCollection.id, bookId: insertedBooks[2].id, sortOrder: 0 });
  await db.insert(collectionBooks).values({ collectionId: scifiCollection.id, bookId: insertedBooks[0].id, sortOrder: 0 });
  await db.insert(collectionBooks).values({ collectionId: scifiCollection.id, bookId: insertedBooks[2].id, sortOrder: 1 });
  await db.insert(collectionBooks).values({ collectionId: scifiCollection.id, bookId: insertedBooks[5].id, sortOrder: 2 });

  console.log("Seed data created successfully. Demo account: demo@spined.app / demo123");
}
