import { useState, useEffect, useRef, useCallback } from "react";
import { Camera, X, BookOpen, Plus, Check, Loader2, ChevronDown, ChevronUp, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { motion, AnimatePresence } from "framer-motion";

interface DetectedBook {
  googleBooksId: string;
  title: string;
  subtitle?: string;
  authors: string[];
  publishedDate?: string;
  pageCount?: number;
  coverImageUrl?: string;
  description?: string;
  isbn13?: string;
  isbn10?: string;
  categories?: string[];
  publisher?: string;
  averageRating?: number;
  language?: string;
  confidenceScore: number;
  matchedFragments: string[];
  ocrFragments: string[];
  matchTier: "want_to_read" | "already_owned" | "other";
}

export default function ScanPage() {
  const [mode, setMode] = useState<"idle" | "scanning" | "results">("idle");
  const [detectedBooks, setDetectedBooks] = useState<DetectedBook[]>([]);
  const [framesProcessed, setFramesProcessed] = useState(0);
  const [isProcessingFrame, setIsProcessingFrame] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [addedBooks, setAddedBooks] = useState<Set<string>>(new Set());
  const [addingBook, setAddingBook] = useState<string | null>(null);
  const [showAlreadyOwned, setShowAlreadyOwned] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [scanStartTime, setScanStartTime] = useState<number>(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const detectedMapRef = useRef<Map<string, DetectedBook>>(new Map());
  const isProcessingRef = useRef(false);

  const { toast } = useToast();

  const stopMediaStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const clearInterval_ = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const processFrame = useCallback(async () => {
    if (isProcessingRef.current) return;
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video.readyState < 2) return;

    const maxWidth = 1280;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    canvas.width = video.videoWidth * scale;
    canvas.height = video.videoHeight * scale;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    let totalBrightness = 0;
    let sampleCount = 0;
    for (let i = 0; i < pixels.length; i += 160) {
      totalBrightness += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
      sampleCount++;
    }
    const avgBrightness = totalBrightness / sampleCount;
    if (avgBrightness < 40 || avgBrightness > 240) return;

    const base64Data = canvas.toDataURL("image/jpeg", 0.7);

    isProcessingRef.current = true;
    setIsProcessingFrame(true);

    try {
      const res = await apiRequest("POST", "/api/scan/frame", { image: base64Data });
      const data = await res.json();

      if (data.matches && data.matches.length > 0) {
        for (const match of data.matches) {
          const existing = detectedMapRef.current.get(match.googleBooksId);
          if (!existing || match.confidenceScore > existing.confidenceScore) {
            detectedMapRef.current.set(match.googleBooksId, match);
          }
        }
        setDetectedBooks(Array.from(detectedMapRef.current.values()));
      }

      setFramesProcessed((prev) => prev + 1);
    } catch (err) {
      console.log("Frame processing error:", err);
    } finally {
      isProcessingRef.current = false;
      setIsProcessingFrame(false);
    }
  }, []);

  const startScanning = useCallback(async () => {
    setDetectedBooks([]);
    setFramesProcessed(0);
    setCameraError(null);
    setAddedBooks(new Set());
    detectedMapRef.current.clear();
    setScanStartTime(Date.now());

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      setMode("scanning");

      try {
        const sessionRes = await apiRequest("POST", "/api/scan/sessions", {});
        const sessionData = await sessionRes.json();
        setSessionId(sessionData.session?.id || null);
      } catch {
        // non-blocking
      }

      intervalRef.current = setInterval(processFrame, 2000);
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        setCameraError("Camera permission denied. Please allow camera access in your browser settings.");
      } else {
        setCameraError("Could not access camera. Please ensure no other app is using it.");
      }
    }
  }, [processFrame]);

  const finishScanning = useCallback(async () => {
    clearInterval_();
    stopMediaStream();
    setMode("results");

    const currentBooks = Array.from(detectedMapRef.current.values());

    try {
      if (sessionId) {
        await apiRequest("PATCH", `/api/scan/sessions/${sessionId}`, {
          status: "completed",
          framesProcessed,
          booksDetected: currentBooks.length,
          scanDurationMs: Date.now() - scanStartTime,
        });

        if (currentBooks.length > 0) {
          await apiRequest("POST", `/api/scan/sessions/${sessionId}/results`, {
            results: currentBooks,
          });
        }
      }
    } catch {
      // analytics are non-blocking
    }
  }, [sessionId, framesProcessed, scanStartTime, clearInterval_, stopMediaStream]);

  const cancelScanning = useCallback(async () => {
    clearInterval_();
    stopMediaStream();
    setMode("idle");

    try {
      if (sessionId) {
        await apiRequest("PATCH", `/api/scan/sessions/${sessionId}`, { status: "cancelled" });
      }
    } catch {
      // non-blocking
    }
  }, [sessionId, clearInterval_, stopMediaStream]);

  useEffect(() => {
    return () => {
      clearInterval_();
      stopMediaStream();
    };
  }, [clearInterval_, stopMediaStream]);

  const addToLibrary = async (book: DetectedBook, status: string) => {
    setAddingBook(book.googleBooksId);
    try {
      await apiRequest("POST", "/api/library", {
        bookData: {
          googleBooksId: book.googleBooksId,
          title: book.title,
          subtitle: book.subtitle,
          authors: book.authors,
          publishedDate: book.publishedDate,
          pageCount: book.pageCount,
          coverImageUrl: book.coverImageUrl,
          description: book.description,
          isbn13: book.isbn13,
          isbn10: book.isbn10,
          categories: book.categories,
          publisher: book.publisher,
          averageRating: book.averageRating,
          language: book.language,
        },
        status,
        source: "shelf_scan",
      });
      setAddedBooks((prev) => new Set(prev).add(book.googleBooksId));
      queryClient.invalidateQueries({ queryKey: ["/api/library"] });
      toast({ title: "Added to library!" });
    } catch (err: any) {
      if (err.message?.includes("409")) {
        setAddedBooks((prev) => new Set(prev).add(book.googleBooksId));
        toast({ title: "Already in library" });
      } else {
        toast({ title: "Failed to add", description: err.message, variant: "destructive" });
      }
    } finally {
      setAddingBook(null);
    }
  };

  const renderBookCard = (book: DetectedBook, borderClass?: string) => {
    const isAdded = addedBooks.has(book.googleBooksId);
    const isAdding = addingBook === book.googleBooksId;

    return (
      <motion.div
        key={book.googleBooksId}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        <Card
          className={borderClass || ""}
          data-testid={`scan-result-${book.googleBooksId}`}
        >
          <CardContent className="flex gap-3 p-3">
            <div className="w-16 h-24 rounded-md bg-muted flex-shrink-0 overflow-hidden">
              {book.coverImageUrl ? (
                <img
                  src={book.coverImageUrl}
                  alt={book.title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <BookOpen className="w-6 h-6 text-muted-foreground/40" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-sm leading-tight line-clamp-2 font-serif">
                {book.title}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                {book.authors?.join(", ") || "Unknown Author"}
              </p>
              <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                {book.publishedDate && <span>{book.publishedDate.slice(0, 4)}</span>}
                {book.pageCount && <span>{book.pageCount} pages</span>}
                <span className="text-muted-foreground/50">
                  {Math.round(book.confidenceScore * 100)}% match
                </span>
              </div>
              {book.matchTier === "want_to_read" && (
                <span className="inline-block mt-1 text-[10px] bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-1.5 py-0.5 rounded-full font-medium">
                  On your list!
                </span>
              )}
              <div className="mt-2">
                {isAdded || book.matchTier === "already_owned" ? (
                  <Button size="sm" variant="secondary" disabled data-testid={`button-added-${book.googleBooksId}`}>
                    <Check className="w-3 h-3 mr-1" /> {book.matchTier === "already_owned" ? "In Library" : "Added"}
                  </Button>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" disabled={isAdding} data-testid={`button-add-${book.googleBooksId}`}>
                        {isAdding ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : (
                          <Plus className="w-3 h-3 mr-1" />
                        )}
                        Add to Library
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onClick={() => addToLibrary(book, "want_to_read")} data-testid="menu-want-to-read">
                        Want to Read
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => addToLibrary(book, "currently_reading")} data-testid="menu-currently-reading">
                        Currently Reading
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => addToLibrary(book, "read")} data-testid="menu-read">
                        Read
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  };

  if (mode === "scanning") {
    return (
      <div className="relative" data-testid="scan-page-scanning">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-[60vh] object-cover rounded-xl"
        />
        <canvas ref={canvasRef} className="hidden" />

        <div className="absolute top-4 left-4 right-4 flex items-center justify-between bg-black/60 rounded-lg px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-white text-sm font-medium">Scanning...</span>
          </div>
          <span className="text-white/70 text-xs">{framesProcessed} frames</span>
        </div>

        <div className="mt-4 px-4">
          <motion.div
            key={detectedBooks.length}
            initial={{ scale: 1.1 }}
            animate={{ scale: 1 }}
            className="text-center"
          >
            <p className="text-lg font-semibold font-serif">
              {detectedBooks.length} book{detectedBooks.length !== 1 ? "s" : ""} detected
            </p>
          </motion.div>

          {isProcessingFrame && (
            <div className="flex items-center justify-center gap-2 mt-2 text-sm text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Processing...</span>
            </div>
          )}

          <div className="flex gap-3 mt-4">
            <Button onClick={finishScanning} className="flex-1" size="lg" data-testid="button-done-scanning">
              Done
            </Button>
            <Button onClick={cancelScanning} variant="outline" size="lg" data-testid="button-cancel-scanning">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "results") {
    const wantToReadBooks = detectedBooks.filter((b) => b.matchTier === "want_to_read");
    const newBooks = detectedBooks.filter((b) => b.matchTier === "other");
    const alreadyOwnedBooks = detectedBooks.filter((b) => b.matchTier === "already_owned");

    return (
      <div className="px-4 py-6" data-testid="scan-page-results">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold font-serif">Scan Results</h1>
          <span className="text-sm bg-primary/10 text-primary px-2 py-1 rounded-full font-medium">
            {detectedBooks.length} found
          </span>
        </div>

        {detectedBooks.length === 0 ? (
          <Card className="mt-8">
            <CardContent className="flex flex-col items-center py-8 text-center">
              <Camera className="w-12 h-12 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground mb-4">
                No books detected. Try holding your camera steady and closer to the shelf.
              </p>
              <Button onClick={() => setMode("idle")} data-testid="button-scan-again-empty">
                Scan Again
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {wantToReadBooks.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-green-700 dark:text-green-400 mb-2">
                  Want to Read Matches
                </h2>
                <div className="space-y-3">
                  {wantToReadBooks.map((book) =>
                    renderBookCard(book, "border-l-4 border-l-green-500")
                  )}
                </div>
              </div>
            )}

            {newBooks.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold mb-2">New Books</h2>
                <div className="space-y-3">
                  {newBooks.map((book) => renderBookCard(book))}
                </div>
              </div>
            )}

            {alreadyOwnedBooks.length > 0 && (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAlreadyOwned(!showAlreadyOwned)}
                  className="text-muted-foreground mb-2"
                  data-testid="button-toggle-already-owned"
                >
                  {showAlreadyOwned ? (
                    <ChevronUp className="w-4 h-4 mr-1" />
                  ) : (
                    <ChevronDown className="w-4 h-4 mr-1" />
                  )}
                  Show {alreadyOwnedBooks.length} already owned
                </Button>
                <AnimatePresence>
                  {showAlreadyOwned && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-3 overflow-hidden"
                    >
                      {alreadyOwnedBooks.map((book) =>
                        renderBookCard(book, "opacity-60")
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            <div className="pt-4">
              <Button
                onClick={() => setMode("idle")}
                variant="outline"
                className="w-full"
                data-testid="button-scan-again"
              >
                <Camera className="w-4 h-4 mr-2" />
                Scan Again
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="px-4 py-6 flex flex-col items-center justify-center min-h-[60vh]"
      data-testid="scan-page"
    >
      <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
        <Camera className="w-9 h-9 text-primary" />
      </div>

      <h1 className="text-2xl font-bold font-serif mb-2">Shelf Scanner</h1>
      <p className="text-sm text-muted-foreground text-center max-w-[300px] mb-8">
        Point your camera at a bookshelf to identify books and add them to your library.
      </p>

      <Button
        onClick={startScanning}
        size="lg"
        className="w-full max-w-[300px]"
        data-testid="button-start-scanning"
      >
        <Camera className="w-5 h-5 mr-2" />
        Start Scanning
      </Button>

      {cameraError && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 w-full max-w-[300px]"
        >
          <Card className="border-destructive/50">
            <CardContent className="flex flex-col items-center py-4 text-center">
              <AlertCircle className="w-8 h-8 text-destructive mb-2" />
              <p className="text-sm text-destructive mb-3">{cameraError}</p>
              <Button onClick={startScanning} variant="outline" size="sm" data-testid="button-try-again">
                Try Again
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      )}

      <canvas ref={canvasRef} className="hidden" />
      <video ref={videoRef} className="hidden" autoPlay playsInline muted />
    </motion.div>
  );
}
