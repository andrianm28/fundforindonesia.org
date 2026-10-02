import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/prisma', () => ({ prisma: { volunteerTrip: { findMany: vi.fn(), findUnique: vi.fn() } } }));

import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import FundraiserTripsPage, { dynamic as listDynamic } from './page';
import FundraiserTripPage, { dynamic as detailDynamic } from './[slug]/page';
import NewTripPage from './baru/page';

const mockSession = getServerSession as unknown as Mock;
const findMany = prisma.volunteerTrip.findMany as unknown as Mock;
const findUnique = prisma.volunteerTrip.findUnique as unknown as Mock;

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trip-1',
    slug: 'sumba',
    title: 'Mengajar di Sumba',
    description: 'd',
    story: 's',
    coverImage: 'https://example.com/c.jpg',
    destination: 'Sumba Timur',
    itinerary: 'i',
    tripFeeAmount: 1_500_000,
    status: 'DRAFT',
    fundraiserId: 'owner-1',
    batches: [],
    statusChanges: [],
    ...overrides,
  };
}

const batch = (overrides: Record<string, unknown> = {}) => ({
  id: 'b1',
  startDate: new Date('2026-12-01T00:00:00Z'),
  endDate: new Date('2026-12-05T00:00:00Z'),
  registrationDeadline: new Date('2026-11-20T00:00:00Z'),
  maxQuota: 10,
  minQuota: 2,
  status: 'OPEN',
  registrations: [
    { id: 'r1', status: 'CONFIRMED', attended: false, volunteer: { name: 'Budi' } },
    { id: 'r2', status: 'CONFIRMED', attended: false, volunteer: { name: 'Sari' } },
  ],
  ...overrides,
});

const renderDetail = async (slug = 'sumba') => render(await FundraiserTripPage({ params: Promise.resolve({ slug }) }));

describe('Fundraiser Trip screens (ticket 35)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'owner-1', assignments: [] } });
  });
  afterEach(cleanup);

  it('reads the database per request', () => {
    expect(listDynamic).toBe('force-dynamic');
    expect(detailDynamic).toBe('force-dynamic');
  });

  it('sends a signed-out visitor to login from every screen', async () => {
    mockSession.mockResolvedValue(null);
    await expect(FundraiserTripsPage()).rejects.toThrow('NEXT_REDIRECT:/login');
    await expect(NewTripPage()).rejects.toThrow('NEXT_REDIRECT:/login');
    await expect(renderDetail()).rejects.toThrow('NEXT_REDIRECT:/login');
  });

  it('lists the caller\'s Trips with their status label, asking for no assignment', async () => {
    findMany.mockResolvedValue([
      { slug: 'sumba', title: 'Mengajar di Sumba', destination: 'Sumba', status: 'REJECTED', _count: { batches: 1 } },
    ]);
    render(await FundraiserTripsPage());
    expect(screen.getByText('Mengajar di Sumba')).toBeDefined();
    expect(screen.getByText('Ditolak')).toBeDefined();
    expect(findMany.mock.calls[0][0].where).toEqual({ fundraiserId: 'owner-1' });
  });

  it('shows the rejection reason as plain text: markup in it is not interpreted', async () => {
    const reason = '<img src=x onerror=alert(1)><b>kurang</b>';
    findUnique.mockResolvedValue(record({ status: 'REJECTED', statusChanges: [{ reason }] }));
    const { container } = await renderDetail();
    expect(screen.getByText(reason)).toBeDefined();
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('shows no rejection reason on a Draft, and offers the form and submit', async () => {
    findUnique.mockResolvedValue(record());
    await renderDetail();
    expect(screen.queryByText('Alasan penolakan')).toBeNull();
    expect(screen.getByRole('button', { name: 'Ajukan ke Verifier' })).toBeDefined();
    expect(screen.getByLabelText('Judul')).toBeDefined();
  });

  it('is not found for a Trip owned by someone else', async () => {
    findUnique.mockResolvedValue(record({ fundraiserId: 'someone-else' }));
    await expect(renderDetail()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('freezes the content of a Submitted Trip: no form, no submit', async () => {
    findUnique.mockResolvedValue(record({ status: 'SUBMITTED' }));
    await renderDetail();
    expect(screen.queryByLabelText('Judul')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ajukan ke Verifier' })).toBeNull();
  });

  it('offers cancel and complete on an OPEN Batch, every confirmed Volunteer ticked', async () => {
    findUnique.mockResolvedValue(record({ status: 'ACTIVE', batches: [batch()] }));
    await renderDetail();
    expect(screen.getByRole('button', { name: 'Batalkan Batch' })).toBeDefined();
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => b.checked)).toBe(true);
  });

  it('shows Batch dates as WIB calendar dates, whatever zone the process runs in', async () => {
    const original = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      // 20 Nov 2026 00:00 WIB is 19 Nov 17:00 UTC; the deadline is 20 Nov 23:59:59 WIB.
      findUnique.mockResolvedValue(
        record({
          status: 'ACTIVE',
          batches: [
            batch({
              startDate: new Date('2026-11-19T17:00:00Z'),
              endDate: new Date('2026-11-24T16:59:59Z'),
              registrationDeadline: new Date('2026-11-10T16:59:59Z'),
            }),
          ],
        }),
      );
      await renderDetail();
      expect(screen.getByText(/20 Nov 2026 sampai 24 Nov 2026 · pendaftaran sampai 10 Nov 2026/)).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: 'Ubah Batch' }));
      expect((document.getElementById('start-b1') as HTMLInputElement).value).toBe('2026-11-20');
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('shows attendance of a COMPLETED Batch and no actions', async () => {
    findUnique.mockResolvedValue(
      record({
        status: 'ACTIVE',
        batches: [
          batch({
            status: 'COMPLETED',
            registrations: [
              { id: 'r1', status: 'CONFIRMED', attended: true, volunteer: { name: 'Budi' } },
              { id: 'r2', status: 'CONFIRMED', attended: false, volunteer: { name: 'Sari' } },
            ],
          }),
        ],
      }),
    );
    await renderDetail();
    expect(screen.getByText('1 dari 2 Volunteer hadir.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Batalkan Batch' })).toBeNull();
  });

  it('takes no new Batch once the Trip is Cancelled', async () => {
    findUnique.mockResolvedValue(record({ status: 'CANCELLED' }));
    await renderDetail();
    expect(screen.queryByText('Tambah Batch')).toBeNull();
  });
});
