import { z } from 'zod';

/**
 * What a Campaign or Trip cover image may be: the local path /api/upload
 * answers with (`/uploads/<name>`, one safe segment, never dots only, so no
 * `..`), or an absolute https URL. `z.string().url()` alone rejected every
 * upload, because the upload route returns a relative path; plain `http:`,
 * `javascript:` and `data:` stay refused, as do URLs with userinfo
 * (`https://user:pass@host`) and values with surrounding whitespace.
 */
const UPLOAD_PATH = /^\/uploads\/(?!\.+$)[A-Za-z0-9._-]+$/;

export function isValidCoverImage(value: string): boolean {
  if (value !== value.trim()) return false;
  if (UPLOAD_PATH.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

export const coverImageSchema = z.string().refine(isValidCoverImage, { message: 'URL gambar tidak valid' });
