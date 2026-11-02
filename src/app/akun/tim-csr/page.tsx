import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyInquiryForm } from "@/components/csr/CompanyInquiryForm";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CsrNotMemberError, listCompanyInquiries } from "@/lib/tim-csr";

export const dynamic = "force-dynamic";

/**
 * The Tim CSR member's screen (ticket E9/01, tahap 2): the company's own
 * Partnership Inquiries with their status history, a form for a new one, and
 * the impact report download. Anyone who is not a verified member of a
 * company, signed in or not, gets the 404 page, the same as for a page that
 * does not exist.
 */
export default async function TimCsrPage() {
  const session = await getServerSession();
  let view;
  try {
    view = await listCompanyInquiries(prisma, session?.user?.id);
  } catch (error) {
    if (error instanceof CsrNotMemberError) notFound();
    throw error;
  }
  const programs = await prisma.program.findMany({ orderBy: { title: "asc" }, select: { id: true, title: true } });

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      <h1 className="text-2xl font-bold">Tim CSR: {view.companyName}</h1>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Inquiry perusahaan</h2>
        {view.inquiries.length === 0 && <p className="text-sm">Belum ada Inquiry.</p>}
        <ul className="space-y-4">
          {view.inquiries.map((inquiry) => (
            <li key={inquiry.id} data-testid="csr-inquiry" className="rounded border p-4">
              <p className="font-medium">{inquiry.program.title}</p>
              <p className="text-sm">Status: {inquiry.statusLabel}</p>
              <p className="mt-2 text-sm">{inquiry.needs}</p>
              <ol className="mt-2 text-xs text-gray-600">
                {inquiry.history.map((step, index) => (
                  <li key={index}>
                    {step.label} · {step.at.toISOString().slice(0, 10)}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Ajukan Inquiry</h2>
        <CompanyInquiryForm programs={programs} />
      </section>

      <section>
        <a className="underline" href="/api/csr/impact-report" download>
          Unduh laporan dampak Program
        </a>
        <p className="text-xs text-gray-600">Memuat Program yang kolaborasinya telah selesai; tanpa data donatur.</p>
      </section>

      <Link href="/akun" className="text-sm underline">
        Kembali ke akun
      </Link>
    </div>
  );
}
