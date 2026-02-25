import { Camera, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function ScanPage() {
  return (
    <div className="px-4 py-6 flex flex-col items-center justify-center min-h-[70vh]" data-testid="scan-page">
      <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
        <Camera className="w-9 h-9 text-primary" />
      </div>
      <h1 className="text-xl font-bold font-serif mb-2">Shelf Scanner</h1>
      <p className="text-sm text-muted-foreground text-center max-w-[280px] mb-6">
        Point your camera at a bookshelf to instantly identify books and add them to your library.
      </p>
      <Card className="w-full max-w-[300px]">
        <CardContent className="p-4 flex items-center gap-3">
          <Sparkles className="w-5 h-5 text-amber-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium">Coming Soon</p>
            <p className="text-xs text-muted-foreground">
              AI-powered book recognition is in development
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
