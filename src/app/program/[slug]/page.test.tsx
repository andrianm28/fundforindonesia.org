import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeProgramDb, programRow } from '../../../../tests/support/in-memory-program-db';

/**
 * The public Program detail page, /program/[slug] (ticket csr-04; PRD
 * FFI-09): everything a CSR team needs to judge a Program without a proposal
 * being written from scratch, and a "Discuss with Our Team" action that opens
 * the Partnership Inquiry form.
 *
 * A Program takes no money online (ADR 0002), so the last group of tests asks
 * what a visitor cannot do here: there is no Donation control, no payment
 * method, and no link that starts a gift. The reported off-books figure is
 * deliberately absent -- csr-08 puts it beside the ledger-backed Program
 * Balance, which does not exist until csr-07.
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

  it('leaves the off-books reported figure to ticket csr-08, which shows it beside Program Balance', async () => {
    holder.db = makeProgramDb({
      programs: [programRow({ slug: 'klinik-keliling', reportedAmount: 50_000_000, reportedNote: 'Dana CSR mitra.' })],
    });

    const { container } = await renderPage();

    expect(container.textContent).not.toContain('Rp50.000.000');
    expect(container.innerHTML).not.toMatch(/di luar pembukuan/i);
  });
});
