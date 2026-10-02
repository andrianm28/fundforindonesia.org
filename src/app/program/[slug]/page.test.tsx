import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeProgramDb, programRow, programCredit, programUnexplainedEntry } from '../../../../tests/support/in-memory-program-db';

/**
 * The public Program detail page, /program/[slug] (ticket csr-04; PRD
 * FFI-09): everything a CSR team needs to judge a Program without a proposal
 * being written from scratch, and a "Discuss with Our Team" action that opens
 * the Partnership Inquiry form.
 *
 * A Program takes no money online (ADR 0002), so the last group of tests asks
 * what a visitor cannot do here: there is no Donation control, no payment
 * method, and no link that starts a gift. The CSR money boxes (csr-08) show
 * the ledger-backed Program Balance and the off-books reported figure apart.
 */

const holder = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('../../../../tests/support/in-memory-program-db').makeProgramDb>,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, { get: (_target, key: string) => (holder.db.prisma as Record<string, unknown>)[key] }),
}));

import ProgramDetailPage, { generateMetadata } from './page';

async function renderPage(slug = 'klinik-keliling') {
  return render(await ProgramDetailPage({ params: Promise.resolve({ slug }) }));
}

/** The labelled value the page printed for one field. */
function valueFor(label: string): string {
  const cell = screen.getByTestId(`program-field-${label}`);
  return cell.textContent ?? '';
}

afterEach(cleanup);

describe('/program/[slug]', () => {
  it('shows every field a CSR team reads to judge the Program', async () => {
    holder.db = makeProgramDb({ programs: [programRow({ slug: 'klinik-keliling' })] });

    await renderPage();

    expect(valueFor('problem')).toContain('Akses layanan kesehatan dasar');
    expect(valueFor('beneficiaries')).toContain('1.000 warga pesisir');
    expect(valueFor('location')).toContain('Pesisir Utara, Jawa Barat');
    expect(valueFor('activities')).toContain('Pemeriksaan rutin');
    expect(valueFor('budget')).toBe('Rp500.000.000');
    expect(valueFor('timeline')).toContain('Jan–Des 2027');
  });

  it('lists every KPI, every documentation link, and the impact report', async () => {
    holder.db = makeProgramDb({
      programs: [
        programRow({
          slug: 'klinik-keliling',
          kpis: ['1.000 warga terlayani', 'Rujukan tepat waktu 90%'],
          documentation: ['https://contoh.test/rencana.pdf', 'https://contoh.test/laporan.pdf'],
          impactReport: 'Quarter pertama: 240 pemeriksaan.',
        }),
      ],
    });

    const { container } = await renderPage();

    expect(valueFor('kpis')).toContain('1.000 warga terlayani');
    expect(valueFor('kpis')).toContain('Rujukan tepat waktu 90%');
    expect(container.querySelector('a[href="https://contoh.test/rencana.pdf"]')).not.toBeNull();
    expect(container.querySelector('a[href="https://contoh.test/laporan.pdf"]')).not.toBeNull();
    expect(valueFor('impact-report')).toContain('Quarter pertama: 240 pemeriksaan.');
  });

  it('says a Program has no impact report yet, rather than showing an empty section', async () => {
    holder.db = makeProgramDb({ programs: [programRow({ slug: 'klinik-keliling', impactReport: null })] });

    await renderPage();

    expect(valueFor('impact-report')).toContain('Belum ada laporan dampak');
  });

  it('names the Sector it belongs to, as a link back to that card of the portfolio', async () => {
    holder.db = makeProgramDb({ programs: [programRow({ slug: 'klinik-keliling' })] });

    const { container } = await renderPage();

    expect(screen.getByRole('link', { name: 'Kesehatan' }).getAttribute('href')).toBe('/program#kesehatan');
    expect(container.textContent).toContain('Program tidak menerima sumbangan daring');
  });

  it('not found for a slug no Program has', async () => {
    holder.db = makeProgramDb({ programs: [programRow({ slug: 'klinik-keliling' })] });

    await expect(ProgramDetailPage({ params: Promise.resolve({ slug: 'tidak-ada' }) })).rejects.toThrow();
  });

  it('names the Program and the Sector in its page metadata', async () => {
    holder.db = makeProgramDb({ programs: [programRow({ slug: 'klinik-keliling' })] });

    const metadata = await generateMetadata({ params: Promise.resolve({ slug: 'klinik-keliling' }) });

    expect(metadata.title).toBe('Klinik Keliling Pesisir - Fund for Indonesia');
    expect(metadata.description).toContain('Pesisir Utara');
  });
});

describe('the Partnership Inquiry action on a Program page', () => {
  it('offers "Discuss with Our Team" and opens the inquiry form about this Program', async () => {
    holder.db = makeProgramDb({ programs: [programRow({ slug: 'klinik-keliling' })] });

    await renderPage();

    const action = screen.getByRole('link', { name: /discuss with our team/i });
    expect(action.getAttribute('href')).toBe('#diskusi');

    const form = document.querySelector('#diskusi form');
    expect(form).not.toBeNull();
    expect(form?.getAttribute('data-program-slug')).toBe('klinik-keliling');
    // The Program is named by the page, not typed by the company, and it is
    // the id the endpoint of ticket csr-05 resolves.
    expect(form?.querySelector('input[name="programId"]')?.getAttribute('value')).toBe('program-1');
    for (const field of ['companyName', 'contactName', 'contactEmail', 'contactPhone', 'needs']) {
      expect(form?.querySelector(`[name="${field}"]`)).not.toBeNull();
    }
  });
});

