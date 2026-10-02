import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

/**
 * The Registration summary (/volunteer-trip/[slug]/daftar/[batchId]) and the
 * Registration page (/volunteer-trip/registrasi/[id]), ticket 36.
 */

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
const catalog = vi.hoisted(() => ({ getTripDetail: vi.fn() }));
vi.mock('@/lib/volunteer/catalog', () => catalog);
const view = vi.hoisted(() => ({ getVolunteerRegistration: vi.fn(), findOwnLiveRegistration: vi.fn() }));
vi.mock('@/lib/volunteer/registration-view', () => view);
const auth = vi.hoisted(() => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => auth);
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import SummaryPage, * as summaryModule from './[slug]/daftar/[batchId]/page';
import RegistrationPage, * as registrationModule from './registrasi/[id]/page';

const START = new Date('2026-10-20T00:00:00Z');
const trip = (availability = 'OPEN') => ({
  slug: 'sumba',
  title: 'Mengajar di Sumba',
  destination: 'Sumba',
  tripFeeAmount: 2_500_000,
  batches: [
    {
      id: 'b1',
      startDate: START,
      endDate: new Date('2026-10-24T00:00:00Z'),
      registrationDeadline: new Date('2026-10-10T00:00:00Z'),
      maxQuota: 10,
      seatsLeft: availability === 'OPEN' ? 3 : 0,
      availability,
    },
  ],
});
const summaryParams = { params: Promise.resolve({ slug: 'sumba', batchId: 'b1' }) };

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_VOLUNTEER_ENABLED', 'true');
  catalog.getTripDetail.mockReset();
  view.getVolunteerRegistration.mockReset();
  view.findOwnLiveRegistration.mockReset();
  view.findOwnLiveRegistration.mockResolvedValue(null);
  auth.getServerSession.mockReset();
  auth.getServerSession.mockResolvedValue({ user: { id: 'v1' } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('Registration summary page', () => {
  it('is rendered per request', () => {
    expect(summaryModule.dynamic).toBe('force-dynamic');
  });

  it('with the flag off says so and reads neither the session nor the database', async () => {
    vi.stubEnv('NEXT_PUBLIC_VOLUNTEER_ENABLED', '');
    render(await SummaryPage(summaryParams));
    expect(screen.getByText(/Pendaftaran Volunteer Trip belum dibuka/)).toBeInTheDocument();
    expect(auth.getServerSession).not.toHaveBeenCalled();
    expect(catalog.getTripDetail).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Daftar dan bayar/ })).toBeNull();
  });

  it('sends a signed-out visitor to sign in, coming back here', async () => {
    auth.getServerSession.mockResolvedValue(null);
    await expect(SummaryPage(summaryParams)).rejects.toThrow(
      'NEXT_REDIRECT:/login?callbackUrl=%2Fvolunteer-trip%2Fsumba%2Fdaftar%2Fb1',
    );
  });

  it('answers 404 for a Batch that is not on an ACTIVE Trip', async () => {
    catalog.getTripDetail.mockResolvedValue(trip());
    await expect(SummaryPage({ params: Promise.resolve({ slug: 'sumba', batchId: 'zzz' }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('shows Trip, dates, Trip Fee and the Refund table with this Batch dates before the pay button', async () => {
    catalog.getTripDetail.mockResolvedValue(trip());
    render(await SummaryPage(summaryParams));
    expect(screen.getByText('Mengajar di Sumba')).toBeInTheDocument();
    expect(screen.getAllByText(/2\.500\.000/).length).toBeGreaterThan(0);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Sampai 6 Okt 2026 07.00 WIB');
    expect(screen.getByText(/30 menit/)).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Daftar dan bayar' });
    const table = screen.getByRole('table');
    expect(table.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('points a Volunteer who already holds a seat here to that Registration instead of the pay button', async () => {
    catalog.getTripDetail.mockResolvedValue(trip());
    view.findOwnLiveRegistration.mockResolvedValue({ id: 'reg-9', status: 'HOLD' });
    render(await SummaryPage(summaryParams));
    expect(screen.getByRole('link', { name: 'Lihat Registrasi' })).toHaveAttribute('href', '/volunteer-trip/registrasi/reg-9');
    expect(screen.queryByRole('button', { name: /Daftar dan bayar/ })).toBeNull();
    expect(view.findOwnLiveRegistration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ batchId: 'b1', userId: 'v1' }),
    );
  });

  it('shows Batch dates in WIB: a Batch starting at midnight WIB shows that WIB date', async () => {
    const t = trip();
    t.batches[0].startDate = new Date('2026-10-19T17:00:00Z');
    catalog.getTripDetail.mockResolvedValue(t);
    render(await SummaryPage(summaryParams));
    expect(screen.getByText(/Batch 20 Okt 2026 -/)).toBeInTheDocument();
    expect(screen.getAllByRole('row')[1].textContent).toContain('Sampai 6 Okt 2026 00.00 WIB');
  });

  it.each([
    ['mock', 'bank_transfer'],
    ['sumopod', 'qris'],
  ])('charges through the method the %s provider supports (%s)', async (provider, method) => {
    vi.stubEnv('PAYMENT_PROVIDER', provider);
    vi.stubEnv('MOCK_MIDTRANS_SERVER_KEY', 'test-server-key');
    vi.stubEnv('SUMOPOD_API_KEY', 'test-key');
    vi.stubEnv('SUMOPOD_WEBHOOK_SECRET', 'test-secret');
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'x' }) });
    global.fetch = fetchMock as never;
    catalog.getTripDetail.mockResolvedValue(trip());
    render(await SummaryPage(summaryParams));
    fireEvent.click(screen.getByRole('button', { name: 'Daftar dan bayar' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ paymentMethod: method });
  });

  it('offers no pay button for a full Batch', async () => {
    catalog.getTripDetail.mockResolvedValue(trip('FULL'));
    render(await SummaryPage(summaryParams));
    expect(screen.getByText('Batch ini sudah penuh.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Daftar dan bayar/ })).toBeNull();
  });
});

describe('Registration page', () => {
  const NOW_ISH = Date.now();
  const reg = (over: Record<string, unknown>) => ({
    id: 'reg-1',
    status: 'CONFIRMED',
    holdExpiresAt: new Date(NOW_ISH + 60_000),
    trip: { slug: 'sumba', title: 'Mengajar di Sumba', destination: 'Sumba' },
    batch: { startDate: START, endDate: new Date('2026-10-24T00:00:00Z') },
    tripFee: 2_500_000,
    paidAmount: 2_500_000,
    cancelRefundAmount: 1_250_000,
    refunds: [],
    ...over,
  });
  const params = { params: Promise.resolve({ id: 'reg-1' }) };

  it('is rendered per request, and is not behind the flag', async () => {
    expect(registrationModule.dynamic).toBe('force-dynamic');
    vi.stubEnv('NEXT_PUBLIC_VOLUNTEER_ENABLED', '');
    view.getVolunteerRegistration.mockResolvedValue(reg({}));
    render(await RegistrationPage(params));
    expect(screen.getByText('Registrasi Terkonfirmasi')).toBeInTheDocument();
  });

  it('asks the data layer for the signed-in Volunteer own Registration, 404 when it is not theirs', async () => {
    view.getVolunteerRegistration.mockResolvedValue(null);
    await expect(RegistrationPage(params)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(view.getVolunteerRegistration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ registrationId: 'reg-1', userId: 'v1' }),
    );
  });

  it('shows the countdown for a HOLD, and cancel that promises no Refund for an unpaid hold', async () => {
    view.getVolunteerRegistration.mockResolvedValue(reg({ status: 'HOLD', paidAmount: null, cancelRefundAmount: 0 }));
    render(await RegistrationPage(params));
    expect(screen.getByText('Menunggu pembayaran')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Batalkan Registrasi' })).toBeInTheDocument();
  });

  it('shows Refund status for a cancelled Registration and offers no cancel', async () => {
    view.getVolunteerRegistration.mockResolvedValue(
      reg({ status: 'CANCELLED', refunds: [{ id: 'rf', amount: 1_250_000, status: 'REQUESTED' }] }),
    );
    render(await RegistrationPage(params));
    expect(screen.getByText(/1\.250\.000 - Diajukan/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Batalkan Registrasi' })).toBeNull();
  });
});
