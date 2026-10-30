import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import { ChangeRequestForm } from './ChangeRequestForm';

/** Ticket 72: an Active Campaign asks for a new target and/or deadline. */
let respond: () => Response;
const posted: { url: string; body: unknown }[] = [];

beforeEach(() => {
  posted.length = 0;
  respond = () => Response.json({}, { status: 201 });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      posted.push({ url, body: JSON.parse(String(init?.body)) });
      return respond();
    }),
  );
});

afterEach(() => {
  cleanup();
  mockRefresh.mockReset();
  vi.unstubAllGlobals();
});

function renderForm(props: Partial<Parameters<typeof ChangeRequestForm>[0]> = {}) {
  return render(
    <ChangeRequestForm slug="sumur" kind="DONATION" targetAmount={50_000_000} deadline="2099-12-31" waiting={false} {...props} />,
  );
}

describe('ChangeRequestForm', () => {
  it('starts from the current target and deadline', () => {
    renderForm();
    expect((screen.getByLabelText(/Target Donasi baru/) as HTMLInputElement).value).toBe('50.000.000');
    expect((screen.getByLabelText(/Batas Waktu/) as HTMLInputElement).value).toBe('2099-12-31');
  });

  it('sends only what changed, to the change-requests route', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/Target Donasi baru/), { target: { value: '75000000' } });

    fireEvent.click(screen.getByRole('button', { name: 'Ajukan Perubahan' }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(posted).toEqual([{ url: '/api/campaigns/sumur/change-requests', body: { targetAmount: 75_000_000 } }]);
    expect(await screen.findByText(/Pengajuan perubahan terkirim/)).toBeDefined();
  });

  it('sends a new deadline as the end of the picked WIB day', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/Batas Waktu/), { target: { value: '2100-03-31' } });

    fireEvent.click(screen.getByRole('button', { name: 'Ajukan Perubahan' }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].body).toEqual({ deadline: '2100-03-31T16:59:59.999Z' });
  });

  it('does not call the server when nothing changed', async () => {
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Ajukan Perubahan' }));

    expect(await screen.findByText('Ubah target atau tenggat terlebih dahulu.')).toBeDefined();
    expect(posted).toHaveLength(0);
  });

  it("shows the server's refusal, such as a request already waiting", async () => {
    respond = () =>
      Response.json(
        { error: 'Masih ada Verification Request yang menunggu keputusan Verifier untuk Campaign ini.', code: 'CHANGE_REQUEST_ALREADY_PENDING' },
        { status: 409 },
      );
    renderForm();
    fireEvent.change(screen.getByLabelText(/Target Donasi baru/), { target: { value: '80000000' } });

    fireEvent.click(screen.getByRole('button', { name: 'Ajukan Perubahan' }));

    expect(await screen.findByText(/Masih ada Verification Request yang menunggu/)).toBeDefined();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('says a request is waiting instead of offering another', () => {
    renderForm({ waiting: true });
    expect(screen.getByTestId('change-request-waiting')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Ajukan Perubahan' })).toBeNull();
  });
});
