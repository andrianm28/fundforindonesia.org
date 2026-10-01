import { render, screen, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

/**
 * The Volunteer Trip detail page, /volunteer-trip/[slug] (ticket 33): the
 * route decideTripSubmission's notification already links to. It shows the
 * Trip and a picker of its Batches (dates, seats left of the maximum quota,
 * registration deadline). Ticket 36 adds the Daftar button; until then none
 * is shown.
 */

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
const catalog = vi.hoisted(() => ({ getTripDetail: vi.fn() }));
vi.mock('@/lib/volunteer/catalog', () => catalog);
const auth = vi.hoisted(() => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => auth);
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

import TripDetailPage, * as pageModule from './page';

const batch = (o: Record<string, unknown>) => ({
  id: 'b1',
  startDate: new Date(2026, 11, 1),
  endDate: new Date(2026, 11, 7),
  registrationDeadline: new Date(2026, 10, 20),
  maxQuota: 20,
  seatsLeft: 12,
  availability: 'OPEN',
  ...o,
});

const detail = (batches: unknown[]) => ({
  slug: 'mengajar-di-pulau-terpencil',
  title: 'Mengajar di Pulau Terpencil',
  description: 'Seminggu mengajar.',
  story: 'Cerita perjalanan.',
  coverImage: 'https://example.com/cover.jpg',
  destination: 'Pulau Sebatik',
  itinerary: 'Hari 1: tiba.',
  tripFeeAmount: 2_500_000,
  batches,
});

const params = (slug = 'mengajar-di-pulau-terpencil') => ({ params: Promise.resolve({ slug }) });

async function renderPage() {
  return render(await TripDetailPage(params()));
}

beforeEach(() => {
  catalog.getTripDetail.mockReset();
  auth.getServerSession.mockReset();
  auth.getServerSession.mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('/volunteer-trip/[slug]', () => {
  it('is rendered per request, since it reads the database', () => {
    expect(pageModule.dynamic).toBe('force-dynamic');
  });

  it('answers 404 when the Trip is not public', async () => {
    catalog.getTripDetail.mockResolvedValue(null);

    await expect(TripDetailPage(params('draft-trip'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(catalog.getTripDetail).toHaveBeenCalledWith(expect.anything(), 'draft-trip', expect.any(Date));
  });

  it('shows destination, itinerary, story and Trip Fee', async () => {
    catalog.getTripDetail.mockResolvedValue(detail([batch({})]));

    await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Mengajar di Pulau Terpencil' })).toBeInTheDocument();
    expect(screen.getByText('Pulau Sebatik')).toBeInTheDocument();
    expect(screen.getByText('Hari 1: tiba.')).toBeInTheDocument();
    expect(screen.getByText('Cerita perjalanan.')).toBeInTheDocument();
    expect(screen.getByText('Rp2.500.000')).toBeInTheDocument();
  });

  it('lists each Batch with dates, seats left of the maximum and the registration deadline', async () => {
    catalog.getTripDetail.mockResolvedValue(detail([batch({})]));

    await renderPage();

    const item = screen.getByRole('listitem');
    expect(within(item).getByText(/01 Des 2026/)).toBeInTheDocument();
    expect(within(item).getByText(/07 Des 2026/)).toBeInTheDocument();
    expect(within(item).getByText('12 dari 20 kursi tersisa')).toBeInTheDocument();
    expect(within(item).getByText(/20 Nov 2026/)).toBeInTheDocument();
  });

  it('marks a full Batch and a Batch past its deadline', async () => {
    catalog.getTripDetail.mockResolvedValue(
      detail([
        batch({ id: 'full', seatsLeft: 0, availability: 'FULL' }),
        batch({ id: 'closed', availability: 'CLOSED' }),
      ]),
    );

    await renderPage();

    expect(screen.getByText('Penuh')).toBeInTheDocument();
    expect(screen.getByText('Pendaftaran ditutup')).toBeInTheDocument();
  });

  it('shows no Daftar button while NEXT_PUBLIC_VOLUNTEER_ENABLED is off (the default)', async () => {
    vi.stubEnv('NEXT_PUBLIC_VOLUNTEER_ENABLED', '');
    catalog.getTripDetail.mockResolvedValue(detail([batch({})]));

    await renderPage();

    expect(screen.queryByText(/^Daftar/)).toBeNull();
  });

  it('with the flag on, links Daftar to the summary page of an OPEN Batch only', async () => {
    vi.stubEnv('NEXT_PUBLIC_VOLUNTEER_ENABLED', 'true');
    catalog.getTripDetail.mockResolvedValue(
      detail([batch({}), batch({ id: 'full', seatsLeft: 0, availability: 'FULL' })]),
    );

    await renderPage();

    const links = screen.getAllByRole('link', { name: 'Daftar' });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/volunteer-trip/mengajar-di-pulau-terpencil/daftar/b1');
  });

  it('sends a signed-out visitor to the sign-in page, coming back to this page', async () => {
    catalog.getTripDetail.mockResolvedValue(detail([batch({})]));

    const { container } = await renderPage();

    const login = [...container.querySelectorAll('a')].find((a) => a.textContent === 'Masuk');
    expect(login).toHaveAttribute('href', '/login?callbackUrl=%2Fvolunteer-trip%2Fmengajar-di-pulau-terpencil');
  });

  it('shows no sign-in link to a signed-in Volunteer', async () => {
    auth.getServerSession.mockResolvedValue({ user: { id: 'v1' } });
    catalog.getTripDetail.mockResolvedValue(detail([batch({})]));

    const { container } = await renderPage();

    expect([...container.querySelectorAll('a')].some((a) => a.textContent === 'Masuk')).toBe(false);
  });
});
