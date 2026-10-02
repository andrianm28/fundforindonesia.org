import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { ProgramNotFoundError, readProgram, SECTOR_LABEL, type ProgramDetail } from '@/lib/programs';
import { readProgramMoney } from '@/lib/program-money';
import { formatRupiah } from '@/lib/utils/currency';
import { PartnershipInquiryForm } from '@/components/program/PartnershipInquiryForm';

/**
 * The public Program detail page, /program/[slug] (ticket csr-04; PRD
 * FFI-09): everything a CSR team needs to judge a Program without a proposal
 * being written from scratch -- problem, target beneficiaries, location,
 * activities, budget, timeline, KPIs, documentation, impact report -- and the
 * "Discuss with Our Team" action that starts the conversation.
 *
 * It reads through readProgram (src/lib/programs.ts), the same call
 * GET /api/programs/[slug] makes, so the page and the API cannot disagree
 * about what a Program is.
 *
 * A Program never takes money online (ADR 0002), so the page has no Donation
 * control, no payment method, and no amount a visitor could give: the budget
 * is a plan to be discussed, and the only action is a conversation. CSR money
 * is shown as two figures in two boxes (csr-08): the ledger-backed Program
 * Balance, and the plain figure reported for money that never crossed the
 * platform's account, labelled as outside the books. They are never added.
 * The free-text note behind the reported figure is not public.
 *
 * Rendered per request, not prerendered, for the reason the portfolio and the
 * Impact page give: the Docker build has no database, so a baked page would
 * ship an empty Program forever.
 */
export const dynamic = 'force-dynamic';

interface ProgramDetailPageProps {
  params: Promise<{ slug: string }>;
}

/**
 * The Program a slug names, or null when no Program has it. A database that
 * is down is not a missing Program, so only the module's own refusal becomes
 * null here; anything else propagates and fails the request loudly.
 */
async function programOrNull(slug: string): Promise<ProgramDetail | null> {
  try {
    return await readProgram(prisma, slug);
  } catch (error) {
    if (error instanceof ProgramNotFoundError) return null;
    throw error;
  }
}

export async function generateMetadata({ params }: ProgramDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const program = await programOrNull(slug);

  if (!program) return { title: 'Program Tidak Ditemukan' };

  return {
    title: `${program.title} - Fund for Indonesia`,
    description: `Program ${SECTOR_LABEL[program.sector]} di ${program.location}: ${program.problem}`,
  };
}

