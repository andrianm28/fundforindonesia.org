// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { useDonationPresets } from '@/components/donation/DonationPresetsContext';

/**
 * The donate page while an Admin has switched donations off (PKS ticket 01):
 * the donor sees the closed message at once, not after filling in an amount.
 * The page itself is a client component, so the server layout decides.
 */

const holder = vi.hoisted(() => {
  const h = {
    row: null as { key: string; value: unknown } | null,
    findUnique: null as unknown as ReturnType<typeof vi.fn>,
    kind: 'DONATION',
  };
  h.findUnique = vi.fn(async () => h.row);
  return h;
});
vi.mock('@/lib/prisma', () => ({
  prisma: {
    siteSetting: { findUnique: holder.findUnique },
    campaign: { findUnique: vi.fn(async () => ({ kind: holder.kind })) },
  },
}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

import DonateLayout from './layout';
import { DONATIONS_DISABLED_MESSAGE } from '@/lib/donations';

function Probe() {
  return <p>formulir donasi: {useDonationPresets().join(',')}</p>;
}

async function render(): Promise<string> {
  return renderToStaticMarkup(
    await DonateLayout({ children: <Probe />, params: Promise.resolve({ slug: 'banjir-demak' }) }),
  );
}

beforeEach(() => {
  holder.kind = 'DONATION';
  holder.row = null;
  holder.findUnique.mockClear();
});

describe('donate layout for a zakat Campaign (ADR 0028)', () => {
  it('is a 404 while the zakat module is off (the default)', async () => {
    holder.kind = 'ZAKAT';
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('shows the form once the module is on', async () => {
    holder.kind = 'ZAKAT';
    holder.row = {
      key: 'operations',
      value: {
        donationsOpen: true,
        maintenance: { on: false, message: '' },
        history: [],
        zakat: { enabled: true, nisabAmount: 85_000_000, recipientOrganisationId: 'org-1' },
      },
    };
    expect(await render()).toContain('formulir donasi');
  });
});

describe('donate layout', () => {
  it('shows the closed message, with a way back to the Campaign, and no form, while donations are switched off', async () => {
    holder.row = {
      key: 'operations',
      value: { donationsOpen: false, maintenance: { on: false, message: '' }, history: [] },
    };

    const html = await render();

    expect(html).toContain(DONATIONS_DISABLED_MESSAGE);
    expect(html).toContain('href="/campaign/banjir-demak"');
    expect(html).not.toContain('formulir donasi');
  });

  it('shows the form while donations are open or the switch was never set', async () => {
    expect(await render()).toContain('formulir donasi');
    holder.row = {
      key: 'operations',
      value: { donationsOpen: true, maintenance: { on: false, message: '' }, history: [] },
    };
    expect(await render()).toContain('formulir donasi');
  });

  it('hands the stored presets to the page, and the defaults when the row is empty or damaged', async () => {
    const row = (donationPresets: unknown) => ({
      key: 'operations',
      value: { donationsOpen: true, maintenance: { on: false, message: '' }, history: [], donationPresets },
    });
    holder.row = row([5000, 15000, 30000]);
    expect(await render()).toContain('formulir donasi: 5000,15000,30000');

    holder.row = row([5, 15000]);
    expect(await render()).toContain('formulir donasi: 20000,50000,100000,250000,500000');

    holder.row = null;
    expect(await render()).toContain('formulir donasi: 20000,50000,100000,250000,500000');
  });

  it('reads the operations row once per request, for the switch and the presets together', async () => {
    await render();
    expect(holder.findUnique).toHaveBeenCalledTimes(1);
  });
});
