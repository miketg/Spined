import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Compass,
  RefreshCw,
  BookOpen,
  Plus,
  Check,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  Sparkles,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { motion, AnimatePresence } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";

interface RecBook {
  id: string;
  bookId: string;
  googleBooksId: string;
  reason: string;
  relevanceScore: number;
  feedback: string | null;
  book: {
    id: string;
    googleBooksId: string | null;
    title: string;
    subtitle?: string | null;
    authors: string[];
    publishedDate?: string | null;
    pageCount?: number | null;
    coverImageUrl?: string | null;
    description?: string | null;
    isbn13?: string | null;
    isbn10?: string | null;
    categories?: string[] | null;
    publisher?: string | null;
    averageRating?: string | null;
    language?: string | null;
  };
}

export default function DiscoverPage() {
  const { toast } = useToast();
  const [addedBooks, setAddedBooks] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useQuery<{ recommendations: RecBook[] }>({
    queryKey: ["/api/recommendations"],
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/recommendations/refresh");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] });
      toast({ title: "Recommendations refreshed!" });
    },
    onError: (err: any) => {
      toast({ title: "Refresh failed", description: err.message, variant: "destructive" });
    },
  });

  const sendFeedback = async (recId: string, feedback: "liked" | "not_interested") => {
    try {
      await apiRequest("POST", `/api/recommendations/${recId}/feedback`, { feedback });
      queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] });
      if (feedback === "not_interested") {
        toast({ title: "Dismissed" });
      } else {
        toast({ title: "Thanks for the feedback!" });
      }
    } catch {
      toast({ title: "Feedback failed", variant: "destructive" });
    }
  };

  const addToLibrary = async (rec: RecBook, status: string) => {
    try {
      await apiRequest("POST", "/api/library", {
        bookData: {
          googleBooksId: rec.book.googleBooksId,
          title: rec.book.title,
          subtitle: rec.book.subtitle,
          authors: rec.book.authors,
          publishedDate: rec.book.publishedDate,
          pageCount: rec.book.pageCount,
          coverImageUrl: rec.book.coverImageUrl,
          description: rec.book.description,
          isbn13: rec.book.isbn13,
          isbn10: rec.book.isbn10,
          categories: rec.book.categories,
          publisher: rec.book.publisher,
          averageRating: rec.book.averageRating,
          language: rec.book.language,
        },
        status,
        source: "recommendation",
      });
      setAddedBooks((prev) => new Set(prev).add(rec.bookId));
      queryClient.invalidateQueries({ queryKey: ["/api/library"] });
      toast({ title: `Added "${rec.book.title}"` });
    } catch (err: any) {
      if (err.message?.includes("409")) {
        toast({ title: "Already in your library" });
        setAddedBooks((prev) => new Set(prev).add(rec.bookId));
      } else {
        toast({ title: "Failed to add", description: err.message, variant: "destructive" });
      }
    }
  };

  const recommendations = data?.recommendations?.filter((r) => r.feedback !== "not_interested") || [];

  if (isLoading) {
    return (
      <div className="px-4 py-6" data-testid="discover-page">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold font-serif">Discover</h1>
            <p className="text-xs text-muted-foreground">Personalized picks based on your library</p>
          </div>
        </div>
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-3 flex gap-3">
                <Skeleton className="w-16 h-24 rounded-md flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-12 w-full rounded-lg" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!data?.recommendations || data.recommendations.length === 0) {
    return (
      <div className="px-4 py-6 flex flex-col items-center justify-center min-h-[70vh]" data-testid="discover-page">
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Sparkles className="w-9 h-9 text-primary" />
        </div>
        <h1 className="text-xl font-bold font-serif mb-2">Discover Books</h1>
        <p className="text-sm text-muted-foreground text-center max-w-[280px] mb-2">
          Add some books to your library first to get personalized recommendations.
        </p>
        <p className="text-xs text-muted-foreground text-center max-w-[280px] mb-6">
          Rate your books to get better recommendations.
        </p>
        <Link href="/search">
          <Button data-testid="button-build-library">
            <BookOpen className="w-4 h-4 mr-2" />
            Build Your Library
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 pb-24" data-testid="discover-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold font-serif">Discover</h1>
          <p className="text-xs text-muted-foreground">Personalized picks based on your library</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          data-testid="button-refresh-recommendations"
        >
          <RefreshCw className={`w-4 h-4 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {refreshMutation.isPending && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4 bg-muted/50 rounded-lg p-3">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Generating recommendations... this may take a moment</span>
        </div>
      )}

      <AnimatePresence mode="popLayout">
        <div className="space-y-3">
          {recommendations.map((rec) => {
            const isAdded = addedBooks.has(rec.bookId);
            return (
              <motion.div
                key={rec.id}
                layout
                initial={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -300, transition: { duration: 0.3 } }}
              >
                <Card>
                  <CardContent className="p-3">
                    <div className="flex gap-3">
                      <div className="w-16 h-24 rounded-md bg-muted overflow-hidden flex-shrink-0">
                        {rec.book.coverImageUrl ? (
                          <img
                            src={rec.book.coverImageUrl}
                            alt={rec.book.title}
                            className="w-full h-full object-cover"
                            data-testid={`img-cover-${rec.id}`}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <BookOpen className="w-4 h-4 text-muted-foreground/40" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3
                          className="text-sm font-medium font-serif line-clamp-2 leading-tight"
                          data-testid={`text-rec-title-${rec.id}`}
                        >
                          {rec.book.title}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {rec.book.authors?.join(", ")}
                        </p>
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                          {rec.book.publishedDate && (
                            <span>{rec.book.publishedDate.slice(0, 4)}</span>
                          )}
                          {rec.book.pageCount && <span>{rec.book.pageCount}p</span>}
                          {rec.relevanceScore && (
                            <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">
                              {rec.relevanceScore}% match
                            </span>
                          )}
                        </div>

                        <div className="mt-2 bg-primary/5 rounded-lg p-2 flex gap-1.5">
                          <Sparkles className="w-3 h-3 text-amber-500 flex-shrink-0 mt-0.5" />
                          <p className="text-[11px] text-muted-foreground italic leading-relaxed">
                            {rec.reason}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 mt-2">
                          {isAdded ? (
                            <Button size="sm" variant="ghost" disabled className="h-7 text-xs" data-testid={`button-added-${rec.id}`}>
                              <Check className="w-3 h-3 mr-1" /> Added
                            </Button>
                          ) : (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="outline" className="h-7 text-xs" data-testid={`button-add-${rec.id}`}>
                                  <Plus className="w-3 h-3 mr-1" /> Add
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start">
                                <DropdownMenuItem onClick={() => addToLibrary(rec, "want_to_read")} data-testid="menu-want-to-read">
                                  Want to Read
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => addToLibrary(rec, "currently_reading")} data-testid="menu-currently-reading">
                                  Currently Reading
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => addToLibrary(rec, "read")} data-testid="menu-read">
                                  Read
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => sendFeedback(rec.id, "liked")}
                            data-testid={`button-like-${rec.id}`}
                          >
                            <ThumbsUp className={`w-3 h-3 ${rec.feedback === "liked" ? "text-primary fill-primary" : "text-muted-foreground"}`} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => sendFeedback(rec.id, "not_interested")}
                            data-testid={`button-dismiss-${rec.id}`}
                          >
                            <ThumbsDown className="w-3 h-3 text-muted-foreground" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </AnimatePresence>

      <div className="mt-6 flex justify-center">
        <Button
          variant="outline"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          data-testid="button-refresh-bottom"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
          Refresh Recommendations
        </Button>
      </div>
    </div>
  );
}
