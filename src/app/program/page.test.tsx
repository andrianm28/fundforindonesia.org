import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeProgramDb, programRow, type ProgramRow } from '../../../tests/support/in-memory-program-db';

/**
 * The public CSR portfolio page, /program (ticket csr-04; PRD FFI-09): a
 * Sector card for each of the four fixed Sectors, every Program named and
 * linked to its own detail page.
 *
 * A Program takes no money online (ADR 0002), so the test asks what a visitor
 * can actually do here: read a Sector, follow a Program, and nothing that
 * starts a Donation.
 */

const holder = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('../../../tests/support/in-memory-program-db').makeProgramDb>,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, { get: (_target, key: string) => (holder.db.prisma as Record<string, unknown>)[key] }),
}));

import ProgramPortfolioPage from './page';

function program(slug: string, sector: ProgramRow['sector'], overrides: Partial<ProgramRow> = {}): ProgramRow {
  return programRow({ id: slug, slug, title: slug, sector, ...overrides });
}

async function renderPage() {
  return render(await ProgramPortfolioPage());
}

/** Every link on the page, as "href|text". */
function links(container: HTMLElement): string[] {
  return [...container.querySelectorAll('a')].map((a) => `${a.getAttribute('href')}|${a.textContent ?? ''}`);
}

afterEach(cleanup);

describe('/program', () => {
  it('shows a card for each of the four fixed Sectors, in the fixed order', async () => {
    holder.db = makeProgramDb({ programs: [program('klinik-keliling', 'HEALTH')] });

    const { container } = await renderPage();

    const headings = [...container.querySelectorAll('h2')].map((h) => h.textContent);
    expect(headings).toEqual(['Kesehatan', 'Pendidikan', 'Lingkungan', 'Inklusi Penyandang Disabilitas']);
  });

  it('names every Program under its own Sector, linked to its detail page', async () => {
    holder.db = makeProgramDb({
      programs: [
        program('klinik-keliling', 'HEALTH', { title: 'Klinik Keliling Pesisir' }),
        program('sekolah-lapang', 'EDUCATION', { title: 'Sekolah Lapang Petani' }),
      ],
    });

    await renderPage();

    const health = screen.getByRole('heading', { name: 'Kesehatan' }).closest('section')!;
    expect([...health.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/program/klinik-keliling']);
    expect(health.textContent).toContain('Klinik Keliling Pesisir');
    expect(health.textContent).not.toContain('Sekolah Lapang Petani');
  });

  it('says so when a Sector has no Program yet, rather than dropping the Sector', async () => {
    holder.db = makeProgramDb({ programs: [program('klinik-keliling', 'HEALTH')] });

    await renderPage();

    const environment = screen.getByRole('heading', { name: 'Lingkungan' }).closest('section')!;
    expect(environment.textContent).toContain('Belum ada Program');
  });

  it('shows the budget, location and timeline a CSR team reads first', async () => {
    holder.db = makeProgramDb({
      programs: [
        program('klinik-keliling', 'HEALTH', {
          budget: 500_000_000,
          location: 'Pesisir Utara, Jawa Barat',
          timeline: 'Jan–Des 2027',
        }),
      ],
    });

    const { container } = await renderPage();

    expect(container.textContent).toContain('Rp500.000.000');
    expect(container.textContent).toContain('Pesisir Utara, Jawa Barat');
    expect(container.textContent).toContain('Jan–Des 2027');
  });

  it('sends a reader to the detail page and to the partnership team, never to a Donation', async () => {
    holder.db = makeProgramDb({ programs: [program('klinik-keliling', 'HEALTH')] });

    const { container } = await renderPage();

    expect(links(container)).toEqual(expect.arrayContaining(['/program/klinik-keliling|klinik-keliling']));
    expect(container.querySelectorAll('form')).toHaveLength(0);
    for (const href of [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '')) {
      expect(href).not.toMatch(/donat|donasi|checkout|bayar|payment/i);
    }
  });
});
