/**
 * What a Campaign update's image may point at: an http(s) URL, or a file the
 * upload route hosted itself (POST /api/upload answers `/uploads/<name>`).
 * Anything else (`javascript:`, `data:`) is refused on write and skipped on
 * render, the same two-sided check Usage Report photos get.
 */
export function isUpdateImageUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || /^\/uploads\/[\w.-]+$/.test(url);
}
