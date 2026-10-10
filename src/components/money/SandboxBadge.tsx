/** What a screen prints beside sandbox money, so a test figure never reads as a real one. */
export const SANDBOX_LABEL = 'UJI';

/**
 * The "UJI" mark that sits beside any figure or row made of sandbox (beta)
 * money (ticket rilis-1-benda/94), so a test balance, Payout, Refund or Usage
 * Report is never read as a real one. Purely presentational and renders
 * nothing for real money, so a caller passes the row's `sandbox` and does not
 * branch itself.
 */
export function SandboxBadge({ sandbox }: { sandbox: boolean }) {
  if (!sandbox) return null;
  return (
    <span
      data-testid="sandbox-badge"
      title="Uang uji (mode Beta): tidak ada transfer nyata"
      className="ml-2 inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900"
    >
      {SANDBOX_LABEL}
    </span>
  );
}
