import { redirect } from "next/navigation";
import Link from "next/link";
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
    <div className="min-h-screen bg-[#F5F5F5]">
      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 min-h-screen bg-white border-r border-[#E0E0E0] hidden md:block">
          <div className="p-6">
            <h2 className="text-lg font-semibold text-[#212121]">Moderasi</h2>
            <p className="text-xs text-[#757575] mt-1">Panel Moderator</p>
          </div>

          <nav className="px-3 space-y-1">
            <NavLink href="/moderasi" label="Dashboard" icon={DashboardIcon} />
            <NavLink href="/moderasi/campaigns" label="Kampanye" icon={CampaignIcon} />
            <NavLink href="/moderasi/reports" label="Laporan" icon={ReportIcon} />
            <NavLink href="/moderasi/partner-organisations" label="Partner Organisation" icon={CampaignIcon} />
            <NavLink href="/moderasi/collecting-entities" label="Collecting Entity" icon={CampaignIcon} />
          </nav>
        </aside>

        {/* Mobile header */}
        <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b border-[#E0E0E0]">
          <div className="px-4 py-3">
            <h2 className="text-base font-semibold text-[#212121]">Moderasi</h2>
          </div>
          <div className="flex border-t border-[#E0E0E0]">
            <MobileNavLink href="/moderasi" label="Dashboard" />
            <MobileNavLink href="/moderasi/campaigns" label="Kampanye" />
            <MobileNavLink href="/moderasi/reports" label="Laporan" />
            <MobileNavLink href="/moderasi/partner-organisations" label="Partner" />
            <MobileNavLink href="/moderasi/collecting-entities" label="Penghimpun" />
          </div>
        </div>

        {/* Main content */}
        <main className="flex-1 md:p-6 p-4 pt-24 md:pt-6">{children}</main>
      </div>
    </div>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: React.FC<{ className?: string }>;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-[#424242] hover:bg-[#F5F5F5] hover:text-[#0073E6] transition-colors"
    >
      <Icon className="w-5 h-5" />
      <span>{label}</span>
    </Link>
  );
}

function MobileNavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex-1 text-center py-2.5 text-xs font-medium text-[#424242] hover:text-[#0073E6] hover:bg-[#F5F5F5] transition-colors"
    >
      {label}
    </Link>
  );
}

function DashboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
      />
    </svg>
  );
}

function CampaignIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
      />
    </svg>
  );
}

function ReportIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
      />
    </svg>
  );
}
