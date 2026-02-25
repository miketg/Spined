import { log } from "./index";

interface OcrFragment {
  text: string;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface MatchedBook {
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
}

function clusterFragments(fragments: OcrFragment[], proximityPx = 80): string[][] {
  if (fragments.length === 0) return [];

  const sorted = [...fragments].sort(
    (a, b) => (a.bounds.x + a.bounds.width / 2) - (b.bounds.x + b.bounds.width / 2)
  );

  const clusters: OcrFragment[][] = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i++) {
    const frag = sorted[i];
    const fragCenter = frag.bounds.x + frag.bounds.width / 2;
    const lastCluster = clusters[clusters.length - 1];
    const lastCenter =
      lastCluster[lastCluster.length - 1].bounds.x +
      lastCluster[lastCluster.length - 1].bounds.width / 2;

    if (Math.abs(fragCenter - lastCenter) <= proximityPx) {
      lastCluster.push(frag);
    } else {
      clusters.push([frag]);
    }
  }

  return clusters
    .map((cluster) =>
      cluster
        .sort((a, b) => a.bounds.y - b.bounds.y)
        .map((f) => f.text)
    )
    .filter((texts) => texts.join(" ").trim().length >= 3);
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function normalizedSimilarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const maxLen = Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / maxLen;
}

function scoreMatch(clusterText: string, bookTitle: string, bookAuthors: string[]): number {
  const normCluster = clusterText.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const normTitle = bookTitle.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();

  const titleScore = normalizedSimilarity(normCluster, normTitle);

  let authorScore = 0;
  if (bookAuthors.length > 0) {
    for (const author of bookAuthors) {
      const parts = author.toLowerCase().split(/\s+/);
      for (const part of parts) {
        if (part.length >= 3 && normalizedSimilarity(normCluster, part) > 0.3) {
          if (normCluster.includes(part) || normalizedSimilarity(normCluster, part) > 0.8) {
            authorScore = Math.max(authorScore, 1.0);
          }
        }
      }
    }
  }

  let score = titleScore * 0.7 + authorScore * 0.3;

  if (normCluster.length < 4) score *= 0.5;
  else if (normCluster.length < 8) score *= 0.8;

  return Math.round(score * 1000) / 1000;
}

async function searchGoogleBooksForCluster(query: string): Promise<any[]> {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
  const encoded = encodeURIComponent(query.slice(0, 100));
  const baseUrl = `https://www.googleapis.com/books/v1/volumes?q=${encoded}&maxResults=3`;
  const url = apiKey ? `${baseUrl}&key=${apiKey}` : baseUrl;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();

    return (data.items || []).map((item: any) => {
      const info = item.volumeInfo || {};
      const ids = info.industryIdentifiers || [];
      let coverUrl = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || null;
      if (coverUrl) {
        coverUrl = coverUrl.replace("http://", "https://").replace("&edge=curl", "");
      }
      return {
        googleBooksId: item.id,
        title: info.title || "Untitled",
        subtitle: info.subtitle,
        authors: info.authors || ["Unknown Author"],
        publishedDate: info.publishedDate,
        pageCount: info.pageCount,
        coverImageUrl: coverUrl,
        description: info.description,
        isbn13: ids.find((i: any) => i.type === "ISBN_13")?.identifier,
        isbn10: ids.find((i: any) => i.type === "ISBN_10")?.identifier,
        categories: info.categories,
        publisher: info.publisher,
        averageRating: info.averageRating,
        language: info.language,
      };
    });
  } catch (err) {
    log(`Google Books search error for "${query}": ${err}`);
    return [];
  }
}

export async function matchBooksFromOCR(
  fragments: OcrFragment[],
  confidenceThreshold = 0.45
): Promise<Array<{ book: MatchedBook; ocrFragments: string[] }>> {
  const clusters = clusterFragments(fragments);

  if (clusters.length === 0) return [];

  const seenIds = new Set<string>();
  const allMatches: Array<{ book: MatchedBook; ocrFragments: string[] }> = [];

  for (let i = 0; i < clusters.length; i += 5) {
    const batch = clusters.slice(i, i + 5);
    const batchResults = await Promise.all(
      batch.map(async (clusterTexts) => {
        const queryText = clusterTexts.join(" ").trim();
        if (queryText.length < 3) return null;

        const results = await searchGoogleBooksForCluster(queryText);
        if (results.length === 0) return null;

        let bestMatch: MatchedBook | null = null;
        let bestScore = 0;

        for (const result of results) {
          const score = scoreMatch(queryText, result.title, result.authors);
          if (score > bestScore && score >= confidenceThreshold) {
            bestScore = score;
            bestMatch = { ...result, confidenceScore: score, matchedFragments: clusterTexts };
          }
        }

        if (bestMatch && !seenIds.has(bestMatch.googleBooksId)) {
          seenIds.add(bestMatch.googleBooksId);
          return { book: bestMatch, ocrFragments: clusterTexts };
        }
        return null;
      })
    );

    for (const result of batchResults) {
      if (result) allMatches.push(result);
    }
  }

  return allMatches.sort((a, b) => b.book.confidenceScore - a.book.confidenceScore);
}
