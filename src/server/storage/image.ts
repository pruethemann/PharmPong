import sharp from "sharp";

export const LOGO_MAX_BYTES = 1024 * 1024;
export const LOGO_SIZE_PX = 256;
export const LOGO_CONTENT_TYPE = "image/webp";

export type SniffedImage = "png" | "jpeg" | "webp";

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

/**
 * Identify an image by its magic bytes. Only PNG, JPEG and WebP are accepted;
 * everything else (SVG, GIF, HEIC, text …) returns null. The client-supplied
 * MIME type and file name are never trusted.
 */
export function sniffImageType(bytes: Uint8Array): SniffedImage | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  // "RIFF" <size> "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "webp";
  }
  return null;
}

/** Re-encode to a square 256×256 WebP. Drops all metadata (EXIF/GPS) and any trailing payload. */
export async function normalizeLogo(bytes: Uint8Array): Promise<Uint8Array> {
  const out = await sharp(bytes, { failOn: "error", limitInputPixels: 40_000_000, animated: false })
    .rotate() // apply EXIF orientation before metadata is stripped
    .resize(LOGO_SIZE_PX, LOGO_SIZE_PX, { fit: "cover", position: "attention" })
    .webp({ quality: 82 })
    .toBuffer();
  return new Uint8Array(out);
}
