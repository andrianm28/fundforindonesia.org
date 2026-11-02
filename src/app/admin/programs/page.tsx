import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { parseSector, SECTORS, SECTOR_LABEL } from '@/lib/programs';

export const dynamic = 'force-dynamic';

/**
 * Program: the CSR catalog an Admin writes (CONTEXT.md, Program). Lists every
 * Program, optionally narrowed with `?sector=`; create and edit live on
 * /admin/programs/baru and /admin/programs/[id], through /api/admin/programs.
 * A Program takes no money online, so no amount of money collected shows here.
 */
export default async function AdminProgramsPage({
  searchParams,
}: {
  searchParams?: Promise<{ sector?: string }>;
}) {
  const asked = (await searchParams)?.sector;
  const sector = parseSector(asked);
  const programs = await prisma.program.findMany({
    where: sector === null ? {} : { sector },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Program</h1>
          <p className="mt-1 text-gray-600">
            Katalog Program CSR yang tampil di halaman publik Program. Program tidak menerima dana lewat platform.
          </p>
        </div>
        <Link href="/admin/programs/baru" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white">
          Tambah Program
        </Link>
      </div>

      <nav aria-label="Filter sektor" className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link href="/admin/programs" className={sector === null ? 'font-semibold text-primary' : 'text-gray-600'}>
          Semua
        </Link>
        {SECTORS.map((code) => (
          <Link
            key={code}
            href={`/admin/programs?sector=${code}`}
            className={sector === code ? 'font-semibold text-primary' : 'text-gray-600'}
          >
            {SECTOR_LABEL[code]}
          </Link>
        ))}
      </nav>

      <section className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-4 py-3">Judul</th>
              <th className="px-4 py-3">Sektor</th>
              <th className="px-4 py-3">Lokasi</th>
              <th className="px-4 py-3">Anggaran</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {programs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                  Belum ada Program.
                </td>
              </tr>
            )}
            {programs.map((p) => (
              <tr key={p.id} className="border-t border-gray-100">
                <td className="px-4 py-3">
                  {p.title}
                  <div className="font-mono text-xs text-gray-500">{p.slug}</div>
                </td>
                <td className="px-4 py-3">{SECTOR_LABEL[p.sector as keyof typeof SECTOR_LABEL]}</td>
                <td className="px-4 py-3">{p.location}</td>
                <td className="px-4 py-3">Rp{p.budget.toLocaleString('id-ID')}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/admin/programs/${p.id}`} className="text-primary">
                    Ubah
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
