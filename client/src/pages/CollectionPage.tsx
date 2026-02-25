import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { ArrowLeft, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookCard } from "@/components/library/BookCard";
import { EmptyState } from "@/components/common/EmptyState";
import { BookGridSkeleton } from "@/components/common/LoadingSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import type { Book, Collection } from "@shared/schema";

interface CollectionDetail {
  collection: Collection;
  books: Book[];
}

export default function CollectionPage() {
  const [, params] = useRoute("/collection/:id");
  const [, navigate] = useLocation();
  const id = params?.id;

  const { data, isLoading } = useQuery<CollectionDetail>({
    queryKey: ["/api/collections", id],
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="px-4 py-6">
        <Skeleton className="h-6 w-32 mb-4" />
        <BookGridSkeleton />
      </div>
    );
  }

  return (
    <div className="py-6" data-testid="collection-page">
      <div className="px-4 flex items-center gap-2 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} data-testid="button-back">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-lg font-bold font-serif" data-testid="text-collection-name">
            {data?.collection?.name || "Collection"}
          </h1>
          {data?.collection?.description && (
            <p className="text-xs text-muted-foreground">{data.collection.description}</p>
          )}
        </div>
      </div>

      {data?.books && data.books.length > 0 ? (
        <div className="grid grid-cols-3 gap-x-3 gap-y-5 px-4">
          {data.books.map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<BookOpen className="w-7 h-7 text-muted-foreground" />}
          title="Empty collection"
          description="Add books to this collection from book details"
        />
      )}
    </div>
  );
}
