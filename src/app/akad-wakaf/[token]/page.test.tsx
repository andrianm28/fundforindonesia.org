import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * The print page (CONTEXT.md, Akad Wakaf) looks an Akad Wakaf up by its
 * token alone -- same gate as the Receipt page -- and hands AkadWakafView
 * exactly what it needs to render.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: {
    akadWakaf: { findUnique: vi.fn() },
  },
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

const view = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock('@/components/akad-wakaf/AkadWakafView', () => ({
  AkadWakafView: (props: Record<string, unknown>) => {
    view.props = props;
    return null;
  },
}));

import { prisma } from '@/lib/prisma';
import AkadWakafPage from './page';

const mockFindUnique = prisma.akadWakaf.findUnique as unknown as ReturnType<typeof vi.fn>;

function makeAkadWakaf(overrides: Record<string, unknown> = {}) {
  return {
    id: 'akad-1',
    token: 'tok-1',
    createdAt: new Date('2026-09-26T10:00:00.000Z'),
    donation: {
      id: 'donation-1',
      amount: 500_000,
      donorId: 'donor-1',
      guestName: null,
      donor: { id: 'donor-1', name: 'Sari' },
      campaign: {
        title: 'Wakaf Pembangunan Masjid Al-Ikhlas',
        collectingEntity: { name: 'Yayasan Contoh' },
      },
    },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  view.props = null;
});

describe('AkadWakafPage', () => {
  it('renders the Akad Wakaf for a valid token, naming the Wakif, purpose and nazhir', async () => {
    mockFindUnique.mockResolvedValue(makeAkadWakaf());

    render(await AkadWakafPage({ params: Promise.resolve({ token: 'tok-1' }) }));

    expect(view.props).toMatchObject({
      wakifName: 'Sari',
      amount: 500_000,
      purpose: 'Wakaf Pembangunan Masjid Al-Ikhlas',
      nazhirName: 'Yayasan Contoh',
    });
  });

  it('falls back to the Guest Donor name when there is no account', async () => {
    mockFindUnique.mockResolvedValue(
      makeAkadWakaf({ donation: { ...makeAkadWakaf().donation, donorId: null, donor: null, guestName: 'Budi' } }),
    );

    render(await AkadWakafPage({ params: Promise.resolve({ token: 'tok-1' }) }));

    expect(view.props).toMatchObject({ wakifName: 'Budi' });
  });

  it('names an anonymised Wakif "Wakif anonim" rather than leaving the name empty (ticket 36)', async () => {
    mockFindUnique.mockResolvedValue(
      makeAkadWakaf({
        donation: {
          ...makeAkadWakaf().donation,
          donorId: null,
          donor: null,
          guestName: null,
          anonymisedAt: new Date('2026-10-02T08:00:00.000Z'),
        },
      }),
    );

    render(await AkadWakafPage({ params: Promise.resolve({ token: 'tok-1' }) }));

    expect(view.props).toMatchObject({ wakifName: 'Wakif anonim' });
  });

  it('answers not found for a token that names no Akad Wakaf', async () => {
    mockFindUnique.mockResolvedValue(null);

    await expect(AkadWakafPage({ params: Promise.resolve({ token: 'missing' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });
});
