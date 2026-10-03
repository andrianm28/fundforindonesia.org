import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import { hasAssignment } from "@/lib/withAssignmentCheck";
import { Assignment, VerificationOutcome } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { expiringWindows } from "@/lib/collecting-entity";
import { KIND_LABEL } from "@/lib/campaign-kind";

export default async function ModerasiPage() {
  const session = await getServerSession();

  if (!session?.user || !hasAssignment(session.user.assignments, Assignment.VERIFIER)) {
    redirect("/");
  }

  // What waits for a Verifier is an open Verification Request (CONTEXT.md).
  const pendingRequestsCount = await prisma.verificationRequest.count({
    where: { outcome: VerificationOutcome.PENDING },
  });

  // Ticket 16: a Bank Account's Verification Request lives in a separate
  // table (decision 4), which prisma.verificationRequest.count above does
  // not join, so its own count is a fourth card, not folded into the third.
  const pendingBankAccountsCount = await prisma.bankAccountVerificationRequest.count({
    where: { outcome: VerificationOutcome.PENDING },
  });

  // The 30-day warning before a Fundraising Permit or Kind Authorisation
  // lapses (prd-compliance 11), until scheduled email reminders exist.
  const now = new Date();
  const organisations = await prisma.partnerOrganisation.findMany({
    select: {
      id: true,
      name: true,
      permits: { select: { kinds: true, validFrom: true, validTo: true } },
      kindAuthorisations: { select: { kind: true, validFrom: true, validTo: true } },
    },
  });
  const expiring = expiringWindows(organisations, now);

  return (
    <div>
      <h1 className="text-xl font-semibold text-text">Dashboard Moderasi</h1>
      <p className="text-sm text-text-secondary mt-1">
        Ringkasan item yang perlu ditinjau
      </p>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Open Verification Requests card */}
        <div className="bg-white rounded-xl border border-border p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-secondary">Kampanye Menunggu Review</p>
              <p className="text-2xl font-bold text-text mt-1">
                {pendingRequestsCount}
              </p>
            </div>
            <div className="w-10 h-10 rounded-full bg-[#FFF3E0] flex items-center justify-center">
              <svg
                className="w-5 h-5 text-[#FF9800]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
          </div>
          <Link
            href="/moderasi/campaigns"
            className="inline-flex items-center gap-1 text-sm text-[#0073E6] font-medium mt-4 hover:underline"
          >
            Lihat Kampanye
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </Link>
        </div>

        {/* Reports card */}
        <div className="bg-white rounded-xl border border-border p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-secondary">Laporan</p>
              <p className="text-2xl font-bold text-text mt-1">-</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-[#FFEBEE] flex items-center justify-center">
              <svg
                className="w-5 h-5 text-[#F44336]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
          </div>
          <Link
            href="/moderasi/reports"
            className="inline-flex items-center gap-1 text-sm text-[#0073E6] font-medium mt-4 hover:underline"
          >
            Lihat Laporan
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </Link>
        </div>

        {/* Expiring soon card: Fundraising Permits and Kind Authorisations lapsing within 30 days (prd-compliance 11) */}
        <div className="bg-white rounded-xl border border-border p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-secondary">Izin Akan Berakhir</p>
              <p className="text-2xl font-bold text-text mt-1">{expiring.length}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-[#FFF3E0] flex items-center justify-center">
              <svg
                className="w-5 h-5 text-[#FF9800]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
          </div>
          <Link
            href="/moderasi/partner-organisations"
            className="inline-flex items-center gap-1 text-sm text-[#0073E6] font-medium mt-4 hover:underline"
          >
            Lihat Partner Organisation
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </Link>
        </div>
        {/* Fourth card (ticket 16): Bank Account verification requests, a separate queue from Campaign's (decision 4). */}
        <div className="bg-white rounded-xl border border-border p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-secondary">Rekening Menunggu Verifikasi</p>
              <p className="text-2xl font-bold text-text mt-1">
                {pendingBankAccountsCount}
              </p>
            </div>
            <div className="w-10 h-10 rounded-full bg-[#FFF3E0] flex items-center justify-center">
              <svg
                className="w-5 h-5 text-[#FF9800]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 10h18M5 6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z"
                />
              </svg>
            </div>
          </div>
          <Link
            href="/moderasi/rekening"
            className="inline-flex items-center gap-1 text-sm text-[#0073E6] font-medium mt-4 hover:underline"
          >
            Lihat Rekening
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </Link>
        </div>
      </div>

      {expiring.length > 0 && (
        <div className="mt-6 bg-white rounded-xl border border-border p-5">
          <h2 className="text-sm font-semibold text-text mb-3">
            Fundraising Permit dan Kind Authorisation yang akan berakhir dalam 30 hari
          </h2>
          <ul className="space-y-2 text-sm text-[#424242]">
            {expiring.map((item, index) => (
              <li key={`${item.organisationId}-${item.type}-${index}`}>
                {item.organisationName} ·{" "}
                {item.type === "permit"
                  ? `Fundraising Permit (${item.kinds.map((kind) => KIND_LABEL[kind]).join(", ")})`
                  : `Kind Authorisation (${KIND_LABEL[item.kind]})`}{" "}
                · berakhir{" "}
                {new Date(item.validTo).toLocaleDateString("id-ID", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  timeZone: "Asia/Jakarta",
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
