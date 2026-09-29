import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import { hasAssignment } from "@/lib/withAssignmentCheck";
import { Assignment } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { kindAuthorisationsNeedingRenewal } from "@/lib/kind-authorisation-renewal";
import { KIND_LABEL } from "@/lib/campaign-kind";

// Reads the database with no request data of its own (session and DB only):
// force-dynamic so the list is never served stale from a cache.
export const dynamic = "force-dynamic";

const formatDate = (date: Date) =>
  new Date(date).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });

/**
 * The Verifier's list of Kind Authorisations that are about to expire (30
 * days, the same horizon as the scheduled warning to the Partner
 * Organisation) or whose date has already passed, when a Campaign of that
 * Kind stops receiving Donations (CONTEXT.md, Kind Authorisation; ticket 28).
 */
export default async function KindAuthorisationsPage() {
  const session = await getServerSession();
  if (!session?.user || !hasAssignment(session.user.assignments, Assignment.VERIFIER)) {
    redirect("/");
  }

  const organisations = await prisma.partnerOrganisation.findMany({
    select: {
      id: true,
      name: true,
      kindAuthorisations: { select: { id: true, kind: true, validFrom: true, validTo: true } },
    },
  });
  const items = kindAuthorisationsNeedingRenewal(organisations, new Date());

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-[#212121]">Kind Authorisation</h1>
        <p className="text-sm text-[#757575] mt-1">
          Yang akan berakhir dalam 30 hari atau sudah lewat tanggalnya. Diurutkan dari yang paling dulu.
        </p>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-[#757575]">
          Tidak ada Kind Authorisation yang akan berakhir atau sudah lewat.
        </p>
      ) : (
        <ul className="bg-white rounded-xl border border-[#E0E0E0] p-5 space-y-2 text-sm text-[#424242]">
          {items.map((item) => (
            <li key={item.id}>
              {item.organisationName} · {KIND_LABEL[item.kind]} ·{" "}
              <span
                className={item.status === "lapsed" ? "font-semibold text-[#F44336]" : "font-semibold text-[#FF9800]"}
              >
                {item.status === "lapsed" ? "Sudah lewat" : "Akan berakhir"}
              </span>{" "}
              · {formatDate(item.validTo)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
