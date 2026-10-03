import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import { hasAssignment } from "@/lib/withAssignmentCheck";
import { Assignment } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { readBankAccountNumber } from "@/lib/contact-fields";
import { maskBankAccountNumber } from "@/lib/bank-account-mask";
import {
  pendingBankAccountVerifications,
  revokedBankAccounts,
  verifiedBankAccounts,
  type RevocableBankAccount,
} from "@/lib/bank-account-verification";
import { DecidePanel } from "./DecidePanel";
import { RevocationPanel } from "./RevocationPanel";

// Reads the database with no request data of its own (session and DB only):
// force-dynamic so the queue, the verified list and the revoked list are
// never served stale from a cache.
export const dynamic = "force-dynamic";

/**
 * The Verifier's Bank Account queue, decide panel, and revoke/reinstate
 * lists (ticket 16, ticket 11; ADR 0018; decision 6). Server-rendered on
 * purpose: the full account number is decrypted here, in this server
 * component, through `readBankAccountNumber`, so it never crosses the wire
 * as a client prop or sits in the RSC payload -- "render it in the server
 * component, or accept that consciously" (ticket 16's own words). Every list
 * before it shows only the masked form.
 *
 * Not logged anywhere: ADR 0012 chose a randomized ciphertext with no HMAC,
 * so there is no search trail even in principle for this read, the same as
 * the payout's. That is a stated cost of decision 6, not an oversight.
 */
export default async function ModerasiRekeningPage() {
  const session = await getServerSession();
  if (!session?.user || !hasAssignment(session.user.assignments, Assignment.VERIFIER)) {
    redirect("/");
  }

  const [requests, verified, revoked] = await Promise.all([
    pendingBankAccountVerifications(prisma),
    verifiedBankAccounts(prisma),
    revokedBankAccounts(prisma),
  ]);

  const maskedNumber = (account: { accountNumberCiphertext: string; accountNumberKeyId: string }) =>
    maskBankAccountNumber(readBankAccountNumber(account) ?? "");

  return (
    <div className="space-y-10">
      <section className="space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-text">Verifikasi Rekening</h1>
          <p className="text-sm text-text-secondary">Diurutkan dari yang paling lama menunggu.</p>
        </div>

        {requests.length === 0 && (
          <p className="text-sm text-text-secondary">Tidak ada Bank Account yang menunggu verifikasi.</p>
        )}

        {requests.map((request) => {
          const account = request.bankAccount;
          const fullNumber = readBankAccountNumber(account) ?? "(tidak dapat dibaca)";
          return (
            <section key={request.id} className="bg-white rounded-xl border border-border p-6 space-y-4">
              <div className="space-y-1">
                <p className="text-sm text-text font-medium">Pemilik: {account.ownerName}</p>
                <p className="text-sm text-text-secondary">Bank (ditulis pemilik): {account.bankCode}</p>
                <p className="text-sm text-text-secondary">Nama pemilik rekening (ditulis pemilik): {account.accountName}</p>
                <p className="text-sm text-text-secondary">
                  Nomor rekening (daftar, tersamar): {maskBankAccountNumber(fullNumber)}
                </p>
                {/* Decision 6: the Verifier's decide panel shows the full number, because a
                    mistyped digit cannot be checked against a mask. */}
                <p className="text-sm font-semibold text-text">
                  Nomor rekening penuh (untuk diperiksa terhadap dokumen): {fullNumber}
                </p>
              </div>
              <DecidePanel requestId={request.id} />
            </section>
          );
        })}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-text">Rekening Terverifikasi</h2>
          <p className="text-sm text-text-secondary">
            Cabut verifikasi bila rekening ternyata bermasalah. Bukan Verifier yang meloloskannya.
          </p>
        </div>
        {verified.length === 0 && <p className="text-sm text-text-secondary">Tidak ada rekening terverifikasi.</p>}
        {verified.map((account: RevocableBankAccount) => (
          <RevocationPanel
            key={account.id}
            accountId={account.id}
            ownerName={account.ownerName}
            bankCode={account.bankCode}
            accountName={account.accountName}
            maskedNumber={maskedNumber(account)}
            revocationAction="revoke"
          />
        ))}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-text">Rekening Dicabut</h2>
          <p className="text-sm text-text-secondary">
            Pulihkan bila verifikasi ternyata seharusnya tidak dicabut. Bukan Verifier yang mencabutnya.
          </p>
        </div>
        {revoked.length === 0 && <p className="text-sm text-text-secondary">Tidak ada rekening yang sedang dicabut.</p>}
        {revoked.map((account: RevocableBankAccount) => (
          <RevocationPanel
            key={account.id}
            accountId={account.id}
            ownerName={account.ownerName}
            bankCode={account.bankCode}
            accountName={account.accountName}
            maskedNumber={maskedNumber(account)}
            revocationAction="reinstate"
          />
        ))}
      </section>
    </div>
  );
}
