import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { AdminProgramForm } from '@/components/admin/AdminProgramForm';

export const dynamic = 'force-dynamic';

/** Ubah Program: the edit form (ticket 78). An id no Program has is a 404. */
export default async function AdminEditProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const program = await prisma.program.findUnique({ where: { id } });
  if (!program) notFound();

  return (
    <div>
      <div className="mb-8">
        <Link href="/admin/programs" className="text-sm text-primary">
          &larr; Daftar Program
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Ubah Program</h1>
      </div>
      <AdminProgramForm
        program={{
          id: program.id,
          slug: program.slug,
          title: program.title,
          sector: program.sector,
          problem: program.problem,
          beneficiaries: program.beneficiaries,
          location: program.location,
          activities: program.activities,
          budget: program.budget,
          timeline: program.timeline,
          kpis: program.kpis,
          documentation: program.documentation,
          impactReport: program.impactReport,
          reportedAmount: program.reportedAmount,
          reportedAsOf: program.reportedAsOf ? program.reportedAsOf.toISOString().slice(0, 10) : null,
          reportedNote: program.reportedNote,
        }}
      />
    </div>
  );
}
