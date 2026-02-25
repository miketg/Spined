import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { BookOpen, Search, Camera, Upload, ChevronRight, Target } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import { HomePageSkeleton } from "@/components/common/LoadingSkeleton";
import type { UserBookWithBook } from "@shared/schema";

export default function HomePage() {
  const { user } = useAuth();

  const { data: libraryData, isLoading } = useQuery<{ books: UserBookWithBook[] }>({
    queryKey: ["/api/library"],
  });

  const currentlyReading = libraryData?.books?.filter((b) => b.status === "currently_reading") || [];
  const wantToRead = libraryData?.books?.filter((b) => b.status === "want_to_read")?.slice(0, 3) || [];
  const booksRead = libraryData?.books?.filter((b) => b.status === "read")?.length || 0;
  const readingGoal = user?.readingGoal || 0;
  const goalProgress = readingGoal > 0 ? Math.min((booksRead / readingGoal) * 100, 100) : 0;

  if (isLoading) return <HomePageSkeleton />;

  return (
    <div className="px-4 py-6 space-y-6" data-testid="home-page">
      <div>
        <h1 className="text-2xl font-bold font-serif" data-testid="text-greeting">
          Hi, {user?.displayName || user?.username || "Reader"}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">What are you reading today?</p>
      </div>

      {currentlyReading.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold">Continue Reading</h2>
            <Link href="/library?status=currently_reading" className="text-xs text-primary font-medium flex items-center gap-0.5" data-testid="link-continue-reading">
              See all <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-3">
            {currentlyReading.slice(0, 2).map((ub) => (
              <Link key={ub.id} href={`/book/${ub.id}`}>
                <Card className="cursor-pointer hover-elevate" data-testid={`card-reading-${ub.id}`}>
                  <CardContent className="flex gap-3 p-3">
                    <img
                      src={ub.book.coverImageUrl || ""}
                      alt={ub.book.title}
                      className="w-12 h-[72px] rounded-md object-cover flex-shrink-0 bg-muted"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-sm leading-tight line-clamp-1 font-serif">
                        {ub.book.title}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                        {ub.book.authors?.join(", ")}
                      </p>
                      {ub.book.pageCount && ub.currentPage != null && (
                        <div className="mt-2">
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                            <span>Page {ub.currentPage} of {ub.book.pageCount}</span>
                            <span>{Math.round((ub.currentPage / ub.book.pageCount) * 100)}%</span>
                          </div>
                          <Progress
                            value={(ub.currentPage / ub.book.pageCount) * 100}
                            className="h-1.5"
                          />
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {readingGoal > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-4 h-4 text-primary" />
            <h2 className="text-base font-semibold">Reading Goal</h2>
          </div>
          <Card data-testid="card-reading-goal">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">{booksRead} of {readingGoal} books</span>
                <span className="text-xs text-muted-foreground">{new Date().getFullYear()}</span>
              </div>
              <Progress value={goalProgress} className="h-2" />
            </CardContent>
          </Card>
        </section>
      )}

      {wantToRead.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold">Up Next</h2>
            <Link href="/library?status=want_to_read" className="text-xs text-primary font-medium flex items-center gap-0.5" data-testid="link-up-next">
              See all <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
            {wantToRead.map((ub) => (
              <Link key={ub.id} href={`/book/${ub.id}`}>
                <div className="flex-shrink-0 w-20 cursor-pointer hover-elevate" data-testid={`card-queue-${ub.id}`}>
                  <div className="aspect-[2/3] rounded-lg bg-muted mb-1.5">
                    <img
                      src={ub.book.coverImageUrl || ""}
                      alt={ub.book.title}
                      className="w-full h-full object-cover rounded-lg"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  </div>
                  <p className="text-xs font-medium line-clamp-2 leading-tight">{ub.book.title}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-base font-semibold mb-3">Quick Actions</h2>
        <div className="grid grid-cols-3 gap-3">
          <Link href="/search">
            <Card className="cursor-pointer hover-elevate" data-testid="action-search">
              <CardContent className="flex flex-col items-center justify-center p-4 gap-2">
                <Search className="w-5 h-5 text-primary" />
                <span className="text-xs font-medium text-center">Search Books</span>
              </CardContent>
            </Card>
          </Link>
          <div className="relative">
            <Card className="opacity-60" data-testid="action-scan">
              <CardContent className="flex flex-col items-center justify-center p-4 gap-2">
                <Camera className="w-5 h-5 text-muted-foreground" />
                <span className="text-xs font-medium text-center text-muted-foreground">Scan Shelf</span>
              </CardContent>
            </Card>
            <span className="absolute -top-1.5 right-0 text-[9px] bg-amber-500 text-white px-1.5 py-0.5 rounded-full font-medium">
              Soon
            </span>
          </div>
          <Link href="/settings">
            <Card className="cursor-pointer hover-elevate" data-testid="action-import">
              <CardContent className="flex flex-col items-center justify-center p-4 gap-2">
                <Upload className="w-5 h-5 text-primary" />
                <span className="text-xs font-medium text-center">Import</span>
              </CardContent>
            </Card>
          </Link>
        </div>
      </section>

      {!currentlyReading.length && !wantToRead.length && (
        <div className="flex flex-col items-center py-8 text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <BookOpen className="w-7 h-7 text-primary" />
          </div>
          <h3 className="font-semibold mb-1">Start Your Library</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-[260px]">
            Search for books or scan a shelf to get started
          </p>
          <Link href="/search">
            <Button data-testid="button-start-searching">Search for Books</Button>
          </Link>
        </div>
      )}
    </div>
  );
}
