import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch, Link } from "wouter";
import { Search, SlidersHorizontal, BookOpen, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BookCard } from "@/components/library/BookCard";
import { EmptyState } from "@/components/common/EmptyState";
import { BookGridSkeleton } from "@/components/common/LoadingSkeleton";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import type { UserBookWithBook, CollectionWithCount } from "@shared/schema";

const statuses = [
  { value: "all", label: "All" },
  { value: "currently_reading", label: "Reading" },
  { value: "want_to_read", label: "Want to Read" },
  { value: "read", label: "Read" },
  { value: "did_not_finish", label: "DNF" },
];

const sortOptions = [
  { value: "date_added", label: "Date Added" },
  { value: "title", label: "Title" },
  { value: "author", label: "Author" },
  { value: "rating", label: "Rating" },
];

export default function LibraryPage() {
  const searchParams = useSearch();
  const urlStatus = new URLSearchParams(searchParams).get("status") || "all";
  const [status, setStatus] = useState(urlStatus);
  const [sortBy, setSortBy] = useState("date_added");
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading } = useQuery<{ books: UserBookWithBook[] }>({
    queryKey: ["/api/library"],
  });

  const { data: collectionsData } = useQuery<{ collections: CollectionWithCount[] }>({
    queryKey: ["/api/collections"],
  });

  const filteredBooks = useMemo(() => {
    let books = data?.books || [];
    if (status !== "all") {
      books = books.filter((b) => b.status === status);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      books = books.filter(
        (b) =>
          b.book.title.toLowerCase().includes(q) ||
          b.book.authors?.some((a) => a.toLowerCase().includes(q))
      );
    }
    switch (sortBy) {
      case "title":
        books = [...books].sort((a, b) => a.book.title.localeCompare(b.book.title));
        break;
      case "author":
        books = [...books].sort((a, b) => (a.book.authors?.[0] || "").localeCompare(b.book.authors?.[0] || ""));
        break;
      case "rating":
        books = [...books].sort((a, b) => (Number(b.userRating) || 0) - (Number(a.userRating) || 0));
        break;
      default:
        books = [...books].sort(
          (a, b) => new Date(b.dateAdded || 0).getTime() - new Date(a.dateAdded || 0).getTime()
        );
    }
    return books;
  }, [data?.books, status, sortBy, searchQuery]);

  const collections = collectionsData?.collections || [];

  return (
    <div className="py-6" data-testid="library-page">
      <div className="px-4 flex items-center justify-between gap-2 mb-4">
        <h1 className="text-xl font-bold font-serif">Library</h1>
        <Link href="/search">
          <Button size="sm" data-testid="button-add-books">
            <Plus className="w-3.5 h-3.5 mr-1" /> Add
          </Button>
        </Link>
      </div>

      {collections.length > 0 && (
        <div className="mb-4">
          <ScrollArea className="w-full">
            <div className="flex gap-2.5 px-4 pb-2">
              {collections.map((col) => (
                <Link key={col.id} href={`/collection/${col.id}`}>
                  <div
                    className="flex-shrink-0 px-4 py-2.5 rounded-lg bg-card border border-card-border cursor-pointer hover-elevate"
                    data-testid={`collection-card-${col.id}`}
                  >
                    <p className="text-sm font-medium whitespace-nowrap">{col.name}</p>
                    <p className="text-[10px] text-muted-foreground">{col.bookCount} books</p>
                  </div>
                </Link>
              ))}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </div>
      )}

      <div className="px-4 mb-3">
        <Tabs value={status} onValueChange={setStatus}>
          <TabsList className="w-full">
            {statuses.map((s) => (
              <TabsTrigger key={s.value} value={s.value} className="flex-1 text-xs" data-testid={`tab-${s.value}`}>
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="px-4 flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search library..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-sm"
            data-testid="input-library-search"
          />
        </div>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-[130px] h-9" data-testid="select-sort">
            <SlidersHorizontal className="w-3.5 h-3.5 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sortOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} data-testid={`sort-${opt.value}`}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <BookGridSkeleton />
      ) : filteredBooks.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="w-7 h-7 text-muted-foreground" />}
          title={searchQuery ? "No matches" : "Your library is empty"}
          description={
            searchQuery
              ? "Try a different search term"
              : "Search for books or scan a shelf to get started"
          }
          actionLabel={searchQuery ? undefined : "Search Books"}
          actionHref={searchQuery ? undefined : "/search"}
        />
      ) : (
        <div className="grid grid-cols-3 gap-x-3 gap-y-5 px-4">
          {filteredBooks.map((ub) => (
            <BookCard key={ub.id} book={ub.book} userBook={ub} showFavorite />
          ))}
        </div>
      )}
    </div>
  );
}
