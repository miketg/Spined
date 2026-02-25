import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation, Link } from "wouter";
import {
  ArrowLeft,
  Heart,
  Trash2,
  BookOpen,
  Calendar,
  MapPin,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { StarRating } from "@/components/common/StarRating";
import { StatusBadge } from "@/components/library/StatusBadge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import type { UserBookWithBook, Book } from "@shared/schema";

export default function BookDetailPage() {
  const [, params] = useRoute("/book/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const id = params?.id;

  const { data, isLoading } = useQuery<{ userBook: UserBookWithBook }>({
    queryKey: ["/api/library", id],
    enabled: !!id,
  });

  const userBook = data?.userBook;
  const book = userBook?.book;

  const { data: similarData, isLoading: similarLoading } = useQuery<{
    books: Array<Book & { similarity: number }>;
  }>({
    queryKey: ["/api/books", userBook?.bookId, "similar"],
    enabled: !!userBook?.bookId,
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: Record<string, any>) => {
      await apiRequest("PATCH", `/api/library/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/library"] });
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/library/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library"] });
      toast({ title: "Removed from library" });
      navigate("/library");
    },
  });

  const handleStatusChange = (status: string) => {
    const updates: Record<string, any> = { status };
    if (status === "currently_reading" && !userBook?.startDate) {
      updates.startDate = new Date().toISOString().split("T")[0];
    }
    if (status === "read" && !userBook?.finishDate) {
      updates.finishDate = new Date().toISOString().split("T")[0];
    }
    updateMutation.mutate(updates);
    toast({ title: "Status updated" });
  };

  const handleRating = (rating: number) => {
    updateMutation.mutate({ userRating: rating.toString() });
    toast({ title: rating > 0 ? `Rated ${rating} stars` : "Rating removed" });
  };

  const handleFavorite = () => {
    updateMutation.mutate({ isFavorite: !userBook?.isFavorite });
  };

  if (isLoading) {
    return (
      <div className="px-4 py-6">
        <Skeleton className="h-8 w-32 mb-6" />
        <div className="flex gap-4">
          <Skeleton className="w-28 h-40 rounded-lg" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  if (!userBook || !book) {
    return (
      <div className="px-4 py-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} data-testid="button-back">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <div className="text-center py-12">
          <p className="text-muted-foreground">Book not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-6" data-testid="book-detail-page">
      <div className="px-4 py-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} data-testid="button-back">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
      </div>

      <div className="px-4 flex gap-4 mb-6">
        <div className="w-28 flex-shrink-0">
          <div className="aspect-[2/3] rounded-lg bg-muted overflow-hidden shadow-lg">
            {book.coverImageUrl ? (
              <img src={book.coverImageUrl} alt={book.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <BookOpen className="w-8 h-8 text-muted-foreground/40" />
              </div>
            )}
          </div>
        </div>
        <div className="flex-1 min-w-0 py-1">
          <h1 className="text-lg font-bold font-serif leading-tight mb-1" data-testid="text-book-title">
            {book.title}
          </h1>
          {book.subtitle && (
            <p className="text-xs text-muted-foreground mb-1">{book.subtitle}</p>
          )}
          <p className="text-sm text-muted-foreground mb-2" data-testid="text-book-author">
            {book.authors?.join(", ") || "Unknown Author"}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={userBook.status} />
            <button
              onClick={handleFavorite}
              className="p-1 rounded-full"
              data-testid="button-favorite"
            >
              <Heart
                className={`w-4 h-4 transition-colors ${
                  userBook.isFavorite
                    ? "fill-red-500 text-red-500"
                    : "text-muted-foreground"
                }`}
              />
            </button>
          </div>
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            {book.pageCount && <span>{book.pageCount} pages</span>}
            {book.publishedDate && <span>{book.publishedDate.slice(0, 4)}</span>}
            {book.language && <span className="uppercase">{book.language}</span>}
          </div>
        </div>
      </div>

      <div className="px-4 space-y-5">
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">Your Rating</Label>
          <StarRating
            rating={Number(userBook.userRating) || 0}
            size="lg"
            interactive
            onChange={handleRating}
          />
        </div>

        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">Reading Status</Label>
          <Select value={userBook.status} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-full" data-testid="select-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="want_to_read">Want to Read</SelectItem>
              <SelectItem value="currently_reading">Currently Reading</SelectItem>
              <SelectItem value="read">Read</SelectItem>
              <SelectItem value="did_not_finish">Did Not Finish</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {userBook.status === "currently_reading" && book.pageCount && (
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">
              Current Page (of {book.pageCount})
            </Label>
            <Input
              type="number"
              min={0}
              max={book.pageCount}
              value={userBook.currentPage || ""}
              placeholder="0"
              onChange={(e) => {
                const val = parseInt(e.target.value);
                if (!isNaN(val) && val >= 0 && val <= book.pageCount!) {
                  updateMutation.mutate({ currentPage: val });
                }
              }}
              data-testid="input-current-page"
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">
              <Calendar className="w-3 h-3 inline mr-1" />Start Date
            </Label>
            <Input
              type="date"
              value={userBook.startDate || ""}
              onChange={(e) => updateMutation.mutate({ startDate: e.target.value || null })}
              data-testid="input-start-date"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">
              <Calendar className="w-3 h-3 inline mr-1" />Finish Date
            </Label>
            <Input
              type="date"
              value={userBook.finishDate || ""}
              onChange={(e) => updateMutation.mutate({ finishDate: e.target.value || null })}
              data-testid="input-finish-date"
            />
          </div>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">
            <MapPin className="w-3 h-3 inline mr-1" />Physical Location
          </Label>
          <Input
            placeholder="e.g. Living room shelf, top row"
            value={userBook.physicalLocation || ""}
            onChange={(e) => updateMutation.mutate({ physicalLocation: e.target.value })}
            data-testid="input-location"
          />
        </div>

        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">Your Review</Label>
          <Textarea
            placeholder="What did you think of this book?"
            value={userBook.userReview || ""}
            className="min-h-[80px] text-sm"
            onBlur={(e) => {
              if (e.target.value !== (userBook.userReview || "")) {
                updateMutation.mutate({ userReview: e.target.value });
                toast({ title: "Review saved" });
              }
            }}
            data-testid="textarea-review"
          />
        </div>

        {book.categories && book.categories.length > 0 && (
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">Categories</Label>
            <div className="flex flex-wrap gap-1.5">
              {book.categories.map((cat) => (
                <span key={cat} className="text-xs bg-muted px-2 py-1 rounded-md">
                  {cat}
                </span>
              ))}
            </div>
          </div>
        )}

        {book.description && (
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">Description</Label>
            <p className="text-sm text-muted-foreground leading-relaxed line-clamp-6">
              {book.description.replace(/<[^>]*>/g, "")}
            </p>
          </div>
        )}

        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">More Like This</Label>
          {similarLoading ? (
            <div className="flex gap-2 overflow-x-auto pb-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="w-20 h-28 rounded-md flex-shrink-0" />
              ))}
            </div>
          ) : similarData?.books && similarData.books.length > 0 ? (
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
              {similarData.books.map((similar) => (
                <Link key={similar.id} href={`/search?q=${encodeURIComponent(similar.title)}`}>
                  <div className="w-20 flex-shrink-0" data-testid={`similar-book-${similar.id}`}>
                    <div className="w-20 h-28 rounded-md bg-muted overflow-hidden mb-1">
                      {similar.coverImageUrl ? (
                        <img src={similar.coverImageUrl} alt={similar.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <BookOpen className="w-4 h-4 text-muted-foreground/40" />
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] leading-tight line-clamp-2 font-medium">{similar.title}</p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No similar books found yet.</p>
          )}
        </div>

        <div className="pt-2 pb-4">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="w-full text-destructive" data-testid="button-remove">
                <Trash2 className="w-4 h-4 mr-2" />
                Remove from Library
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove book?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove "{book.title}" from your library, including your rating, review, and reading progress.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-cancel-remove">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteMutation.mutate()}
                  className="bg-destructive text-destructive-foreground"
                  data-testid="button-confirm-remove"
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}
