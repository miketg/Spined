import { Link } from "wouter";
import { Heart } from "lucide-react";
import type { UserBookWithBook, Book } from "@shared/schema";

interface BookCardProps {
  book: Book;
  userBook?: UserBookWithBook;
  showFavorite?: boolean;
}

export function BookCard({ book, userBook, showFavorite }: BookCardProps) {
  const coverUrl = book.coverImageUrl || "";

  const content = (
    <div className="group cursor-pointer hover-elevate" data-testid={`book-card-${book.id}`}>
      <div className="relative aspect-[2/3] rounded-lg bg-muted mb-2">
        <img
          src={coverUrl}
          alt={book.title}
          className="w-full h-full object-cover rounded-lg"
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 180'%3E%3Crect width='120' height='180' fill='%23e5e7eb'/%3E%3Ctext x='60' y='90' font-family='Inter' font-size='14' fill='%239ca3af' text-anchor='middle' dominant-baseline='middle'%3ENo Cover%3C/text%3E%3C/svg%3E";
          }}
        />
        {showFavorite && userBook?.isFavorite && (
          <div className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-background/80 flex items-center justify-center">
            <Heart className="w-3.5 h-3.5 fill-red-500 text-red-500" />
          </div>
        )}
      </div>
      <h4 className="text-sm font-medium leading-tight line-clamp-2 mb-0.5" data-testid={`text-title-${book.id}`}>
        {book.title}
      </h4>
      <p className="text-xs text-muted-foreground line-clamp-1">
        {book.authors?.join(", ") || "Unknown Author"}
      </p>
    </div>
  );

  if (userBook) {
    return <Link href={`/book/${userBook.id}`}>{content}</Link>;
  }

  return content;
}
