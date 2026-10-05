/**
 * The one confirmation shown after asking for a password reset link
 * (rilis-1 93). The request endpoint returns it and /lupa-password renders it,
 * so the two cannot drift. It is the same whatever the server knows about the
 * address. Kept free of server-only imports so the client page can load it.
 *
 * Register: "kamu", as on the other (auth) pages. The email itself says "Anda",
 * like src/lib/mail/email-verification.ts.
 */
export const RESET_REQUESTED_MESSAGE =
  'Jika email itu terdaftar, tautan untuk mengatur ulang password sudah kami kirim. Periksa kotak masuk kamu; tautan berlaku 60 menit.';
