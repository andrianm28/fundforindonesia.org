import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import { hasAssignment } from "@/lib/withAssignmentCheck";
import { Assignment } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { readBankAccountNumber } from "@/lib/contact-fields";
import { maskBankAccountNumber } from "@/lib/bank-account-mask";
import { pendingBankAccountVerifications } from "@/lib/bank-account-verification";
import { DecidePanel } from "./DecidePanel";

/**
 * The Verifier's Bank Account queue and decide panel (ticket 16; ADR 0018;
 * decision 6). Server-rendered on purpose: the full account number is
 * decrypted here, in this server component, through `readBankAccountNumber`,
 * so it never crosses the wire as a client prop or sits in the RSC payload --
 * "render it in the server component, or accept that consciously" (the
 * ticket's own words). The queue list beside it shows only the masked form.
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

  const requests = await pendingBankAccountVerifications(prisma);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-[#212121]">Verifikasi Rekening</h1>
      <p className="text-sm text-[#757575]">Diurutkan dari yang paling lama menunggu.</p>

      {requests.length === 0 && (
        <p className="text-sm text-[#757575]">Tidak ada Bank Account yang menunggu verifikasi.</p>
      )}

      {requests.map((request) => {
        const account = request.bankAccount;
        const fullNumber = readBankAccountNumber(account) ?? "(tidak dapat dibaca)";
        return (
          <section key={request.id} className="bg-white rounded-xl border border-[#E0E0E0] p-6 space-y-4">
            <div className="space-y-1">
              <p className="text-sm text-[#212121] font-medium">Pemilik: {account.ownerName}</p>
              <p className="text-sm text-[#757575]">Bank (ditulis pemilik): {account.bankCode}</p>
              <p className="text-sm text-[#757575]">Nama pemilik rekening (ditulis pemilik): {account.accountName}</p>
              <p className="text-sm text-[#757575]">
                Nomor rekening (daftar, tersamar): {maskBankAccountNumber(fullNumber)}
              </p>
              {/* Decision 6: the Verifier's decide panel shows the full number, because a
                  mistyped digit cannot be checked against a mask. */}
              <p className="text-sm font-semibold text-[#212121]">
                Nomor rekening penuh (untuk diperiksa terhadap dokumen): {fullNumber}
              </p>
            </div>
            <DecidePanel requestId={request.id} />
          </section>
        );
      })}
    </div>
  );
}
