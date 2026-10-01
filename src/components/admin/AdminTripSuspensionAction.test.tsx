import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import { AdminTripSuspensionAction } from './AdminTripSuspensionAction';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function ok(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
}

function refused(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: () => Promise.resolve(body) } as Response);
}

afterEach(() => {
  cleanup();
  mockFetch.mockReset();
  mockRefresh.mockReset();
});

/**
 * ticket 38: the Admin control that reaches suspendTrip and
 * liftTripSuspension (src/lib/volunteer/trip.ts) through
 * /api/admin/volunteer-trips/[id]/suspension. The server holds every rule;
 * this asks for a reason and shows the server's own refusal.
 */
describe('AdminTripSuspensionAction -- suspend an Active Trip', () => {
  const props = { tripId: 'trip-1', mode: 'suspend' as const, isOwnTrip: false, suspendedBySameAdmin: false };

  it('posts the reason to the Trip suspension route, then refreshes', async () => {
    mockFetch.mockImplementation(() => ok({ trip: { id: 'trip-1' } }));
    render(<AdminTripSuspensionAction {...props} />);

    fireEvent.change(screen.getByLabelText(/alasan penangguhan/i), { target: { value: 'Indikasi penipuan.' } });
    fireEvent.click(screen.getByRole('button', { name: /tangguhkan trip/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/admin/volunteer-trips/trip-1/suspension');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ reason: 'Indikasi penipuan.' });
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it('keeps the button disabled until a reason is typed', () => {
    render(<AdminTripSuspensionAction {...props} />);
    expect(screen.getByRole('button', { name: /tangguhkan trip/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/alasan penangguhan/i), { target: { value: 'Alasan.' } });
    expect(screen.getByRole('button', { name: /tangguhkan trip/i })).not.toBeDisabled();
  });

  it("shows the server's own refusal and does not refresh", async () => {
    mockFetch.mockImplementation(() =>
      refused(409, { error: 'Volunteer Trip ini tidak bisa ditangguhkan pada status ini.', code: 'TRIP_NOT_SUSPENDABLE' }),
    );
    render(<AdminTripSuspensionAction {...props} />);
    fireEvent.change(screen.getByLabelText(/alasan penangguhan/i), { target: { value: 'Alasan.' } });
    fireEvent.click(screen.getByRole('button', { name: /tangguhkan trip/i }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/tidak bisa ditangguhkan/);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('offers no control on their own Trip, only the reason it is not theirs to suspend', () => {
    render(<AdminTripSuspensionAction {...props} isOwnTrip />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/Fundraiser Volunteer Trip ini/)).toBeDefined();
  });
});

describe('AdminTripSuspensionAction -- lift a Suspension', () => {
  const props = { tripId: 'trip-1', mode: 'lift' as const, isOwnTrip: false, suspendedBySameAdmin: false };

  it('sends DELETE with the reason', async () => {
    mockFetch.mockImplementation(() => ok({ trip: { id: 'trip-1' } }));
    render(<AdminTripSuspensionAction {...props} />);

    fireEvent.change(screen.getByLabelText(/alasan pencabutan/i), { target: { value: 'Sudah diperiksa.' } });
    fireEvent.click(screen.getByRole('button', { name: /cabut penangguhan/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/admin/volunteer-trips/trip-1/suspension');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body)).toEqual({ reason: 'Sudah diperiksa.' });
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it('says another Admin must lift it when this Admin imposed it, with no button', () => {
    render(<AdminTripSuspensionAction {...props} suspendedBySameAdmin />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/Admin lain/)).toBeDefined();
  });

  it('offers no control on their own Trip', () => {
    render(<AdminTripSuspensionAction {...props} isOwnTrip />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
