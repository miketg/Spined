import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { queryClient } from "@/lib/queryClient";
import type { User } from "@shared/schema";

interface AuthState {
  user: User | null;
  supabaseUserId: string | null;
  accessToken: string | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setSupabaseUserId: (id: string | null) => void;
  setAccessToken: (token: string | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  supabaseUserId: null,
  accessToken: null,
  isLoading: true,
  setUser: (user) => set({ user }),
  setSupabaseUserId: (supabaseUserId) => set({ supabaseUserId }),
  setAccessToken: (accessToken) => set({ accessToken }),
  setLoading: (isLoading) => set({ isLoading }),
}));

export function useAuth() {
  const { user, supabaseUserId, accessToken, isLoading, setUser, setSupabaseUserId, setAccessToken, setLoading } = useAuthStore();

  const syncProfile = async (token: string) => {
    try {
      const res = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      }
    } catch {
      // Profile not synced yet
    }
  };

  const login = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);

    const token = data.session?.access_token;
    setSupabaseUserId(data.user?.id || null);
    setAccessToken(token || null);

    if (token) {
      await syncProfile(token);
    }
    return data;
  };

  const signup = async (email: string, username: string, password: string, displayName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username, display_name: displayName },
      },
    });
    if (error) throw new Error(error.message);

    const token = data.session?.access_token;
    setSupabaseUserId(data.user?.id || null);
    setAccessToken(token || null);

    if (token) {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email, username, displayName }),
      });
      if (res.ok) {
        const result = await res.json();
        setUser(result.user);
      }
    }

    return data;
  };

  const loginWithGoogle = async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) throw new Error(error.message);
    return data;
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSupabaseUserId(null);
    setAccessToken(null);
    queryClient.clear();
  };

  const fetchUser = async () => {
    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();

      if (session?.access_token) {
        setSupabaseUserId(session.user?.id || null);
        setAccessToken(session.access_token);
        await syncProfile(session.access_token);
      } else {
        setUser(null);
        setSupabaseUserId(null);
        setAccessToken(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  return { user, supabaseUserId, accessToken, isLoading, login, signup, loginWithGoogle, logout, fetchUser };
}
