# Spined — Book Discovery & Library Management

## Overview
Spined is a mobile-first book discovery and library management PWA. Users can search for books, manage their reading library, track reading progress, create collections, and get personalized recommendations.

**Tagline:** "See a shelf. Know what to read."

## Tech Stack
- **Frontend:** React 18 + TypeScript + Vite, Tailwind CSS + shadcn/ui, Zustand (auth state), wouter (routing), TanStack Query (data fetching)
- **Backend:** Express.js + TypeScript
- **Database:** PostgreSQL via Drizzle ORM (Replit-hosted)
- **Auth:** Supabase Auth (email/password + Google OAuth). Frontend uses `@supabase/supabase-js`, backend verifies JWTs via `supabaseAdmin.auth.getUser(token)`
- **Book Data:** Google Books API (requires `GOOGLE_BOOKS_API_KEY` secret)

## Environment Secrets
- `VITE_SUPABASE_URL` — Supabase project URL (used by frontend)
- `VITE_SUPABASE_ANON_KEY` — Supabase anonymous key (used by frontend)
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (used by backend for JWT verification)
- `GOOGLE_BOOKS_API_KEY` — Google Books API key (used by backend for book search)
- `OPENAI_API_KEY` — OpenAI API key (used for embeddings + recommendation reasoning)
- `DATABASE_URL` — PostgreSQL connection string (Replit-managed)

## Auth Architecture
1. Frontend calls `supabase.auth.signInWithPassword()` or `supabase.auth.signUp()` or `supabase.auth.signInWithOAuth({ provider: "google" })`
2. Supabase returns a JWT access token
3. Frontend stores the token in Zustand auth store
4. All API requests include `Authorization: Bearer <token>` header
5. Backend middleware calls `supabaseAdmin.auth.getUser(token)` to verify and extract the Supabase user ID
6. Backend maps `supabaseUserId` to local `users` table via `users.supabase_user_id` column
7. On first login (after signup or OAuth), backend creates a local user profile via `POST /api/auth/signup`

## Project Structure
```
client/src/
  App.tsx              # Main app with routing, auth guard, Supabase auth state listener
  lib/supabase.ts      # Supabase client initialization
  lib/queryClient.ts   # TanStack Query client with auth header injection
  hooks/useAuth.ts     # Zustand-based auth store + Supabase auth hooks
  components/
    layout/            # AppShell, BottomNav
    library/           # BookCard, StatusBadge
    common/            # StarRating, EmptyState, LoadingSkeleton
  pages/
    HomePage.tsx       # Dashboard with currently reading, queue, goals
    SearchPage.tsx     # Book search via Google Books API
    LibraryPage.tsx    # Book library with filters, sort, search
    BookDetailPage.tsx # Full book detail with rating, review, status
    ProfilePage.tsx    # User profile with reading stats
    SettingsPage.tsx   # Profile editing, reading goal
    ScanPage.tsx       # Camera shelf scanning (Cloud Vision OCR)
    DiscoverPage.tsx   # AI-powered recommendations (OpenAI embeddings + GPT-4o-mini)
    CollectionPage.tsx # Collection detail view
    LoginPage.tsx      # Email/password + Google OAuth login
    SignupPage.tsx     # Account creation

server/
  index.ts             # Express entry
  routes.ts            # All API routes (auth, books, library, collections, recommendations)
  supabase.ts          # Supabase admin client (service role key)
  storage.ts           # Database storage layer (IStorage interface)
  db.ts                # Drizzle ORM connection
  embeddings.ts        # OpenAI embedding generation + pgvector similarity search
  recommendations.ts   # GPT-4o-mini recommendation engine
  vision.ts            # Google Cloud Vision OCR
  bookMatcher.ts       # OCR text → book fuzzy matching
  seed.ts              # Legacy demo data seeding

shared/
  schema.ts            # Drizzle schema + Zod types for all models
```

## Database Schema
- **users** — Profile (supabaseUserId, email, username, password, displayName, bio, readingGoal)
- **books** — Canonical book records (googleBooksId, openLibraryKey, title, authors, cover, page count, etc.)
- **user_books** — User-book junction (status, rating, review, progress, dates)
- **collections** — User-defined book lists
- **collection_books** — Collection-book junction
- **goodreads_imports** — Import tracking (stub for future)
- **recommendations** — AI-generated book recommendations per user (reason, relevanceScore, feedback, sourceBookIds)

## Key Features
1. **Auth** — Supabase email/password + Google OAuth with automatic profile creation
2. **Book Search** — Google Books API search with debounced autocomplete
3. **Personal Library** — Grid view with status filters (Reading/Want to Read/Read/DNF), sorting, search
4. **Book Detail** — Rating (half-star), review, status, progress tracking, favorites, physical location
5. **Collections** — Custom book lists, displayed as horizontal cards on library page
6. **Home Dashboard** — Currently reading with progress, reading queue, reading goal, quick actions
7. **Profile** — Reading stats, settings link, logout

## Design
- Primary color: Indigo (#6366f1)
- Fonts: Inter (UI), Lora (serif headings)
- Mobile-first layout with bottom tab navigation
- Max-width container (max-w-lg) centered on larger screens

## Shelf Scanner (Phase 1b)
- Camera captures frames every 2 seconds
- Each frame is sent to Google Cloud Vision API for OCR text detection
- OCR fragments are clustered by x-position (vertical strips = book spines)
- Each cluster is fuzzy-matched against Google Books API
- Scoring: 70% title similarity (Levenshtein) + 30% author match
- Results classified: "want_to_read" (on your list), "already_owned", or "other" (new)
- Brightness gate skips too-dark/washed-out frames
- Deduplication via googleBooksId across frames
- Server files: `server/vision.ts`, `server/bookMatcher.ts`
- DB tables: `scan_sessions`, `scan_results`
- JSON body limit increased to 10MB for base64 frame data

## AI Recommendations (Phase 1c)
- **Embeddings:** OpenAI `text-embedding-3-small` (1536-dim vectors) stored in pgvector `embedding` column on `books` table
- **Embedding column** is NOT in Drizzle schema (pgvector not natively supported) — uses raw SQL via `db.execute(sql\`...\`)`
- **Recommendation pipeline:** Load user's top-rated/read books → vector similarity search (cosine distance) → GPT-4o-mini re-ranking with personalized explanations → save to `recommendations` table
- **Caching:** Recommendations served from DB until user taps "Refresh" or manually triggers `POST /api/recommendations/refresh`
- **Feedback:** Users can like/dismiss recommendations via `POST /api/recommendations/:id/feedback`
- **"More Like This":** Book detail page shows similar books via embedding cosine similarity
- **Background embedding:** Books are auto-embedded when added to library (fire-and-forget)
- **Batch embedding:** `POST /api/embeddings/generate` embeds all unembedded books (up to 100 per call)
- Server files: `server/embeddings.ts`, `server/recommendations.ts`
- DB: `recommendations` table, `embedding` vector(1536) column on `books`, IVFFlat index
