# Spined — Replit Scaffold Prompt

Build "Spined" — an AI-powered book discovery and library management PWA. Users scan bookshelves with their phone camera to identify books, manage their reading library, get AI recommendations, and connect with friends.

**Tagline:** "See a shelf. Know what to read."

This prompt covers Phase 0 (project scaffold) and Phase 1a (core library). We'll add scanning, recommendations, and social features in follow-up phases.

---

## Tech Stack (use exactly these)

**Frontend:**
- React 18 + TypeScript + Vite
- Tailwind CSS + shadcn/ui components
- Zustand for state management
- vite-plugin-pwa for PWA support
- Lucide React for icons
- React Router v6 for routing

**Backend:**
- Node.js + Express with TypeScript
- Supabase client SDK (@supabase/supabase-js)

**Database & Auth:**
- Supabase (PostgreSQL + Auth + Storage)
- Supabase Auth (email/password + Google OAuth)

**External APIs (wire up the service layer, use env vars — we'll add keys later):**
- Google Books API (book search + metadata)
- Open Library API (fallback book data)
- Google Cloud Vision API (OCR — Phase 1b, stub for now)
- Anthropic Claude API (recommendations — Phase 1c, stub for now)

---

## Project Structure

```
spined/
├── client/                    # React frontend
│   ├── public/
│   │   ├── icons/             # PWA icons (placeholder)
│   │   └── manifest.json
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/            # shadcn/ui components
│   │   │   ├── layout/        # Shell, BottomNav, Header
│   │   │   ├── library/       # BookCard, BookGrid, BookList, StatusBadge
│   │   │   ├── book/          # BookDetail, BookSearch, BookSearchResult
│   │   │   ├── collections/   # CollectionCard, CollectionGrid
│   │   │   ├── import/        # GoodreadsImport, ImportProgress
│   │   │   └── common/        # Loading, EmptyState, ErrorBoundary
│   │   ├── pages/
│   │   │   ├── HomePage.tsx
│   │   │   ├── ScanPage.tsx           # Placeholder for Phase 1b
│   │   │   ├── LibraryPage.tsx
│   │   │   ├── DiscoverPage.tsx       # Placeholder for Phase 1c
│   │   │   ├── ProfilePage.tsx
│   │   │   ├── BookDetailPage.tsx
│   │   │   ├── SearchPage.tsx
│   │   │   ├── CollectionPage.tsx
│   │   │   ├── ImportPage.tsx
│   │   │   ├── SettingsPage.tsx
│   │   │   ├── LoginPage.tsx
│   │   │   └── SignupPage.tsx
│   │   ├── hooks/
│   │   │   ├── useAuth.ts
│   │   │   ├── useLibrary.ts
│   │   │   ├── useBookSearch.ts
│   │   │   ├── useCollections.ts
│   │   │   └── useImport.ts
│   │   ├── stores/
│   │   │   ├── authStore.ts
│   │   │   ├── libraryStore.ts
│   │   │   └── uiStore.ts
│   │   ├── services/
│   │   │   ├── supabase.ts        # Supabase client init
│   │   │   ├── googleBooks.ts     # Google Books API client
│   │   │   ├── openLibrary.ts     # Open Library fallback
│   │   │   ├── scanner.ts         # Stub for Phase 1b
│   │   │   └── recommendations.ts # Stub for Phase 1c
│   │   ├── types/
│   │   │   ├── book.ts
│   │   │   ├── user.ts
│   │   │   ├── library.ts
│   │   │   └── collection.ts
│   │   ├── lib/
│   │   │   └── utils.ts
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.css
│   ├── index.html
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── vite.config.ts
├── server/                    # Express backend
│   ├── src/
│   │   ├── routes/
│   │   │   ├── auth.ts
│   │   │   ├── books.ts
│   │   │   ├── library.ts
│   │   │   ├── collections.ts
│   │   │   ├── import.ts
│   │   │   ├── scan.ts            # Stub for Phase 1b
│   │   │   └── recommendations.ts # Stub for Phase 1c
│   │   ├── middleware/
│   │   │   ├── auth.ts            # Supabase JWT verification
│   │   │   └── errorHandler.ts
│   │   ├── services/
│   │   │   ├── googleBooks.ts
│   │   │   ├── openLibrary.ts
│   │   │   ├── goodreadsImport.ts
│   │   │   ├── scanner.ts         # Stub
│   │   │   └── recommendations.ts # Stub
│   │   ├── types/
│   │   │   └── index.ts
│   │   └── index.ts               # Express app entry
│   └── tsconfig.json
├── shared/                    # Shared types between client/server
│   └── types.ts
├── .env.example
├── package.json
└── README.md
```

---

## Environment Variables (.env.example)

```
# Supabase
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Google Books API
GOOGLE_BOOKS_API_KEY=your_google_books_key

# Google Cloud Vision (Phase 1b — leave blank for now)
GOOGLE_CLOUD_VISION_API_KEY=

# Anthropic Claude (Phase 1c — leave blank for now)
ANTHROPIC_API_KEY=

# OpenAI Embeddings (Phase 1c — leave blank for now)
OPENAI_API_KEY=
```

---

## Database Schema (Run in Supabase SQL Editor)

Create these tables for Phase 1a. The schema is designed to support the full app — social, clubs, challenges, embeddings will use this same foundation.

```sql
-- ============================================
-- SPINED DATABASE SCHEMA — Phase 1a (Core)
-- ============================================

-- Users (extends Supabase auth.users)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  reading_goal INTEGER,
  preferred_pace TEXT CHECK (preferred_pace IN ('quick', 'moderate', 'deep')),
  is_public BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Books (canonical book records — one row per unique book)
CREATE TABLE books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_books_id TEXT UNIQUE,
  isbn10 TEXT,
  isbn13 TEXT,
  title TEXT NOT NULL,
  subtitle TEXT,
  authors TEXT[] NOT NULL,
  publisher TEXT,
  published_date TEXT,
  description TEXT,
  page_count INTEGER,
  categories TEXT[],
  cover_image_url TEXT,
  average_rating NUMERIC(3,2),
  language TEXT,
  series_name TEXT,
  series_position NUMERIC(5,1),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User's books (the core junction table — each row = one user's relationship to one book)
CREATE TABLE user_books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  book_id UUID REFERENCES books(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('want_to_read', 'currently_reading', 'read', 'did_not_finish')),
  user_rating NUMERIC(2,1) CHECK (user_rating >= 1 AND user_rating <= 5),
  user_review TEXT,
  start_date DATE,
  finish_date DATE,
  current_page INTEGER,
  date_added TIMESTAMPTZ DEFAULT NOW(),
  source TEXT CHECK (source IN ('scan', 'barcode', 'search', 'recommendation', 'friend', 'manual', 'import')),
  is_favorite BOOLEAN DEFAULT FALSE,
  physical_location TEXT,
  is_public BOOLEAN DEFAULT TRUE,
  queue_position INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, book_id)
);

-- Collections (user-defined shelves/lists)
CREATE TABLE collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_public BOOLEAN DEFAULT TRUE,
  sort_order INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE collection_books (
  collection_id UUID REFERENCES collections(id) ON DELETE CASCADE,
  book_id UUID REFERENCES books(id) ON DELETE CASCADE,
  sort_order INTEGER,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (collection_id, book_id)
);

-- Goodreads Import tracking
CREATE TABLE goodreads_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  total_rows INTEGER,
  books_matched INTEGER DEFAULT 0,
  books_unmatched INTEGER DEFAULT 0,
  unmatched_data JSONB,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_user_books_user_id ON user_books(user_id);
CREATE INDEX idx_user_books_status ON user_books(user_id, status);
CREATE INDEX idx_books_google_id ON books(google_books_id);
CREATE INDEX idx_books_isbn13 ON books(isbn13);
CREATE INDEX idx_books_title ON books USING gin(to_tsvector('english', title));

-- Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE goodreads_imports ENABLE ROW LEVEL SECURITY;

-- Users can read their own data
CREATE POLICY "Users can view own profile" ON users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON users FOR UPDATE USING (auth.uid() = id);

-- User books policies
CREATE POLICY "Users can view own books" ON user_books FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own books" ON user_books FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own books" ON user_books FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own books" ON user_books FOR DELETE USING (auth.uid() = user_id);

-- Books table is readable by all authenticated users
ALTER TABLE books ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Books are readable by all" ON books FOR SELECT TO authenticated USING (true);
CREATE POLICY "Books can be inserted by authenticated" ON books FOR INSERT TO authenticated WITH CHECK (true);

-- Collections policies
CREATE POLICY "Users can manage own collections" ON collections FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own collection books" ON collection_books FOR ALL
  USING (EXISTS (SELECT 1 FROM collections WHERE id = collection_id AND user_id = auth.uid()));

-- Import policies
CREATE POLICY "Users can manage own imports" ON goodreads_imports FOR ALL USING (auth.uid() = user_id);
```

---

## Phase 1a Features to Build NOW

### 1. Auth (Login / Signup / Logout)
- Supabase Auth with email/password
- Google OAuth sign-in button
- On first login, auto-create a row in the `users` table with email and a generated username
- Protected routes: redirect to /login if not authenticated
- Persist session across page refreshes

### 2. Book Search
- Search bar on the Search page with autocomplete-as-you-type (debounced 300ms)
- Calls Google Books API: `https://www.googleapis.com/books/v1/volumes?q={query}&key={API_KEY}&maxResults=20`
- Display results as cards: cover image, title, author(s), page count, published year
- Tap a result → BookDetailPage with full info
- "Add to Library" button on each result with status picker dropdown (Want to Read / Currently Reading / Read)
- When adding: upsert book into `books` table (match on google_books_id), then insert into `user_books`

### 3. Personal Library
- Library page shows all user's books in a responsive grid (cover images)
- Filter tabs at top: All | Want to Read | Currently Reading | Read | DNF
- Sort options: Date Added, Title, Author, Rating
- Search within library (client-side filter)
- Tap a book → BookDetailPage showing:
  - Cover, title, author, description, page count, genres
  - User's reading status (editable dropdown)
  - User's rating (1-5 stars, half-star increments, tap to rate)
  - User's review (expandable text area, save on blur)
  - Start/finish dates
  - Current page (for "Currently Reading")
  - Physical location field
  - "Remove from Library" with confirmation
  - "Add to Collection" picker
  - Favorite toggle (heart icon)
- Empty state: friendly illustration + "Search for books or scan a shelf to get started"

### 4. Collections
- Create custom collections with name + optional description
- View collections as cards on Library page (horizontal scroll section above the book grid)
- Add/remove books from collections
- Default collections auto-created on signup: "Favorites" (auto-populated from favorites)

### 5. Reading Queue
- "Want to Read" books can be drag-and-drop reordered into a prioritized queue
- "Start Reading" button on top queue item → moves to Currently Reading with today as start_date

### 6. Goodreads CSV Import
- Settings → Import Library → "Import from Goodreads"
- File upload input accepting .csv files
- Parse CSV on the server (columns: Title, Author, ISBN13, ISBN, My Rating, Date Read, Date Added, Bookshelves, Exclusive Shelf)
- Map "Exclusive Shelf" to status: "read" → read, "currently-reading" → currently_reading, "to-read" → want_to_read
- For each row: search Google Books API by ISBN13 first, then ISBN10, then title+author
- Track progress in `goodreads_imports` table, return job ID to client
- Client polls for progress every 2 seconds
- Show results: "Imported X books. Y could not be matched."
- Unmatched books shown in a list with manual search+add option

### 7. Home Page
- "Continue Reading" card: shows currently reading book(s) with cover, title, progress bar (current_page / page_count)
- "Reading Queue" preview: next 3 books from Want to Read queue
- Quick action buttons: "Search Books", "Scan Shelf" (disabled badge: "Coming Soon"), "Import Library"
- Reading goal progress (if set): "12 of 24 books in 2026" with progress bar

---

## PWA Configuration

Set up vite-plugin-pwa with this manifest:

```json
{
  "name": "Spined",
  "short_name": "Spined",
  "description": "Scan shelves. Discover books. Track your reading.",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#6366f1",
  "orientation": "portrait-primary",
  "icons": [
    { "src": "/icons/192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/512.png", "sizes": "512x512", "type": "image/png" }
  ],
  "categories": ["books", "education", "social"]
}
```

- Register service worker for offline caching of static assets and book cover images
- Add install prompt banner detection (beforeinstallprompt event)

---

## Design System

**Colors (Tailwind config):**
- Primary: Indigo `#6366f1` (indigo-500) — buttons, links, active states
- Secondary: Amber `#f59e0b` (amber-500) — highlights, badges, recommendations
- Success: Emerald `#10b981` (emerald-500) — "Want to Read" indicators
- Background: Warm white `#fafaf9` (stone-50)
- Surface: White `#ffffff` for cards
- Text: Stone-900 for primary text, Stone-500 for secondary

**Typography:**
- UI text: Inter (import from Google Fonts)
- Book titles / reading contexts: Literata (import from Google Fonts)

**Icons:** Lucide React — use consistently throughout

**Layout:**
- Bottom tab navigation (5 tabs): Home, Scan, Library, Discover, Profile
- Scan tab is center, elevated/highlighted (primary CTA)
- Scan and Discover tabs show "Coming Soon" badge overlay for now
- Mobile-first responsive design, max-width 480px for phone optimization
- Cards use rounded-xl with subtle shadow-sm

---

## API Endpoints to Implement (Phase 1a)

All endpoints prefixed with `/api`. Auth middleware verifies Supabase JWT on protected routes.

```
POST   /api/auth/signup              → Supabase auth signup + create users row
POST   /api/auth/login               → Supabase auth login
POST   /api/auth/logout              → Supabase auth logout
GET    /api/auth/me                  → Get current user profile

GET    /api/books/search?q={query}   → Proxy to Google Books API
GET    /api/books/:googleBooksId     → Get or create book in local DB

POST   /api/library                  → Add book to user's library
GET    /api/library                  → Get user's library (?status=read&sort=date_added&order=desc)
PATCH  /api/library/:userBookId      → Update status, rating, review, page, location, favorite
DELETE /api/library/:userBookId      → Remove from library

GET    /api/library/queue            → Get reading queue (want_to_read, ordered by queue_position)
PATCH  /api/library/queue/reorder    → Reorder queue (body: { bookIds: string[] })

POST   /api/collections              → Create collection
GET    /api/collections              → List user's collections (with book count)
PATCH  /api/collections/:id          → Update collection name/description
DELETE /api/collections/:id          → Delete collection
POST   /api/collections/:id/books    → Add book to collection
DELETE /api/collections/:id/books/:bookId → Remove book from collection

POST   /api/import/goodreads         → Upload CSV, start import job
GET    /api/import/:jobId            → Get import job status + progress
GET    /api/import/:jobId/unmatched  → Get unmatched books
POST   /api/import/:jobId/resolve    → Manually resolve unmatched book

GET    /api/profile                  → Get own profile
PATCH  /api/profile                  → Update display name, bio, reading goal, avatar, preferences
```

---

## Important Implementation Notes

1. **Monorepo structure:** Use a single package.json at root with workspaces, or a simple shared folder. Replit should serve the Express backend which also serves the built Vite frontend in production.

2. **Dev mode:** Run Vite dev server (port 5173) and Express (port 3001) concurrently. Vite proxies /api requests to Express.

3. **Google Books API:** Always check if a book already exists in the `books` table (by google_books_id) before inserting. Upsert pattern.

4. **Book covers:** Google Books returns `imageLinks.thumbnail` — replace `http://` with `https://` and remove `&edge=curl` parameter for clean images. If no cover from Google Books, try Open Library: `https://covers.openlibrary.org/b/isbn/{isbn}-M.jpg`

5. **Rating system:** Half-star increments (1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5). Use a tappable star component.

6. **Responsive but mobile-first:** This is a phone app. Design for 375px-428px width first. Desktop is secondary.

7. **Stubs for future phases:** Create the route files and page components for Scan, Discover, and Recommendations but render a "Coming Soon" placeholder with a brief description of what's coming.

8. **Error handling:** Use a global error boundary. Toast notifications for actions (book added, rating saved, import started). Loading skeletons for async data.

9. **iOS PWA compatibility:** Include proper meta tags for iOS:
```html
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Spined">
<link rel="apple-touch-icon" href="/icons/192.png">
```

10. **Supabase client-side:** Use the Supabase JS client directly from the frontend for auth and real-time subscriptions. Use the Express backend for Google Books API calls (to protect API keys) and complex operations like Goodreads import.

---

## What NOT to Build Yet (Future Phases)

- ❌ Camera scanning (Phase 1b)
- ❌ AI recommendations (Phase 1c)
- ❌ Social features — friends, follows, activity feed (Phase 2)
- ❌ Reviews as public social objects (Phase 2)
- ❌ Book clubs (Phase 2)
- ❌ Challenges, streaks, badges (Phase 3)
- ❌ Year in Review (Phase 3)
- ❌ Vector embeddings / pgvector (Phase 1c)

Just create stub pages/routes for these so the navigation structure is complete.

---

Build this step by step. Start with project setup and auth, then book search, then library CRUD, then collections, then import. Test each piece before moving on.
