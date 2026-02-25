# Spined — Book Discovery & Library Management

## Overview
Spined is a mobile-first book discovery and library management PWA. Users can search for books, manage their reading library, track reading progress, create collections, and get personalized recommendations.

**Tagline:** "See a shelf. Know what to read."

## Tech Stack
- **Frontend:** React 18 + TypeScript + Vite, Tailwind CSS + shadcn/ui, Zustand (auth state), wouter (routing), TanStack Query (data fetching)
- **Backend:** Express.js + TypeScript
- **Database:** PostgreSQL via Drizzle ORM
- **Auth:** Session-based (express-session) with scrypt password hashing
- **Book Data:** Open Library API (free, no API key required)

## Project Structure
```
client/src/
  App.tsx              # Main app with routing and auth guard
  hooks/useAuth.ts     # Zustand-based auth store + hooks
  components/
    layout/            # AppShell, BottomNav
    library/           # BookCard, StatusBadge
    common/            # StarRating, EmptyState, LoadingSkeleton
  pages/
    HomePage.tsx       # Dashboard with currently reading, queue, goals
    SearchPage.tsx     # Book search via Open Library API
    LibraryPage.tsx    # Book library with filters, sort, search
    BookDetailPage.tsx # Full book detail with rating, review, status
    ProfilePage.tsx    # User profile with reading stats
    SettingsPage.tsx   # Profile editing, reading goal
    ScanPage.tsx       # Placeholder for camera scanning
    DiscoverPage.tsx   # Placeholder for AI recommendations
    CollectionPage.tsx # Collection detail view
    LoginPage.tsx      # Email/password login
    SignupPage.tsx     # Account creation

server/
  index.ts             # Express entry, seeds database
  routes.ts            # All API routes (auth, books, library, collections, profile)
  storage.ts           # Database storage layer (IStorage interface)
  db.ts                # Drizzle ORM connection
  seed.ts              # Demo data seeding

shared/
  schema.ts            # Drizzle schema + Zod types for all models
```

## Database Schema
- **users** — Auth + profile (email, username, password, displayName, bio, readingGoal)
- **books** — Canonical book records (title, authors, cover, page count, etc.)
- **user_books** — User-book junction (status, rating, review, progress, dates)
- **collections** — User-defined book lists
- **collection_books** — Collection-book junction
- **goodreads_imports** — Import tracking (stub for future)

## Key Features (Phase 1a - MVP)
1. **Auth** — Email/password signup/login with session persistence
2. **Book Search** — Open Library API search with debounced autocomplete
3. **Personal Library** — Grid view with status filters (Reading/Want to Read/Read/DNF), sorting, search
4. **Book Detail** — Rating (half-star), review, status, progress tracking, favorites, physical location
5. **Collections** — Custom book lists, displayed as horizontal cards on library page
6. **Home Dashboard** — Currently reading with progress, reading queue, reading goal, quick actions
7. **Profile** — Reading stats, settings link, logout

## Demo Account
- Email: `demo@spined.app`
- Password: `demo123`

## Design
- Primary color: Indigo (#6366f1)
- Fonts: Inter (UI), Lora (serif headings)
- Mobile-first layout with bottom tab navigation
- Max-width container (max-w-lg) centered on larger screens

## Stub Pages (Future Phases)
- **Scan** — Camera-based shelf scanning (Phase 1b)
- **Discover** — AI-powered recommendations (Phase 1c)
