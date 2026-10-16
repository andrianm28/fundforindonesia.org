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
