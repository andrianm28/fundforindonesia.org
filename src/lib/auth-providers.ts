/**
 * Whether Google sign-in is configured. NextAuth's GoogleProvider was built
 * with `clientId!`, so an unset id registered a provider that could only fail
 * at the Google redirect. Registering it only when both halves are present
 * makes `/api/auth/providers` the single truth the login page reads.
 */
export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}
