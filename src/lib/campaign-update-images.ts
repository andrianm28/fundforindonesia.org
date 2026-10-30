/**
 * What a Campaign update's image may point at: an http(s) URL, or a file the
 * upload route hosted itself (POST /api/upload answers `/uploads/<name>`).
 * Anything else (`javascript:`, `data:`) is refused on write and skipped on
 * render, the same two-sided check Usage Report photos get.
 */
export function isUpdateImageUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || /^\/uploads\/[\w.-]+$/.test(url);
}

/**
 * What the write path accepts: only a file the upload route hosted, which is
 * the one thing the form produces. A name made only of dots (`..`) is refused,
 * and a third-party https URL is too (it would be a tracking pixel on a public
 * page). Older rows may still hold https URLs; `isUpdateImageUrl` keeps those
 * rendering.
 */
export function isUploadedImagePath(url: string): boolean {
  return /^\/uploads\/[\w.-]+$/.test(url) && !/^\/uploads\/\.+$/.test(url);
}
