/**
 * The switch behind the Volunteer's Registration flow (ticket 36). Off unless
 * explicitly turned on: a real payment provider for Trip Fee does not exist
 * yet, so the owner turns this on only after Track A, the Xendit adapter and
 * one sandbox Trip Fee test are done (owner decision 2026-09-29).
 *
 * It gates only the flow that STARTS a Registration (the "Daftar" button, the
 * summary page, and POST .../batches/[id]/registrations). Viewing and
 * cancelling a Registration that already exists are never behind it: a
 * Volunteer who paid must always be able to see and cancel theirs. It is a
 * second lock beside donationsEnabled, not a replacement: the route needs both.
 *
 * NEXT_PUBLIC_ so pages and components read the same value; it is inlined at
 * build time, so changing it means a rebuild. Only the exact string `true`
 * counts, as with donationsEnabled. Plain module, safe for client code.
 */
export function volunteerRegistrationEnabled(): boolean {
  return process.env.NEXT_PUBLIC_VOLUNTEER_ENABLED === 'true';
}

export const VOLUNTEER_DISABLED_MESSAGE =
  'Pendaftaran Volunteer Trip belum dibuka. Silakan kembali lagi nanti.';
