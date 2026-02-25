import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { LogOut, BookOpen, Settings, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import type { UserBookWithBook } from "@shared/schema";

export default function ProfilePage() {
  const { user, logout } = useAuth();

  const { data: libraryData } = useQuery<{ books: UserBookWithBook[] }>({
    queryKey: ["/api/library"],
  });

  const books = libraryData?.books || [];
  const readCount = books.filter((b) => b.status === "read").length;
  const readingCount = books.filter((b) => b.status === "currently_reading").length;
  const wantCount = books.filter((b) => b.status === "want_to_read").length;

  const initials = (user?.displayName || user?.username || "U")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="px-4 py-6" data-testid="profile-page">
      <div className="flex flex-col items-center mb-6">
        <Avatar className="w-20 h-20 mb-3">
          <AvatarFallback className="text-xl font-semibold bg-primary text-primary-foreground">
            {initials}
          </AvatarFallback>
        </Avatar>
        <h1 className="text-xl font-bold font-serif" data-testid="text-display-name">
          {user?.displayName || user?.username}
        </h1>
        <p className="text-sm text-muted-foreground" data-testid="text-username">
          @{user?.username}
        </p>
        {user?.bio && (
          <p className="text-sm text-muted-foreground text-center mt-2 max-w-[280px]">{user.bio}</p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <Card data-testid="stat-read">
          <CardContent className="flex flex-col items-center justify-center p-4">
            <span className="text-2xl font-bold">{readCount}</span>
            <span className="text-xs text-muted-foreground">Read</span>
          </CardContent>
        </Card>
        <Card data-testid="stat-reading">
          <CardContent className="flex flex-col items-center justify-center p-4">
            <span className="text-2xl font-bold">{readingCount}</span>
            <span className="text-xs text-muted-foreground">Reading</span>
          </CardContent>
        </Card>
        <Card data-testid="stat-want">
          <CardContent className="flex flex-col items-center justify-center p-4">
            <span className="text-2xl font-bold">{wantCount}</span>
            <span className="text-xs text-muted-foreground">Want to Read</span>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-2">
        <Link href="/settings">
          <Card className="cursor-pointer hover-elevate" data-testid="link-settings">
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <Settings className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Settings</span>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Card
          className="cursor-pointer hover-elevate"
          onClick={logout}
          data-testid="button-logout"
        >
          <CardContent className="flex items-center gap-3 p-4">
            <LogOut className="w-4 h-4 text-destructive" />
            <span className="text-sm font-medium text-destructive">Sign out</span>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
