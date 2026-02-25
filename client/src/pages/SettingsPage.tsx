import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Save } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useAuth, useAuthStore } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function SettingsPage() {
  const { user } = useAuth();
  const setUser = useAuthStore((s) => s.setUser);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [readingGoal, setReadingGoal] = useState(user?.readingGoal?.toString() || "");

  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("PATCH", "/api/profile", data);
      return res.json();
    },
    onSuccess: (data) => {
      setUser(data.user);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Profile updated" });
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    updateMutation.mutate({
      displayName,
      bio,
      readingGoal: readingGoal ? parseInt(readingGoal) : null,
    });
  };

  return (
    <div className="px-4 py-6" data-testid="settings-page">
      <div className="flex items-center gap-2 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} data-testid="button-back">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="text-xl font-bold font-serif">Settings</h1>
      </div>

      <Card className="mb-4">
        <CardHeader className="pb-2">
          <h2 className="text-sm font-semibold">Profile</h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">Display Name</Label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your display name"
              data-testid="input-display-name"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Bio</Label>
            <Textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell us about yourself..."
              className="min-h-[60px] text-sm"
              data-testid="textarea-bio"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Reading Goal ({new Date().getFullYear()})</Label>
            <Input
              type="number"
              min={0}
              value={readingGoal}
              onChange={(e) => setReadingGoal(e.target.value)}
              placeholder="e.g. 24"
              data-testid="input-reading-goal"
            />
          </div>
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="w-full"
            data-testid="button-save-profile"
          >
            <Save className="w-4 h-4 mr-2" />
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <h2 className="text-sm font-semibold">Account</h2>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Email</Label>
            <p className="text-sm" data-testid="text-email">{user?.email}</p>
          </div>
          <div className="space-y-2 mt-3">
            <Label className="text-xs text-muted-foreground">Username</Label>
            <p className="text-sm" data-testid="text-username">@{user?.username}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
