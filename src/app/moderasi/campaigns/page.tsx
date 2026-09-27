import Link from "next/link";
import { SELECT_USER_EMAIL } from "@/lib/contact-fields";
import { prisma } from "@/lib/prisma";
import { VerificationOutcome } from "@/generated/prisma/client";

export default async function ModerasiCampaignsPage() {
  // The queue is the open Verification Requests (CONTEXT.md, Verification
  // Request), oldest submission first.
  const requests = await prisma.verificationRequest.findMany({
    where: { outcome: VerificationOutcome.PENDING },
    include: {
      campaign: {
        include: {
          creator: {
            // Not read on this page; selected because the queue is the
            // Verifier's, and a ciphertext is not something to hand out by
            // accident either (ADR 0012).
            select: { name: true, ...SELECT_USER_EMAIL },
          },
        },
      },
    },
    orderBy: { submittedAt: "asc" },
  });

  return (
    <div>
      <h1 className="text-xl font-semibold text-[#212121]">
        Kampanye Menunggu Review
      </h1>
      <p className="text-sm text-[#757575] mt-1">
        Tinjau dan moderasi kampanye yang diajukan
      </p>

      <div className="mt-6">
        {requests.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#E0E0E0] p-8 text-center">
            <svg
              className="w-12 h-12 mx-auto text-[#BDBDBD]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-[#757575] mt-3">
              Tidak ada kampanye yang menunggu review
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map(({ id, campaign, submittedAt, isFirst }) => (
              <Link
                key={id}
                href={`/moderasi/campaigns/${campaign.id}`}
                className="block bg-white rounded-xl border border-[#E0E0E0] p-4 hover:border-[#0073E6] hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-[#212121] truncate">
                      {campaign.title}
                    </h3>
                    <p className="text-xs text-[#757575] mt-1">
                      Dibuat oleh:{" "}
                      <span className="font-medium text-[#424242]">
                        {campaign.creator.name}
                      </span>
                    </p>
                    <div className="flex items-center gap-4 mt-2">
                      <span className="text-xs text-[#757575]">
                        Target: Rp{" "}
                        {campaign.targetAmount.toLocaleString("id-ID")}
                      </span>
                      <span className="text-xs text-[#757575]">
                        Diajukan{" "}
                        {new Date(submittedAt).toLocaleDateString(
                          "id-ID",
                          {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          }
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#FFF3E0] text-[#E65100]">
                      Menunggu
                    </span>
                    {!isFirst && (
                      <span className="text-[10px] text-[#757575]">Pengajuan ulang</span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
