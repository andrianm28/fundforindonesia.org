import { join } from 'path';

/**
 * Where uploaded images are written: the `uploads` volume in production
 * (docker-compose.prod.yml mounts it at /app/public/uploads).
 */
export const UPLOAD_DIR = join(process.cwd(), 'public', 'uploads');

/** The image types an upload may have, keyed by the extension it is stored under. */
export const UPLOAD_CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * A stored upload's name: `<base36>-<base36>.<image ext>`, what
 * generateUniqueFilename writes. Anything else (a path separator, a dot
 * segment, a scriptable extension from before the MIME-only naming) is not
 * an upload this app serves.
 */
const UPLOAD_NAME = /^[a-z0-9]+-[a-z0-9]+\.(jpg|jpeg|png|webp)$/;

/** The content type to serve a stored upload with, or null if the name is not one. */
export function uploadContentType(name: string): string | null {
  const match = UPLOAD_NAME.exec(name);
  return match ? UPLOAD_CONTENT_TYPES[match[1]] : null;
}

/**
 * The image type the leading bytes of a file actually are, or null when they
 * are none of JPEG, PNG or WebP (SVG, HTML, PDF and anything else included).
 * An upload's declared MIME type is the uploader's claim; this is the check
 * against the content (audit SEC-02).
 */
export function sniffImageType(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  const startsWith = (sig: number[], offset = 0) =>
    bytes.length >= offset + sig.length && sig.every((b, i) => bytes[offset + i] === b);
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  // "RIFF" <size> "WEBP"
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

/** Whether the bytes are an image of exactly the declared type. */
export function matchesDeclaredImageType(bytes: Uint8Array, declared: string): boolean {
  return sniffImageType(bytes) === declared;
}
