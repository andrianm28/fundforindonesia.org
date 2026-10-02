import { redirect } from "next/navigation";
import { ModerasiMobileNav, ModerasiSideNav } from "@/components/moderasi/ModerasiNav";
import { getServerSession } from "@/lib/auth";
import { hasAssignment } from "@/lib/withAssignmentCheck";
import { Assignment } from "@/generated/prisma/client";

export default async function ModerasiLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();

  if (!session?.user || !hasAssignment(session.user.assignments, Assignment.VERIFIER)) {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-bg-secondary">
      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 min-h-screen bg-bg border-r border-border hidden md:block">
          <div className="p-6">
            <h2 className="text-lg font-semibold text-ink">Moderasi</h2>
            <p className="text-xs text-text-secondary mt-1">Panel Moderator</p>
          </div>

          <ModerasiSideNav />
        </aside>

        {/* Mobile header */}
        <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-bg border-b border-border">
          <div className="px-4 py-3">
            <h2 className="text-base font-semibold text-ink">Moderasi</h2>
          </div>
          <ModerasiMobileNav />
        </div>

        {/* Main content */}
        <main className="flex-1 md:p-6 p-4 pt-24 md:pt-6">{children}</main>
      </div>
    </div>
  );
}
