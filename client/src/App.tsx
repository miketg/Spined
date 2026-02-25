import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/AppShell";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";

import HomePage from "@/pages/HomePage";
import SearchPage from "@/pages/SearchPage";
import LibraryPage from "@/pages/LibraryPage";
import BookDetailPage from "@/pages/BookDetailPage";
import ProfilePage from "@/pages/ProfilePage";
import SettingsPage from "@/pages/SettingsPage";
import ScanPage from "@/pages/ScanPage";
import DiscoverPage from "@/pages/DiscoverPage";
import CollectionPage from "@/pages/CollectionPage";
import LoginPage from "@/pages/LoginPage";
import SignupPage from "@/pages/SignupPage";
import NotFound from "@/pages/not-found";

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center animate-pulse">
            <svg className="w-5 h-5 text-primary-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
            </svg>
          </div>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/signup" component={SignupPage} />
      <Route path="/">
        <AuthGuard>
          <AppShell><HomePage /></AppShell>
        </AuthGuard>
      </Route>
      <Route path="/search">
        <AuthGuard>
          <AppShell><SearchPage /></AppShell>
        </AuthGuard>
      </Route>
      <Route path="/library">
        <AuthGuard>
          <AppShell><LibraryPage /></AppShell>
        </AuthGuard>
      </Route>
      <Route path="/book/:id">
        <AuthGuard>
          <AppShell><BookDetailPage /></AppShell>
        </AuthGuard>
      </Route>
      <Route path="/profile">
        <AuthGuard>
          <AppShell><ProfilePage /></AppShell>
        </AuthGuard>
      </Route>
      <Route path="/settings">
        <AuthGuard>
          <AppShell><SettingsPage /></AppShell>
        </AuthGuard>
      </Route>
      <Route path="/scan">
        <AuthGuard>
          <AppShell><ScanPage /></AppShell>
        </AuthGuard>
      </Route>
      <Route path="/discover">
        <AuthGuard>
          <AppShell><DiscoverPage /></AppShell>
        </AuthGuard>
      </Route>
      <Route path="/collection/:id">
        <AuthGuard>
          <AppShell><CollectionPage /></AppShell>
        </AuthGuard>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function AppInitializer({ children }: { children: React.ReactNode }) {
  const { fetchUser } = useAuth();

  useEffect(() => {
    fetchUser();
  }, []);

  return <>{children}</>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppInitializer>
          <Toaster />
          <Router />
        </AppInitializer>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