describe('/program/[slug] surfaces nothing a Program cannot be', () => {
  it('has no Donation control, no payment method, and no link that starts a gift', async () => {
    holder.db = makeProgramDb({ programs: [programRow({ slug: 'klinik-keliling' })] });

    const { container } = await renderPage();

    expect(screen.queryByRole('button', { name: /donasi|bayar|beri|give|donate/i })).toBeNull();
    expect(container.innerHTML).not.toMatch(/qris|virtual account|transfer bank|e-?wallet/i);
    // The only forms on the page are the partnership conversation: the one
    // about the Program, and none that take money.
    for (const form of [...container.querySelectorAll('form')]) {
      expect(form.getAttribute('data-program-slug') ?? form.closest('#diskusi')?.id).toBeTruthy();
    }
    for (const anchor of [...container.querySelectorAll('a')]) {
      const href = anchor.getAttribute('href') ?? '';
      expect(href).not.toMatch(/donat|donasi|checkout|bayar|payment|\/campaign\//i);
    }
  });

  it('shows the off-books reported figure, labelled as outside the books, beside the ledger-backed Program Balance', async () => {
    holder.db = makeProgramDb({
      programs: [
        programRow({
          id: 'program-1',
          slug: 'klinik-keliling',
          reportedAmount: 50_000_000,
          reportedAsOf: new Date('2026-09-30T00:00:00Z'),
          reportedNote: 'Dana CSR mitra via yayasan X.',
        }),
      ],
      ledgerEntries: programCredit('program-1', 20_000_000),
    });

    await renderPage();

    const inBooks = screen.getByTestId('program-money-in-books');
    const outside = screen.getByTestId('program-money-off-books');
    expect(inBooks.textContent).toContain('Rp20.000.000');
    expect(inBooks.textContent).toMatch(/di dalam pembukuan/i);
    expect(outside.textContent).toContain('Rp50.000.000');
    expect(outside.textContent).toMatch(/di luar pembukuan platform/i);
    expect(outside.textContent).toContain('30 September 2026');
    // Each figure sits in its own box: neither contains the other's number.
    expect(inBooks.textContent).not.toContain('Rp50.000.000');
    expect(outside.textContent).not.toContain('Rp20.000.000');
  });

  it('never prints the two figures as one total, and never prints the free-text note', async () => {
    holder.db = makeProgramDb({
      programs: [
        programRow({ id: 'program-1', slug: 'klinik-keliling', reportedAmount: 50_000_000, reportedNote: 'Dana CSR mitra via yayasan X.' }),
      ],
      ledgerEntries: programCredit('program-1', 20_000_000),
    });

    const { container } = await renderPage();

    expect(container.textContent).not.toContain('Rp70.000.000');
    expect(container.textContent).not.toContain('yayasan X');
  });

  it('REGRESSION: money that never crossed the account shows zero in the books and posts nothing to the ledger', async () => {
    holder.db = makeProgramDb({
      programs: [programRow({ id: 'program-1', slug: 'klinik-keliling', reportedAmount: 50_000_000 })],
    });

    await renderPage();

    expect(screen.getByTestId('program-money-in-books').textContent).toContain('Rp0');
    expect(screen.getByTestId('program-money-off-books').textContent).toContain('Rp50.000.000');
    expect(holder.db.ledgerEntries).toHaveLength(0);
  });

  it('shows another Program\'s ledger money on that Program only', async () => {
    holder.db = makeProgramDb({
      programs: [programRow({ id: 'program-1', slug: 'klinik-keliling' })],
      ledgerEntries: programCredit('program-2', 9_000_000),
    });

    await renderPage();

    expect(screen.getByTestId('program-money-in-books').textContent).toContain('Rp0');
  });

  it('says plainly when nothing has been reported outside the books', async () => {
    holder.db = makeProgramDb({ programs: [programRow({ id: 'program-1', slug: 'klinik-keliling', reportedAmount: 0 })] });

    await renderPage();

    expect(screen.getByTestId('program-money-off-books').textContent).toMatch(/belum ada/i);
  });

  describe('when the Program does not reconcile (same rule as /impact)', () => {
    it('hides the CSR block and says why, but still renders the page', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      holder.db = makeProgramDb({
        programs: [programRow({ id: 'program-1', slug: 'klinik-keliling', reportedAmount: 50_000_000 })],
        ledgerEntries: programUnexplainedEntry('program-1', 500),
      });

      await renderPage();

      expect(screen.queryByTestId('program-money-in-books')).toBeNull();
      expect(screen.queryByTestId('program-money-off-books')).toBeNull();
      expect(screen.getByTestId('program-money-unavailable').textContent).toMatch(/tidak dapat ditampilkan/i);
      expect(valueFor('problem')).toContain('Akses layanan kesehatan dasar');
    });

    it('hides it for a negative balance even when contributions explain it', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      holder.db = makeProgramDb({
        programs: [programRow({ id: 'program-1', slug: 'klinik-keliling' })],
        ledgerEntries: [
          ...programCredit('program-1', 100),
          { account: 'PROGRAM_BALANCE', direction: 'DEBIT', amount: 300, programId: 'program-1', manualContributionId: 'manual-contribution-2' },
        ],
      });

      await renderPage();

      expect(screen.queryByTestId('program-money-in-books')).toBeNull();
      expect(screen.getByTestId('program-money-unavailable')).toBeTruthy();
    });

    it('does not hide this Program\'s block because of a broken book elsewhere', async () => {
      holder.db = makeProgramDb({
        programs: [programRow({ id: 'program-1', slug: 'klinik-keliling' })],
        ledgerEntries: programUnexplainedEntry('program-2', 500),
      });

      await renderPage();

      expect(screen.getByTestId('program-money-in-books').textContent).toContain('Rp0');
    });
  });
});
