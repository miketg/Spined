import { log } from "./index";

interface OcrFragment {
  text: string;
  bounds: { x: number; y: number; width: number; height: number };
}

interface OcrResult {
  fullText: string;
  fragments: OcrFragment[];
}

export async function extractTextFromImage(base64Image: string): Promise<OcrResult> {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_BOOKS_API_KEY is not set");
  }

  const imageData = base64Image.replace(/^data:image\/[a-zA-Z]+;base64,/, "");

  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: imageData },
            features: [{ type: "TEXT_DETECTION", maxResults: 50 }],
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    log(`Cloud Vision API error: ${response.status} ${errText}`);
    throw new Error(`Cloud Vision API error: ${response.status}`);
  }

  const data = await response.json();
  const annotations = data.responses?.[0]?.textAnnotations;

  if (!annotations || annotations.length === 0) {
    return { fullText: "", fragments: [] };
  }

  const fullText = annotations[0].description || "";

  const fragments: OcrFragment[] = annotations.slice(1).map((ann: any) => {
    const vertices = ann.boundingPoly?.vertices || [];
    const xs = vertices.map((v: any) => v.x || 0);
    const ys = vertices.map((v: any) => v.y || 0);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return {
      text: ann.description || "",
      bounds: {
        x: minX,
        y: minY,
        width: Math.max(...xs) - minX,
        height: Math.max(...ys) - minY,
      },
    };
  });

  return { fullText, fragments };
}
