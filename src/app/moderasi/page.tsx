import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import { hasAssignment } from "@/lib/withAssignmentCheck";
import { Assignment, VerificationOutcome } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export default async function ModerasiPage() {
  const session = await getServerSession();

  if (!session?.user || !hasAssignment(session.user.assignments, Assignment.VERIFIER)) {
    redirect("/");
  }

  // Awaiting review means an open Verification Request (CONTEXT.md).
  const pendingRequestsCount = await prisma.verificationRequest.count({
    where: { outcome: VerificationOutcome.PENDING },
  });

  return (
    <div>
      <h1 className="text-xl font-semibold text-[#212121]">Dashboard Moderasi</h1>
      <p className="text-sm text-[#757575] mt-1">
        Ringkasan item yang perlu ditinjau
      </p>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Open Verification Requests card */}
        <div className="bg-white rounded-xl border border-[#E0E0E0] p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[#757575]">Kampanye Menunggu Review</p>
              <p className="text-2xl font-bold text-[#212121] mt-1">
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
        <div className="bg-white rounded-xl border border-[#E0E0E0] p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[#757575]">Laporan</p>
              <p className="text-2xl font-bold text-[#212121] mt-1">-</p>
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
      </div>
    </div>
  );
}
