import { render, screen, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: { findMany: vi.fn() },
    volunteerTripStatusChange: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import AdminVolunteerTripsPage, { dynamic } from './page';

beforeEach(() => {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } } as never);
  vi.mocked(prisma.volunteerTripStatusChange.findMany).mockResolvedValue([] as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function tripsByStatus(active: object[], suspended: object[]) {
  vi.mocked(prisma.volunteerTrip.findMany).mockImplementation(((args: { where: { status: string } }) =>
    Promise.resolve(args.where.status === 'ACTIVE' ? active : suspended)) as never);
}

/**
 * ticket 38: the Admin page for Volunteer Trip Suspension -- Active Trips
 * (candidates to suspend) and Suspended ones (candidates to lift), each
 * with its control. The rules are the module's.
 */
describe('AdminVolunteerTripsPage', () => {
  it('is rendered per request', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('redirects home when there is no session user, reading nothing', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);
    await expect(AdminVolunteerTripsPage()).rejects.toThrow('NEXT_REDIRECT:/');
    expect(prisma.volunteerTrip.findMany).not.toHaveBeenCalled();
  });

  it('lists an Active Trip with a suspend control', async () => {
    tripsByStatus([{ id: 't1', slug: 'mengajar', title: 'Mengajar di Sebatik', fundraiserId: 'f1' }], []);

    render(await AdminVolunteerTripsPage());

    const row = screen.getByText('Mengajar di Sebatik').closest('tr')!;
    expect(within(row).getByLabelText(/alasan penangguhan/i)).toBeDefined();
    expect(within(row).getByRole('button', { name: /tangguhkan trip/i })).toBeDefined();
  });

  it('lists a Suspended Trip with a lift control', async () => {
    tripsByStatus([], [{ id: 't2', slug: 'banjir', title: 'Trip Banjir', fundraiserId: 'f2' }]);

    render(await AdminVolunteerTripsPage());

    const row = screen.getByText('Trip Banjir').closest('tr')!;
    expect(within(row).getByRole('button', { name: /cabut penangguhan/i })).toBeDefined();
  });

  it('shows no control on a Trip the signed-in Admin owns', async () => {
    tripsByStatus([{ id: 't1', slug: 'mengajar', title: 'Trip Saya', fundraiserId: 'admin-1' }], []);

    render(await AdminVolunteerTripsPage());

    const row = screen.getByText('Trip Saya').closest('tr')!;
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('shows no lift control on a Suspension the signed-in Admin imposed', async () => {
    tripsByStatus([], [{ id: 't2', slug: 'banjir', title: 'Trip Banjir', fundraiserId: 'f2' }]);
    vi.mocked(prisma.volunteerTripStatusChange.findMany).mockResolvedValue([
      { tripId: 't2', actorId: 'admin-1', createdAt: new Date('2026-09-30') },
    ] as never);

    render(await AdminVolunteerTripsPage());

    const row = screen.getByText('Trip Banjir').closest('tr')!;
    expect(within(row).queryByRole('button')).toBeNull();
    expect(within(row).getByText(/Admin lain/)).toBeDefined();
  });

  it('says so when there is nothing in either group', async () => {
    tripsByStatus([], []);

    render(await AdminVolunteerTripsPage());

    expect(screen.getByText(/tidak ada volunteer trip aktif/i)).toBeDefined();
    expect(screen.getByText(/tidak ada volunteer trip yang ditangguhkan/i)).toBeDefined();
  });
});
