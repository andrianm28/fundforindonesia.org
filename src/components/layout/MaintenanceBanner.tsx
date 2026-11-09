/**
 * The maintenance notice shown on every page while Mode pemeliharaan is on
 * (src/lib/operations.ts, PKS ticket 01). Purely presentational: the root
 * layout reads the switch and renders this only while it is on. No hooks and
 * no 'use client', so it renders on either side.
 */
export function MaintenanceBanner({ message }: { message: string }) {
  return (
    <div role="status" className="w-full bg-red-100 px-4 py-2 text-center text-sm text-red-900">
      <strong>Pemeliharaan.</strong> {message}
    </div>
  );
}
