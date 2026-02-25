import { Home, Camera, Library, Compass, UserCircle } from "lucide-react";
import { useLocation, Link } from "wouter";
import { Badge } from "@/components/ui/badge";

const navItems = [
  { path: "/", label: "Home", icon: Home },
  { path: "/scan", label: "Scan", icon: Camera, center: true },
  { path: "/library", label: "Library", icon: Library },
  { path: "/discover", label: "Discover", icon: Compass, comingSoon: true },
  { path: "/profile", label: "Profile", icon: UserCircle },
];

export function BottomNav() {
  const [location] = useLocation();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-md border-t border-border"
      data-testid="bottom-nav"
    >
      <div className="max-w-lg mx-auto flex items-end justify-around px-2 pb-[env(safe-area-inset-bottom)]">
        {navItems.map((item) => {
          const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
          const Icon = item.icon;

          if (item.center) {
            return (
              <Link key={item.path} href={item.path} data-testid={`nav-${item.label.toLowerCase()}`}>
                <div className="flex flex-col items-center py-2 relative">
                  <div className="w-12 h-12 -mt-4 rounded-full bg-primary flex items-center justify-center shadow-lg relative">
                    <Icon className="w-5 h-5 text-primary-foreground" />
                    {item.comingSoon && (
                      <span className="absolute -top-1 -right-1 text-[9px] bg-amber-500 text-white px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap">
                        Soon
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] mt-0.5 text-muted-foreground font-medium">{item.label}</span>
                </div>
              </Link>
            );
          }

          return (
            <Link key={item.path} href={item.path} data-testid={`nav-${item.label.toLowerCase()}`}>
              <div className="flex flex-col items-center py-2 px-3 relative">
                <div className="relative">
                  <Icon
                    className={`w-5 h-5 transition-colors ${
                      isActive ? "text-primary" : "text-muted-foreground"
                    }`}
                  />
                  {item.comingSoon && (
                    <span className="absolute -top-1.5 -right-3 text-[8px] bg-amber-500 text-white px-1 py-0.5 rounded-full font-medium whitespace-nowrap">
                      Soon
                    </span>
                  )}
                </div>
                <span
                  className={`text-[10px] mt-1 font-medium transition-colors ${
                    isActive ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {item.label}
                </span>
                {isActive && (
                  <div className="absolute bottom-0 w-6 h-0.5 rounded-full bg-primary" />
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
