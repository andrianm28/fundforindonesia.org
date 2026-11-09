import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { AdminHomeCuration, type CurationItem } from './AdminHomeCuration';

const fetchMock = vi.fn();

const item = (id: string, label: string, detail = ''): CurationItem => ({ id, label, detail });

const props = {
  pilihan: [item('a', 'Campaign A', 'Ditandai oleh Rina'), item('b', 'Campaign B')],
  unggulan: [] as CurationItem[],
  sorotan: [] as CurationItem[],
  campaignOptions: [item('a', 'Campaign A'), item('b', 'Campaign B'), item('c', 'Campaign C')],
  prayerOptions: [item('p1', 'Semoga lekas sembuh')],
};

const section = (name: string) => screen.getByRole('region', { name });

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  global.fetch = fetchMock as unknown as typeof fetch;
  refresh.mockReset();
});
afterEach(cleanup);

function sentBody(): unknown {
  const [, init] = fetchMock.mock.calls[0];
  return JSON.parse((init as { body: string }).body);
}

describe('AdminHomeCuration', () => {
  it('shows who marked each item and when it was marked', () => {
    render(<AdminHomeCuration {...props} />);
    expect(within(section('Pilihan Kami')).getByText('Ditandai oleh Rina')).toBeDefined();
  });

  it('adds a Campaign to the end of the slot and saves the whole list in order', async () => {
    render(<AdminHomeCuration {...props} />);
    const pilihan = within(section('Pilihan Kami'));

    fireEvent.change(pilihan.getByLabelText('Tambah campaign'), { target: { value: 'c' } });
    fireEvent.click(pilihan.getByText('Tambah'));
    fireEvent.click(pilihan.getByText('Simpan'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/kurasi');
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe('PUT');
    expect(sentBody()).toEqual({ slot: 'PILIHAN', ids: ['a', 'b', 'c'] });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('moves an item up and removes another, then saves that order', async () => {
    render(<AdminHomeCuration {...props} />);
    const pilihan = within(section('Pilihan Kami'));

    fireEvent.click(pilihan.getByLabelText('Naikkan Campaign B'));
    fireEvent.click(pilihan.getByLabelText('Hapus Campaign A'));
    fireEvent.click(pilihan.getByText('Simpan'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody()).toEqual({ slot: 'PILIHAN', ids: ['b'] });
  });

  it('does not offer a Campaign already in the slot', () => {
    render(<AdminHomeCuration {...props} />);
    const options = within(section('Pilihan Kami')).getByLabelText('Tambah campaign') as HTMLSelectElement;
    expect([...options.options].map((o) => o.value)).toEqual(['', 'c']);
  });

  it('saves the Prayer highlights as their own slot', async () => {
    render(<AdminHomeCuration {...props} />);
    const sorotan = within(section('Sorotan doa'));

    fireEvent.change(sorotan.getByLabelText('Tambah doa'), { target: { value: 'p1' } });
    fireEvent.click(sorotan.getByText('Tambah'));
    fireEvent.click(sorotan.getByText('Simpan'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody()).toEqual({ slot: 'SOROTAN_DOA', ids: ['p1'] });
  });

  it('shows the server refusal in its own words and does not refresh', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Ada id yang tidak ditemukan.' }) });
    render(<AdminHomeCuration {...props} />);

    fireEvent.click(within(section('Pilihan Kami')).getByText('Simpan'));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Ada id yang tidak ditemukan.'));
    expect(refresh).not.toHaveBeenCalled();
  });
});
