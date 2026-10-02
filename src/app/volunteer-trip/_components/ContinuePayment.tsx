/**
 * "Lanjutkan pembayaran" for a live HOLD Registration (ticket 37): the way to
 * pay again from the stored instructions, for a Volunteer who closed or
 * reloaded the payment page. Shown on the Registration page and on the
 * dashboard. Plain markup with no server imports, so either may render it.
 * `instructions` is null when there is nothing stored to resume, and the
 * Volunteer is told what to do instead of being left with a dead end.
 */
export function ContinuePayment({
  instructions,
}: {
  instructions: { redirectUrl: string | null; vaNumber: string | null } | null;
}) {
  if (!instructions) {
    return (
      <p className="text-sm text-text-secondary">
        Petunjuk pembayaran tidak tersedia lagi untuk Registrasi ini. Batalkan Registrasi lalu daftar ulang untuk
        mendapat petunjuk pembayaran baru.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {instructions.vaNumber && (
        <p className="text-sm text-text">
          Nomor Virtual Account: <strong>{instructions.vaNumber}</strong>
        </p>
      )}
      {instructions.redirectUrl && (
        <a
          href={instructions.redirectUrl}
          className="inline-block px-4 py-2 rounded-md bg-primary text-white font-medium"
        >
          Lanjutkan pembayaran
        </a>
      )}
    </div>
  );
}
