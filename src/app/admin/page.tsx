import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasAssignment } from "@/lib/withAssignmentCheck";
import { Assignment } from "@/generated/prisma/client";

export default async function AdminDashboardPage() {
  const session = await getServerSession();

  // Admin power comes only from the ADMIN assignment, never the Role (ADR 0005).
  if (!session?.user || !hasAssignment(session.user.assignments, Assignment.ADMIN)) {
    redirect("/");
  }

  const [totalUsers, totalCampaigns, totalDonations] = await Promise.all([
    prisma.user.count(),
    prisma.campaign.count(),
    prisma.donation.count(),
  ]);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard Admin</h1>
        <p className="text-gray-600 mt-1">
          Ringkasan statistik platform
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard
          title="Total Pengguna"
          value={totalUsers}
          icon="users"
          color="blue"
        />
        <StatCard
          title="Total Kampanye"
          value={totalCampaigns}
          icon="campaigns"
          color="green"
        />
        <StatCard
          title="Total Donasi"
          value={totalDonations}
          icon="donations"
          color="purple"
        />
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  color,
}: {
  title: string;
  value: number;
  icon: string;
  color: "blue" | "green" | "purple";
}) {
  const colorClasses = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-green-50 text-green-600",
    purple: "bg-purple-50 text-purple-600",
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center gap-4">
        <div className={`p-3 rounded-lg ${colorClasses[color]}`}>
          <StatIcon type={icon} />
        </div>
        <div>
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="text-2xl font-bold text-gray-900">
            {value.toLocaleString("id-ID")}
          </p>
        </div>
      </div>
    </div>
  );
}

function StatIcon({ type }: { type: string }) {
  switch (type) {
    case "users":
      return (
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
      );
    case "campaigns":
      return (
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
          />
        </svg>
      );
    case "donations":
      return (
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
          />
        </svg>
      );
    default:
      return null;
  }
}