/** One labelled field, in the order a CSR team reads them. */
function Field({ label, testId, children }: { label: string; testId: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary mb-1">{label}</h2>
      <div data-testid={`program-field-${testId}`} className="text-text leading-relaxed">
        {children}
      </div>
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-text-secondary">Belum ada.</p>;
  return (
    <ul className="list-disc pl-5 space-y-1">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

/** The portfolio anchor of the Sector this Program belongs to. */
function sectorAnchor(program: ProgramDetail): string {
  return SECTOR_LABEL[program.sector].toLowerCase().replace(/\s+/g, '-');
}

export default async function ProgramDetailPage({ params }: ProgramDetailPageProps) {
  const { slug } = await params;
  const program = await programOrNull(slug);
  if (!program) notFound();
  const money = await readProgramMoney(prisma, program.id);

  return (
    <article className="max-w-3xl mx-auto px-4 py-8 md:py-12">
      <p className="text-sm mb-2">
        <Link href="/program" className="text-primary hover:underline">
          Portfolio CSR
        </Link>
        {' / '}
        <Link href={`/program#${sectorAnchor(program)}`} className="text-primary hover:underline">
          {SECTOR_LABEL[program.sector]}
        </Link>
      </p>

      <h1 className="text-3xl font-bold text-text mb-2">{program.title}</h1>
      <p className="text-text-secondary mb-4">
        Program tidak menerima sumbangan daring. Kemitraannya dibahas dengan tim kami, bukan dibayar di
        halaman ini.
      </p>
      <p className="mb-8">
        <a
          href="#diskusi"
          className="inline-block px-4 py-2 text-sm font-medium text-white bg-primary rounded-md"
        >
          Discuss with Our Team
        </a>
      </p>

      <Field label="Masalah yang dijawab" testId="problem">
        {program.problem}
      </Field>
      <Field label="Penerima manfaat" testId="beneficiaries">
        {program.beneficiaries}
      </Field>
      <Field label="Lokasi" testId="location">
        {program.location}
      </Field>
      <Field label="Kegiatan" testId="activities">
        {program.activities}
      </Field>
      <Field label="Anggaran" testId="budget">
        {formatRupiah(program.budget)}
      </Field>
      <Field label="Linimasa" testId="timeline">
        {program.timeline}
      </Field>
      <Field label="KPI" testId="kpis">
        <Bullets items={program.kpis} />
      </Field>
      <Field label="Dokumentasi" testId="documentation">
        {program.documentation.length === 0 ? (
          <p className="text-text-secondary">Belum ada.</p>
        ) : (
          <ul className="list-disc pl-5 space-y-1">
            {program.documentation.map((item) => (
              <li key={item}>
                <a href={item} className="text-primary hover:underline" rel="noopener noreferrer" target="_blank">
                  {item}
                </a>
              </li>
            ))}
          </ul>
        )}
      </Field>
      <Field label="Laporan dampak" testId="impact-report">
        {program.impactReport ? (
          program.impactReport
        ) : (
          <p className="text-text-secondary">Belum ada laporan dampak untuk Program ini.</p>
        )}
      </Field>

      <section aria-labelledby="dana-csr-heading" className="mb-10">
        <h2 id="dana-csr-heading" className="text-sm font-semibold uppercase tracking-wide text-text-secondary mb-3">
          Dana CSR pada Program ini
        </h2>
        {money.reconciled ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div data-testid="program-money-in-books" className="rounded-lg border border-border p-4">
              <p className="text-sm font-medium text-text">Di dalam pembukuan platform</p>
              <p className="text-2xl font-bold text-text">{formatRupiah(money.inTheBooks)}</p>
              <p className="text-sm text-text-secondary mt-1">
                Program Balance: dana yang masuk lewat rekening platform dan tercatat di buku besar.
              </p>
            </div>
            <div data-testid="program-money-off-books" className="rounded-lg border border-dashed border-border p-4">
              <p className="text-sm font-medium text-text">Di luar pembukuan platform</p>
              {money.outsideTheBooks.amount > 0 ? (
                <>
                  <p className="text-2xl font-bold text-text">{formatRupiah(money.outsideTheBooks.amount)}</p>
                  <p className="text-sm text-text-secondary mt-1">
                    Angka yang dilaporkan{money.outsideTheBooks.asOf ? ` per ${formatDate(money.outsideTheBooks.asOf)}` : ''}{' '}
                    untuk dana CSR yang tidak pernah melewati rekening platform. Tidak ada catatan buku besar di
                    baliknya, jadi platform tidak dapat memverifikasinya.
                  </p>
                </>
              ) : (
                <p className="text-sm text-text-secondary mt-1">
                  Belum ada dana di luar pembukuan yang dilaporkan untuk Program ini.
                </p>
              )}
            </div>
          </div>
        ) : (
          <p data-testid="program-money-unavailable" className="text-sm text-text-secondary">
            Dana CSR untuk Program ini sedang tidak dapat ditampilkan karena pembukuannya sedang kami periksa.
          </p>
        )}
      </section>

      <section id="diskusi" aria-labelledby="diskusi-heading" className="mt-10 rounded-lg border border-border p-6">
        <h2 id="diskusi-heading" className="text-xl font-semibold text-text mb-2">
          Mulai diskusi
        </h2>
        <p className="text-text-secondary mb-4">
          Ceritakan perusahaan Anda dan apa yang ingin dibahas tentang Program ini. Tim kemitraan kami yang
          menghubungi kembali, lewat email yang Anda tuliskan.
        </p>
        <PartnershipInquiryForm programId={program.id} programSlug={program.slug} />
      </section>
    </article>
  );
}
