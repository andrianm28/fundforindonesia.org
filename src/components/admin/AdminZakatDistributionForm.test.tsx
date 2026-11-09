import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AdminZakatDistributionForm } from './AdminZakatDistributionForm';

const originalFetch = global.fetch;
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

function mockFetch(response: { ok: boolean; status: number; body?: unknown }) {
  const fn = vi.fn().mockResolvedValue({ ok: response.ok, status: response.status, json: async () => response.body ?? {} });
  global.fetch = fn as never;
  return fn;
}

function fill() {
  fireEvent.change(screen.getByLabelText('Nominal (Rp)'), { target: { value: '500.000' } });
  fireEvent.change(screen.getByLabelText('Golongan penerima (asnaf)'), { target: { value: 'MISKIN' } });
  fireEvent.change(screen.getByLabelText('Tanggal penyaluran'), { target: { value: '2026-11-08' } });
  fireEvent.change(screen.getByLabelText('Ringkasan penerima'), { target: { value: '25 keluarga di Desa Contoh' } });
}

describe('AdminZakatDistributionForm', () => {
  it('posts the record as whole rupiah to the Admin API, and says it moves no money', async () => {
    const fetchMock = mockFetch({ ok: true, status: 201 });
    render(<AdminZakatDistributionForm remaining={2_000_000} />);

    expect(screen.getByText(/tidak memindahkan uang/i)).toBeDefined();
    fill();
    fireEvent.click(screen.getByRole('button', { name: /catat penyaluran/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/zakat/distributions');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      amount: 500_000,
      asnaf: 'MISKIN',
      distributedAt: '2026-11-08',
      recipientSummary: '25 keluarga di Desa Contoh',
    });
  });

  it('shows the server refusal, such as more than was received', async () => {
    const message = 'Penyaluran melebihi zakat yang diterima lembaga. Sisa yang bisa dicatat: Rp0.';
    mockFetch({ ok: false, status: 409, body: { error: message } });
    render(<AdminZakatDistributionForm remaining={0} />);

    fill();
    fireEvent.click(screen.getByRole('button', { name: /catat penyaluran/i }));

    expect((await screen.findByRole('alert')).textContent).toBe(message);
  });

  it('offers the eight asnaf', () => {
    render(<AdminZakatDistributionForm remaining={1} />);
    expect(screen.getByLabelText('Golongan penerima (asnaf)').querySelectorAll('option')).toHaveLength(8);
  });
});
