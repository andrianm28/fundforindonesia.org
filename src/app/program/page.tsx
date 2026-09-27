import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { listProgramPortfolio } from '@/lib/programs';
import { formatRupiah } from '@/lib/utils/currency';

/**
 * The public CSR portfolio, /program (ticket csr-04; PRD FFI-09): a card for
 * each of the four fixed Sectors, every Program named and linked to its own
 * detail page.
 *
 * The page reads through listProgramPortfolio (src/lib/programs.ts), the same
 * call GET /api/programs makes, so the page and the API cannot disagree about
 * which Sectors exist, what order they are in, or which fields a card carries.
 *
 * A Program never takes money online (ADR 0002), so there is nothing here
 * that collects anything. What a CSR team does next is talk to us: the detail
 * page carries the Partnership Inquiry action (FFI-10).
 *
 * Rendered per request, not prerendered, for the same reason as the homepage
 * and the Impact page: the Docker build has no database, so a baked page
 * would ship an empty portfolio forever.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Portfolio CSR - Fund for Indonesia',
  description:
    'Program CSR yang siap dikolaborasi, dikelompokkan menurut keempat sektor: Kesehatan, Pendidikan, Lingkungan, dan Inklusi Penyandang Disabilitas.',
};

/** The anchor a Sector card is known by, so a Program page can link back to it. */
function anchorOf(label: string): string {
  return label.toLowerCase().replace(/\s+/g, '-');
}

export default async function ProgramPortfolioPage() {
  const portfolio = await listProgramPortfolio(prisma);

  return (
    <article className="max-w-5xl mx-auto px-4 py-8 md:py-12">
      <h1 className="text-3xl font-bold text-text mb-3">Portfolio CSR</h1>
      <p className="text-text-secondary leading-relaxed mb-2 max-w-3xl">
        Program yang sudah siap dikerjakan, dikelompokkan menurut sektor. Baca detailnya, lalu bicarakan
        kemitraannya dengan tim kami.
      </p>
      <p className="text-text-secondary leading-relaxed mb-10 max-w-3xl">
        Program tidak menerima sumbangan daring. Setiap rupiah yang masuk lewat Campaign, bukan lewat
        Program.
      </p>

      {portfolio.sectors.map((group) => (
        <section
          key={group.sector}
          id={anchorOf(group.label)}
          aria-labelledby={`sector-${group.sector}`}
          className="mb-12"
        >
          <h2 id={`sector-${group.sector}`} className="text-xl font-semibold text-text mb-1">
            {group.label}
          </h2>
          <p className="text-sm text-text-secondary mb-4">{group.programs.length} Program</p>

          {group.programs.length === 0 ? (
            <p className="text-text-secondary">Belum ada Program di sektor ini.</p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {group.programs.map((program) => (
                <li key={program.slug} className="rounded-lg border border-border p-5 bg-white flex flex-col gap-2">
                  <h3 className="text-lg font-semibold text-text">
                    <Link href={`/program/${program.slug}`} className="hover:text-primary">
                      {program.title}
                    </Link>
                  </h3>
                  <dl className="text-sm text-text-secondary grid gap-1">
                    <div className="flex gap-2">
                      <dt>Lokasi:</dt>
                      <dd>{program.location}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt>Anggaran:</dt>
                      <dd>{formatRupiah(program.budget)}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt>Linimasa:</dt>
                      <dd>{program.timeline}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </article>
  );
}
