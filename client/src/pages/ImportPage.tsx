import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Upload,
  CheckCircle2,
  XCircle,
  Loader2,
  BookOpen,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import { useAuthStore } from "@/hooks/useAuth";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type ImportStatus = "idle" | "uploading" | "processing" | "completed" | "failed";

interface ImportRecord {
  id: string;
  status: string;
  totalRows: number | null;
  booksMatched: number;
  booksUnmatched: number;
  unmatchedData: Array<{
    title: string;
    author: string;
    isbn: string;
    shelf: string;
    rating: string;
  }> | null;
  errorMessage: string | null;
  createdAt: string;
}

export default function ImportPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uiStatus, setUiStatus] = useState<ImportStatus>("idle");
  const [importId, setImportId] = useState<string | null>(null);
  const [importData, setImportData] = useState<ImportRecord | null>(null);

  const { data: pollData } = useQuery<{ import: ImportRecord }>({
    queryKey: ["/api/import", importId],
    enabled: !!importId && (uiStatus === "processing" || uiStatus === "uploading"),
    refetchInterval: 1500,
  });

  const { data: latestData } = useQuery<{ import: ImportRecord | null }>({
    queryKey: ["/api/import/latest"],
    enabled: uiStatus === "idle" && !importId,
  });

  useEffect(() => {
    if (latestData?.import && !importId) {
      const latest = latestData.import;
      if (latest.status === "processing" || latest.status === "pending") {
        setImportId(latest.id);
        setImportData(latest);
        setUiStatus("processing");
      } else if (latest.status === "completed" || latest.status === "failed") {
        const age = Date.now() - new Date(latest.createdAt).getTime();
        if (age < 60 * 60 * 1000) {
          setImportData(latest);
          setUiStatus(latest.status as ImportStatus);
        }
      }
    }
  }, [latestData, importId]);

  useEffect(() => {
    if (pollData?.import) {
      setImportData(pollData.import);
      if (pollData.import.status === "completed") {
        setUiStatus("completed");
        queryClient.invalidateQueries({ queryKey: ["/api/library"] });
        toast({ title: "Import complete!", description: `${pollData.import.booksMatched} books added to your library.` });
      } else if (pollData.import.status === "failed") {
        setUiStatus("failed");
        toast({ title: "Import failed", description: pollData.import.errorMessage || "Unknown error", variant: "destructive" });
      }
    }
  }, [pollData]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".csv")) {
      toast({ title: "Invalid file", description: "Please upload a .csv file exported from Goodreads.", variant: "destructive" });
      return;
    }

    setUiStatus("uploading");

    try {
      const token = useAuthStore.getState().accessToken;
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/import/goodreads", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || "Upload failed");
      }

      const data = await res.json();
      setImportId(data.import.id);
      setImportData(data.import);
      setUiStatus("processing");
    } catch (err: any) {
      setUiStatus("failed");
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const progressPercent =
    importData?.totalRows && importData.totalRows > 0
      ? Math.round(
          ((importData.booksMatched + importData.booksUnmatched) /
            importData.totalRows) *
            100
        )
      : 0;

  const handleStartNew = () => {
    setUiStatus("idle");
    setImportId(null);
    setImportData(null);
  };

  return (
    <div className="px-4 py-6 pb-24" data-testid="import-page">
      <div className="flex items-center gap-2 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/settings")} data-testid="button-back">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="text-xl font-bold font-serif">Import from Goodreads</h1>
      </div>

      {uiStatus === "idle" && (
        <>
          <Card className="mb-4">
            <CardHeader className="pb-2">
              <h2 className="text-sm font-semibold">How to export from Goodreads</h2>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>1. Go to <a href="https://www.goodreads.com/review/import" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-1">goodreads.com/review/import <ExternalLink className="w-3 h-3" /></a></p>
              <p>2. Click <strong>"Export Library"</strong> at the top of the page</p>
              <p>3. Wait for the export to generate, then download the CSV file</p>
              <p>4. Upload that CSV file below</p>
            </CardContent>
          </Card>

          <Card className="mb-4">
            <CardContent className="pt-6">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                className="hidden"
                data-testid="input-csv-file"
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-14 text-base"
                size="lg"
                data-testid="button-upload-csv"
              >
                <Upload className="w-5 h-5 mr-2" />
                Upload Goodreads CSV
              </Button>
              <p className="text-xs text-center text-muted-foreground mt-3">
                Your ratings, reviews, and reading status will be imported.
              </p>
            </CardContent>
          </Card>
        </>
      )}

      {uiStatus === "uploading" && (
        <Card>
          <CardContent className="pt-6 flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm font-medium">Uploading your library...</p>
          </CardContent>
        </Card>
      )}

      {uiStatus === "processing" && importData && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-primary flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">Importing your books...</p>
                <p className="text-xs text-muted-foreground">
                  Matching each book against Google Books. This may take a few minutes for large libraries.
                </p>
              </div>
            </div>

            <Progress value={progressPercent} className="h-2" data-testid="progress-import" />

            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{importData.booksMatched + importData.booksUnmatched} of {importData.totalRows || "?"} processed</span>
              <span>{progressPercent}%</span>
            </div>

            <div className="flex gap-4 text-sm">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span>{importData.booksMatched} matched</span>
              </div>
              <div className="flex items-center gap-1.5">
                <XCircle className="w-4 h-4 text-orange-400" />
                <span>{importData.booksUnmatched} unmatched</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {uiStatus === "completed" && importData && (
        <>
          <Card className="mb-4">
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-green-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Import complete!</p>
                  <p className="text-xs text-muted-foreground">
                    {importData.totalRows} books processed
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-green-700 dark:text-green-400" data-testid="text-books-matched">{importData.booksMatched}</p>
                  <p className="text-xs text-green-600 dark:text-green-500">Books added</p>
                </div>
                <div className="bg-orange-50 dark:bg-orange-950/30 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-orange-700 dark:text-orange-400" data-testid="text-books-unmatched">{importData.booksUnmatched}</p>
                  <p className="text-xs text-orange-600 dark:text-orange-500">Couldn't match</p>
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={() => navigate("/library")} className="flex-1" data-testid="button-view-library">
                  <BookOpen className="w-4 h-4 mr-2" />
                  View Library
                </Button>
                <Button onClick={handleStartNew} variant="outline" className="flex-1" data-testid="button-import-again">
                  Import Again
                </Button>
              </div>
            </CardContent>
          </Card>

          {importData.unmatchedData && importData.unmatchedData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-orange-400" />
                  <h2 className="text-sm font-semibold">
                    Unmatched Books ({importData.unmatchedData.length})
                  </h2>
                </div>
                <p className="text-xs text-muted-foreground">
                  These books couldn't be found on Google Books. You can search for them manually.
                </p>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {importData.unmatchedData.map((book, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-2 py-2 border-b border-border/50 last:border-0"
                      data-testid={`unmatched-book-${i}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{book.title}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {book.author}
                          {book.shelf ? ` · ${book.shelf}` : ""}
                          {book.rating && book.rating !== "0" ? ` · ${book.rating}★` : ""}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-shrink-0 text-xs"
                        onClick={() =>
                          navigate(
                            `/search?q=${encodeURIComponent(book.title + " " + book.author)}`
                          )
                        }
                        data-testid={`button-search-unmatched-${i}`}
                      >
                        Search
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {uiStatus === "failed" && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-3">
              <XCircle className="w-6 h-6 text-red-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold">Import failed</p>
                <p className="text-xs text-muted-foreground">
                  {importData?.errorMessage || "Something went wrong. Please try again."}
                </p>
              </div>
            </div>
            <Button onClick={handleStartNew} className="w-full" data-testid="button-try-again">
              Try Again
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
