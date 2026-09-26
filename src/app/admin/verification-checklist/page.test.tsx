import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import AdminChecklistPage from './page';

/**
 * The Admin checklist editor page (verification-request 04). The ADMIN gate
 * is the admin layout's (layout.test.tsx) and the rules are the API's; this
 * file proves each control sends the right request and shows the result.
 */
const ITEMS = [
  { id: 'a', label: 'KTP Fundraiser', required: true, position: 1, active: true },
  { id: 'b', label: 'Rencana anggaran', required: false, position: 2, active: true },
  { id: 'c', label: 'Bukti lama', required: true, position: 3, active: false },
];

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

let fetchMock: Mock;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/admin/verification-checklist' && !init?.method) return jsonResponse({ items: ITEMS });
    return jsonResponse({});
  });
  global.fetch = fetchMock as never;
});

afterEach(() => {
  cleanup();
});

async function rowOf(label: string) {
  render(<AdminChecklistPage />);
  return (await screen.findByDisplayValue(label)).closest('li') as HTMLElement;
}

function callsTo(url: string) {
  return fetchMock.mock.calls.filter(([u, init]) => u === url && init?.method);
}

describe('AdminChecklistPage', () => {
  it('lists every item in order, marking which are required and which inactive', async () => {
    render(<AdminChecklistPage />);

    const rows = await screen.findAllByRole('listitem');
    expect(rows.map((r) => (within(r).getByRole('textbox') as HTMLInputElement).value)).toEqual([
      'KTP Fundraiser',
      'Rencana anggaran',
      'Bukti lama',
    ]);
    expect((within(rows[0]).getByLabelText('Wajib') as HTMLInputElement).checked).toBe(true);
    expect((within(rows[1]).getByLabelText('Wajib') as HTMLInputElement).checked).toBe(false);
    expect(within(rows[2]).getByText('Nonaktif')).toBeTruthy();
    expect(within(rows[2]).getByRole('button', { name: 'Aktifkan' })).toBeTruthy();
    expect(within(rows[0]).getByRole('button', { name: 'Nonaktifkan' })).toBeTruthy();
  });

  it('offers no way to delete an item', async () => {
    await rowOf('KTP Fundraiser');

    expect(screen.queryByRole('button', { name: /hapus/i })).toBeNull();
  });

  it('adds an item', async () => {
    render(<AdminChecklistPage />);
    await screen.findByDisplayValue('KTP Fundraiser');

    fireEvent.change(screen.getByLabelText('Item baru'), { target: { value: 'Surat keterangan RT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tambah item' }));

    await waitFor(() => expect(callsTo('/api/admin/verification-checklist')).toHaveLength(1));
    const [, init] = callsTo('/api/admin/verification-checklist')[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ label: 'Surat keterangan RT', required: true });
  });

  it('saves a reworded label', async () => {
    const row = await rowOf('Rencana anggaran');

    fireEvent.change(within(row).getByRole('textbox'), { target: { value: 'RAB rinci' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Simpan' }));

    await waitFor(() => expect(callsTo('/api/admin/verification-checklist/b')).toHaveLength(1));
    const [, init] = callsTo('/api/admin/verification-checklist/b')[0];
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ label: 'RAB rinci' });
  });

  it('marks an item required or optional', async () => {
    const row = await rowOf('Rencana anggaran');

    fireEvent.click(within(row).getByLabelText('Wajib'));

    await waitFor(() => expect(callsTo('/api/admin/verification-checklist/b')).toHaveLength(1));
    expect(JSON.parse(callsTo('/api/admin/verification-checklist/b')[0][1].body)).toEqual({ required: true });
  });

  it('deactivates an active item and reactivates an inactive one', async () => {
    const row = await rowOf('KTP Fundraiser');

    fireEvent.click(within(row).getByRole('button', { name: 'Nonaktifkan' }));
    await waitFor(() => expect(callsTo('/api/admin/verification-checklist/a')).toHaveLength(1));
    const inactive = (screen.getByDisplayValue('Bukti lama').closest('li')) as HTMLElement;
    const reactivate = within(inactive).getByRole('button', { name: 'Aktifkan' }) as HTMLButtonElement;
    await waitFor(() => expect(reactivate.disabled).toBe(false));
    fireEvent.click(reactivate);

    await waitFor(() => expect(callsTo('/api/admin/verification-checklist/c')).toHaveLength(1));
    expect(JSON.parse(callsTo('/api/admin/verification-checklist/a')[0][1].body)).toEqual({ active: false });
    expect(JSON.parse(callsTo('/api/admin/verification-checklist/c')[0][1].body)).toEqual({ active: true });
  });

  it('moves an item up, and offers no move past either end', async () => {
    const row = await rowOf('Rencana anggaran');

    fireEvent.click(within(row).getByRole('button', { name: 'Naikkan' }));

    await waitFor(() => expect(callsTo('/api/admin/verification-checklist/b/move')).toHaveLength(1));
    expect(JSON.parse(callsTo('/api/admin/verification-checklist/b/move')[0][1].body)).toEqual({ direction: 'up' });
    const rows = screen.getAllByRole('listitem');
    expect((within(rows[0]).getByRole('button', { name: 'Naikkan' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(rows[2]).getByRole('button', { name: 'Turunkan' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the server's refusal", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (!init?.method) return jsonResponse({ items: ITEMS });
      return jsonResponse({ error: 'Label item checklist wajib diisi.' }, false);
    });
    const row = await rowOf('Rencana anggaran');

    fireEvent.change(within(row).getByRole('textbox'), { target: { value: ' ' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Simpan' }));

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Label item checklist wajib diisi.');
  });
});
