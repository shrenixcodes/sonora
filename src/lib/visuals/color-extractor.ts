/**
 * Artwork color extraction utility.
 *
 * Extracts dominant, vibrant, and atmospheric ambient colors
 * from an album artwork image using HTML5 Canvas pixel sampling.
 */

export interface ArtworkPalette {
  dominant: string;       // Primary dominant color (hex)
  vibrant: string;        // High saturation vibrant accent (hex)
  secondary: string;      // Supporting tone (hex)
  darkMuted: string;      // Deep ambient background tone (hex)
  lightMuted: string;     // Soft highlight tone (hex)
  rgbDominant: [number, number, number];
  rgbVibrant: [number, number, number];
  rgbSecondary: [number, number, number];
}

const DEFAULT_PALETTE: ArtworkPalette = {
  dominant: "#292532",
  vibrant: "#A78BFA",
  secondary: "#C9A96E",
  darkMuted: "#17151C",
  lightMuted: "#F4F0F6",
  rgbDominant: [41, 37, 50],
  rgbVibrant: [167, 139, 250],
  rgbSecondary: [201, 169, 110],
};

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((x) => {
        const hex = Math.max(0, Math.min(255, Math.round(x))).toString(16);
        return hex.length === 1 ? "0" + hex : hex;
      })
      .join("")
  );
}

function getHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return [h * 360, s, l];
}

const paletteCache = new Map<string, ArtworkPalette>();

export async function extractPalette(imageUrl: string): Promise<ArtworkPalette> {
  if (!imageUrl) return DEFAULT_PALETTE;

  const cached = paletteCache.get(imageUrl);
  if (cached) return cached;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";

    // Set a timeout in case image loading fails or gets blocked
    const timeout = setTimeout(() => {
      resolve(DEFAULT_PALETTE);
    }, 4000);

    img.onload = () => {
      clearTimeout(timeout);
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          resolve(DEFAULT_PALETTE);
          return;
        }

        // Downscale for fast, efficient color sampling
        const size = 64;
        canvas.width = size;
        canvas.height = size;
        ctx.drawImage(img, 0, 0, size, size);

        const imgData = ctx.getImageData(0, 0, size, size);
        const data = imgData.data;

        const colorBuckets: Array<{ r: number; g: number; b: number; weight: number }> = [];

        // Sample every 4th pixel to keep CPU usage low
        for (let i = 0; i < data.length; i += 16) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];

          if (a < 128) continue; // ignore transparent pixels

          // Bucket similar colors
          let found = false;
          for (const bucket of colorBuckets) {
            const dist =
              Math.abs(bucket.r - r) + Math.abs(bucket.g - g) + Math.abs(bucket.b - b);
            if (dist < 40) {
              bucket.r = (bucket.r + r) / 2;
              bucket.g = (bucket.g + g) / 2;
              bucket.b = (bucket.b + b) / 2;
              bucket.weight += 1;
              found = true;
              break;
            }
          }

          if (!found) {
            colorBuckets.push({ r, g, b, weight: 1 });
          }
        }

        colorBuckets.sort((a, b) => b.weight - a.weight);

        if (colorBuckets.length === 0) {
          resolve(DEFAULT_PALETTE);
          return;
        }

        // Dominant is the most frequent color
        const dom = colorBuckets[0];

        // Find vibrant (highest saturation with good lightness)
        let vibrant = dom;
        let maxSatScore = -1;

        for (const bucket of colorBuckets.slice(0, 15)) {
          const [, s, l] = getHsl(bucket.r, bucket.g, bucket.b);
          // Prefer saturations between 0.4 and 0.95 and lightness between 0.3 and 0.75
          if (l >= 0.25 && l <= 0.8) {
            const score = s * 1.5 - Math.abs(l - 0.5);
            if (score > maxSatScore) {
              maxSatScore = score;
              vibrant = bucket;
            }
          }
        }

        // Secondary tone
        const secondary = colorBuckets[1] || vibrant;

        // Dark muted (deep atmosphere background)
        const darkMutedRgb: [number, number, number] = [
          Math.round(dom.r * 0.25),
          Math.round(dom.g * 0.25),
          Math.round(dom.b * 0.25),
        ];

        // Light muted (soft text/contrast highlight)
        const lightMutedRgb: [number, number, number] = [
          Math.min(255, Math.round(vibrant.r * 0.4 + 180)),
          Math.min(255, Math.round(vibrant.g * 0.4 + 180)),
          Math.min(255, Math.round(vibrant.b * 0.4 + 180)),
        ];

        const palette: ArtworkPalette = {
          dominant: rgbToHex(dom.r, dom.g, dom.b),
          vibrant: rgbToHex(vibrant.r, vibrant.g, vibrant.b),
          secondary: rgbToHex(secondary.r, secondary.g, secondary.b),
          darkMuted: rgbToHex(darkMutedRgb[0], darkMutedRgb[1], darkMutedRgb[2]),
          lightMuted: rgbToHex(lightMutedRgb[0], lightMutedRgb[1], lightMutedRgb[2]),
          rgbDominant: [Math.round(dom.r), Math.round(dom.g), Math.round(dom.b)],
          rgbVibrant: [Math.round(vibrant.r), Math.round(vibrant.g), Math.round(vibrant.b)],
          rgbSecondary: [Math.round(secondary.r), Math.round(secondary.g), Math.round(secondary.b)],
        };

        paletteCache.set(imageUrl, palette);
        resolve(palette);
      } catch (err) {
        console.warn("[ColorExtractor] Failed to extract palette:", err);
        resolve(DEFAULT_PALETTE);
      }
    };

    img.onerror = () => {
      clearTimeout(timeout);
      resolve(DEFAULT_PALETTE);
    };

    img.src = imageUrl;
  });
}
