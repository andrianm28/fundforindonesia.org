import { render, screen, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

/**
 * The Volunteer dashboard (ticket 37): the signed-in Volunteer's own
 * Registrations with status, Refund status, a tiered cancel, a link to the
 * certificate and the list of completed Trips. Not behind the registration
 * flag: someone who already registered can always see their records.
 */

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
const view = vi.hoisted(() => ({ listVolunteerRegistrations: vi.fn() }));
vi.mock('@/lib/volunteer/registration-view', () => view);
const auth = vi.hoisted(() => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => auth);
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import DashboardPage, * as pageModule from './page';

const START = new Date('2026-10-20T00:00:00Z');
const END = new Date('2026-10-24T00:00:00Z');
const reg = (over: Record<string, unknown> = {}) => ({
  id: 'reg-1',
  status: 'CONFIRMED',
  holdExpiresAt: new Date(Date.now() + 60_000),
  trip: { slug: 'sumba', title: 'Mengajar di Sumba', destination: 'Sumba' },
  batch: { startDate: START, endDate: END },
  tripFee: 2_500_000,
  paidAmount: 2_500_000,
  cancelRefundAmount: 1_250_000,
  refunds: [],
  paymentInstructions: null,
  certificateCode: null,
  ...over,
});

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_VOLUNTEER_ENABLED', '');
  auth.getServerSession.mockResolvedValue({ user: { id: 'v1' } });
  view.listVolunteerRegistrations.mockResolvedValue({ registrations: [], completed: [] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  view.listVolunteerRegistrations.mockReset();
  auth.getServerSession.mockReset();
});

describe('Volunteer dashboard', () => {
  it('is rendered per request', () => {
    expect(pageModule.dynamic).toBe('force-dynamic');
  });

  it('sends a signed-out visitor to sign in, coming back here', async () => {
    auth.getServerSession.mockResolvedValue(null);
    await expect(DashboardPage()).rejects.toThrow('NEXT_REDIRECT:/login?callbackUrl=%2Fakun%2Fvolunteer');
  });

  it('asks for the signed-in Volunteer only', async () => {
    render(await DashboardPage());
    expect(view.listVolunteerRegistrations).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'v1' }),
    );
  });

  it('says so when there is nothing yet, in both sections', async () => {
    render(await DashboardPage());
    expect(screen.getByText('Belum ada Registrasi Volunteer.')).toBeInTheDocument();
    expect(screen.getByText('Belum ada Trip yang selesai diikuti.')).toBeInTheDocument();
  });

  it('shows each Registration with its status, Trip, dates and a link to its page', async () => {
    view.listVolunteerRegistrations.mockResolvedValue({ registrations: [reg()], completed: [] });
    render(await DashboardPage());
    const card = screen.getByRole('article');
    expect(within(card).getByText('Mengajar di Sumba')).toBeInTheDocument();
    expect(within(card).getByText('Terkonfirmasi')).toBeInTheDocument();
    expect(within(card).getByText(/20 Okt 2026 - 24 Okt 2026/)).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Lihat detail' })).toHaveAttribute('href', '/volunteer-trip/registrasi/reg-1');
  });

  it('shows the countdown and "Lanjutkan pembayaran" on a HOLD', async () => {
    view.listVolunteerRegistrations.mockResolvedValue({
      registrations: [
        reg({
          status: 'HOLD',
          paidAmount: null,
          cancelRefundAmount: 0,
          paymentInstructions: { redirectUrl: 'https://pay.example/abc', vaNumber: null },
        }),
      ],
      completed: [],
    });
    render(await DashboardPage());
    expect(screen.getByText('Menunggu pembayaran')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lanjutkan pembayaran' })).toHaveAttribute('href', 'https://pay.example/abc');
  });

  it('offers cancel on a live Registration but not on an expired or cancelled one', async () => {
    view.listVolunteerRegistrations.mockResolvedValue({
      registrations: [reg({ id: 'a' }), reg({ id: 'b', status: 'EXPIRED' }), reg({ id: 'c', status: 'CANCELLED' })],
      completed: [],
    });
    render(await DashboardPage());
    expect(screen.getAllByRole('button', { name: 'Batalkan Registrasi' })).toHaveLength(1);
  });

  it('shows Refund status where there is a Refund', async () => {
    view.listVolunteerRegistrations.mockResolvedValue({
      registrations: [reg({ status: 'CANCELLED', refunds: [{ id: 'rf', amount: 1_250_000, status: 'REQUESTED' }] })],
      completed: [],
    });
    render(await DashboardPage());
    expect(screen.getByText(/1\.250\.000 - Diajukan/)).toBeInTheDocument();
  });

  it('links the certificate once issued, and only then', async () => {
    view.listVolunteerRegistrations.mockResolvedValue({
      registrations: [reg({ id: 'a', certificateCode: 'abcdefghijklmnopqrstuv' }), reg({ id: 'b' })],
      completed: [],
    });
    render(await DashboardPage());
    const links = screen.getAllByRole('link', { name: 'Lihat sertifikat' });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/sertifikat/abcdefghijklmnopqrstuv');
  });

  it('lists completed Trips as Catatan kontribusi: title, destination, dates, no impact figures', async () => {
    view.listVolunteerRegistrations.mockResolvedValue({
      registrations: [],
      completed: [{ registrationId: 'reg-1', title: 'Mengajar di Sumba', destination: 'Sumba', startDate: START, endDate: END }],
    });
    render(await DashboardPage());
    const section = screen.getByRole('region', { name: 'Catatan kontribusi' });
    expect(within(section).getByText('Mengajar di Sumba')).toBeInTheDocument();
    expect(within(section).getByText('Sumba')).toBeInTheDocument();
    expect(within(section).getByText(/20 Okt 2026 - 24 Okt 2026/)).toBeInTheDocument();
  });

  it('renders Trip text as text, not markup', async () => {
    view.listVolunteerRegistrations.mockResolvedValue({
      registrations: [reg({ trip: { slug: 's', title: '<b>x</b>', destination: 'd' } })],
      completed: [],
    });
    const { container } = render(await DashboardPage());
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText('<b>x</b>')).toBeInTheDocument();
  });
});
