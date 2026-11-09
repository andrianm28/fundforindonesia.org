import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AdminOperationsForm } from './AdminOperationsForm';

const originalFetch = global.fetch;
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

const INITIAL = {
  donationsOpen: true,
  maintenanceOn: false,
  maintenanceMessage: '',
  donationPresets: [20000, 50000, 100000],
};

function mockFetch(response: { ok: boolean; status: number; body?: unknown }) {
  const fn = vi.fn().mockResolvedValue({ ok: response.ok, status: response.status, json: async () => response.body ?? {} });
  global.fetch = fn as never;
  return fn;
}

function typePresets(text: string) {
  fireEvent.change(screen.getByLabelText('Preset nominal donasi'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: /simpan/i }));
}

describe('AdminOperationsForm', () => {
  it('shows the server 409 message when another Admin saved first', async () => {
    const message = 'Setelan berubah, muat ulang halaman lalu coba lagi.';
    mockFetch({ ok: false, status: 409, body: { error: message } });
    render(<AdminOperationsForm initial={INITIAL} />);

    fireEvent.click(screen.getByLabelText('Mode pemeliharaan'));
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    expect((await screen.findByRole('alert')).textContent).toBe(message);
  });

  it('reads "5.000; 10000" as 5000 and 10000 (a dot between groups of three digits is a thousands separator)', async () => {
    const fetchMock = mockFetch({ ok: true, status: 200 });
    render(<AdminOperationsForm initial={INITIAL} />);

    typePresets('5.000; 10000');

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ donationPresets: [5000, 10000] });
  });

  it.each(['1.5', '1.50', '1.2345', '12.500.5', '1..000', '.500'])(
    'does not turn "%s" into a bigger number: it goes up as not-a-number for the server to refuse',
    async (text) => {
      const fetchMock = mockFetch({ ok: false, status: 400, body: { error: 'Nominal preset harus berupa angka.' } });
      render(<AdminOperationsForm initial={INITIAL} />);

      typePresets(`${text}, 20000, 30000`);

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ donationPresets: [null, 20000, 30000] });
    },
  );
});
