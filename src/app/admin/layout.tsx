import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import { hasAssignment } from "@/lib/withAssignmentCheck";
import { Assignment } from "@/generated/prisma/client";
import { AdminSidebar } from "@/components/admin/AdminSidebar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();

  // Admin power comes only from the ADMIN assignment, never the Role (ADR 0005).
  if (!session?.user || !hasAssignment(session.user.assignments, Assignment.ADMIN)) {
    redirect("/");
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 md:flex-row">
      <AdminSidebar />
      <main className="min-w-0 flex-1 p-4 md:p-6 lg:p-8">{children}</main>
    </div>
  );
}
