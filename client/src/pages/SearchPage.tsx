import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Search, Plus, Check, BookOpen, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { BookCardSkeleton } from "@/components/common/LoadingSkeleton";
import type { Book } from "@shared/schema";

interface SearchResult {
  id: string;
  title: string;
  authors: string[];
  publishedDate?: string;
  pageCount?: number;
  coverImageUrl?: string;
  description?: string;
  isbn13?: string;
  isbn10?: string;
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [addedBooks, setAddedBooks] = useState<Set<string>>(new Set());
  const [addingBook, setAddingBook] = useState<string | null>(null);
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const searchBooks = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/books/search?q=${encodeURIComponent(q)}`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setResults(data.results || []);
      }
    } catch {
      toast({ title: "Search failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim()) searchBooks(query.trim());
      else setResults([]);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, searchBooks]);

  const addToLibrary = async (book: SearchResult, status: string) => {
    setAddingBook(book.id);
    try {
      await apiRequest("POST", "/api/library", {
        bookData: {
          openLibraryKey: book.id,
          title: book.title,
          authors: book.authors,
          publishedDate: book.publishedDate,
          pageCount: book.pageCount,
          coverImageUrl: book.coverImageUrl,
          description: book.description,
          isbn13: book.isbn13,
          isbn10: book.isbn10,
        },
        status,
        source: "search",
      });
      setAddedBooks((prev) => new Set(prev).add(book.id));
      queryClient.invalidateQueries({ queryKey: ["/api/library"] });
      toast({ title: "Added to library!" });
    } catch (err: any) {
      toast({ title: "Failed to add", description: err.message, variant: "destructive" });
    } finally {
      setAddingBook(null);
    }
  };

  return (
    <div className="px-4 py-6" data-testid="search-page">
      <h1 className="text-xl font-bold font-serif mb-4">Search Books</h1>
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search by title, author, or ISBN..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
          data-testid="input-search"
          autoFocus
        />
      </div>

      {loading && (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <BookCardSkeleton />
            </div>
          ))}
        </div>
      )}

      {!loading && results.length === 0 && query.length >= 2 && (
        <div className="flex flex-col items-center py-12 text-center">
          <BookOpen className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No books found for "{query}"</p>
        </div>
      )}

      {!loading && !query && (
        <div className="flex flex-col items-center py-12 text-center">
          <Search className="w-10 h-10 text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">Search for books to add to your library</p>
        </div>
      )}

      <div className="space-y-3">
        {results.map((book) => {
          const isAdded = addedBooks.has(book.id);
          const isAdding = addingBook === book.id;

          return (
            <Card key={book.id} className="hover-elevate" data-testid={`search-result-${book.id}`}>
              <CardContent className="flex gap-3 p-3">
                <div className="w-16 h-24 rounded-md bg-muted flex-shrink-0 overflow-hidden">
                  {book.coverImageUrl ? (
                    <img
                      src={book.coverImageUrl}
                      alt={book.title}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <BookOpen className="w-6 h-6 text-muted-foreground/40" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3
                    className="font-medium text-sm leading-tight line-clamp-2 font-serif cursor-pointer"
                    data-testid={`text-search-title-${book.id}`}
                  >
                    {book.title}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                    {book.authors?.join(", ") || "Unknown Author"}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                    {book.publishedDate && <span>{book.publishedDate.slice(0, 4)}</span>}
                    {book.pageCount && <span>{book.pageCount} pages</span>}
                  </div>
                  <div className="mt-2">
                    {isAdded ? (
                      <Button size="sm" variant="secondary" disabled data-testid={`button-added-${book.id}`}>
                        <Check className="w-3 h-3 mr-1" /> Added
                      </Button>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" disabled={isAdding} data-testid={`button-add-${book.id}`}>
                            {isAdding ? (
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            ) : (
                              <Plus className="w-3 h-3 mr-1" />
                            )}
                            Add to Library
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuItem onClick={() => addToLibrary(book, "want_to_read")} data-testid="menu-want-to-read">
                            Want to Read
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => addToLibrary(book, "currently_reading")} data-testid="menu-currently-reading">
                            Currently Reading
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => addToLibrary(book, "read")} data-testid="menu-read">
                            Read
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
