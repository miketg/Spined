import { create } from "zustand";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { User } from "@shared/schema";

interface AuthState {
  user: User | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  setUser: (user) => set({ user }),
  setLoading: (isLoading) => set({ isLoading }),
}));

export function useAuth() {
  const { user, isLoading, setUser, setLoading } = useAuthStore();

  const login = async (email: string, password: string) => {
    const res = await apiRequest("POST", "/api/auth/login", { email, password });
    const data = await res.json();
    setUser(data.user);
    return data;
  };

  const signup = async (email: string, username: string, password: string, displayName: string) => {
    const res = await apiRequest("POST", "/api/auth/signup", { email, username, password, displayName });
    const data = await res.json();
    setUser(data.user);
    return data;
  };

  const logout = async () => {
    await apiRequest("POST", "/api/auth/logout");
    setUser(null);
    queryClient.clear();
  };

  const fetchUser = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  return { user, isLoading, login, signup, logout, fetchUser };
}
