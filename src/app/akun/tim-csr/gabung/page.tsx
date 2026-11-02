import { redirect } from "next/navigation";
import { JoinCompanyForm } from "@/components/csr/JoinCompanyForm";
import { getServerSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Where a signed-in person becomes a Tim CSR member (ticket E9/01, tahap 2).
 * Open to any signed-in account, because it shows nothing about any company.
 */
export default async function GabungTimCsrPage() {
  const session = await getServerSession();
  if (!session?.user?.id) redirect("/login");
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <h1 className="text-2xl font-bold">Gabung sebagai Tim CSR</h1>
      <p className="text-sm">
        Perusahaan ditentukan dari domain email Anda. Email gratis seperti Gmail atau Yahoo tidak dapat dipakai, dan email Anda harus sudah terverifikasi.
      </p>
      <JoinCompanyForm />
    </div>
  );
}
