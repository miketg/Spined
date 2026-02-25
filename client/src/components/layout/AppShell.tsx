import { BottomNav } from "./BottomNav";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-background max-w-lg mx-auto relative">
      <main className="pb-20">{children}</main>
      <BottomNav />
    </div>
  );
}
