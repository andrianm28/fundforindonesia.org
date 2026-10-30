import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

import { CampaignEditForm } from './CampaignEditForm';

/** Ticket 72: the Draft or Rejected edit screen, over the existing PATCH route. */
const STORY = 'Cerita lama yang cukup panjang untuk lolos dari batas minimal lima puluh karakter itu.';
const INITIAL = {
  kind: 'DONATION' as const,
  title: 'Sumur Desa',
  story: STORY,
  deadline: '2099-12-31',
  coverImage: '/uploads/cover.jpg',
  collectingEntityId: 'mitra-1',
  province: '32',
  regency: 'Kabupaten Garut',
  beneficiaryDescription: 'Anak yatim',
  beneficiaryCount: '40',
};

type Call = { url: string; init?: RequestInit };
let calls: Call[];
let patchResponse: () => Response;
let submitResponse: () => Response;

beforeEach(() => {
  calls = [];
  patchResponse = () => Response.json({ campaign: {} });
  submitResponse = () => Response.json({}, { status: 201 });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === '/api/partner-organisations/sponsors') {
        return Response.json({ own: null, sponsors: [{ id: 'mitra-1', name: 'Mitra Satu' }] });
      }
      if (url === '/api/upload') return Response.json({ url: '/uploads/baru.jpg' });
      if (init?.method === 'PATCH') return patchResponse();
      if (url.endsWith('/verification-requests')) return submitResponse();
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  mockPush.mockReset();
  vi.unstubAllGlobals();
});

function renderForm() {
  return render(
    <CampaignEditForm slug="sumur" initial={INITIAL} targetAmount={50_000_000} categoryName="Bencana Alam" />,
  );
}

const patches = () => calls.filter((c) => c.init?.method === 'PATCH');
const sentBody = (call: Call) => JSON.parse(String(call.init?.body));

describe('CampaignEditForm', () => {
  it('starts from what the Campaign holds and shows target and category as read-only', async () => {
    renderForm();

    expect((screen.getByLabelText(/Judul Campaign/) as HTMLInputElement).value).toBe('Sumur Desa');
    expect((screen.getByLabelText('Kind') as HTMLSelectElement).value).toBe('DONATION');
    expect((screen.getByLabelText(/Batas Waktu/) as HTMLInputElement).value).toBe('2099-12-31');
    expect((screen.getByLabelText(/Cerita Campaign/) as HTMLTextAreaElement).value).toBe(STORY);
    expect(screen.getByAltText('Preview cover')).toBeDefined();
    expect(screen.getByTestId('edit-target').textContent).toContain('50.000.000');
    expect(screen.getByTestId('edit-category').textContent).toContain('Bencana Alam');
    await screen.findByRole('combobox', { name: 'Collecting Entity' });
  });

  it('saves through PATCH with the edited fields, keeping the cover it already has, then returns to the list', async () => {
    renderForm();
    await screen.findByRole('combobox', { name: 'Collecting Entity' });
    fireEvent.change(screen.getByLabelText(/Judul Campaign/), { target: { value: '  Sumur Desa Baru ' } });

    fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/akun/kampanye-saya'));
    expect(patches()).toHaveLength(1);
    expect(patches()[0].url).toBe('/api/campaigns/sumur');
    expect(sentBody(patches()[0])).toMatchObject({
      title: 'Sumur Desa Baru',
      story: STORY,
      kind: 'DONATION',
      coverImage: '/uploads/cover.jpg',
      collectingEntityId: 'mitra-1',
      deadline: '2099-12-31T16:59:59.999Z',
    });
    expect(calls.some((c) => c.url === '/api/upload')).toBe(false);
  });

  it('shows the stored location and beneficiaries, and sends them back edited (ticket 74)', async () => {
    renderForm();
    await screen.findByRole('combobox', { name: 'Collecting Entity' });
    expect(screen.getByLabelText('Provinsi')).toHaveValue('32');
    expect(screen.getByLabelText('Kabupaten/Kota')).toHaveValue('Kabupaten Garut');
    expect(screen.getByLabelText('Penerima Manfaat')).toHaveValue('Anak yatim');
    expect(screen.getByLabelText('Jumlah Penerima Manfaat')).toHaveValue(40);

    fireEvent.change(screen.getByLabelText('Provinsi'), { target: { value: '33' } });
    fireEvent.change(screen.getByLabelText('Kabupaten/Kota'), { target: { value: ' Kota Semarang ' } });
    fireEvent.change(screen.getByLabelText('Jumlah Penerima Manfaat'), { target: { value: '55' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }));

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(sentBody(patches()[0])).toMatchObject({
      province: '33',
      regency: 'Kota Semarang',
      beneficiaryDescription: 'Anak yatim',
      beneficiaryCount: 55,
    });
  });

  it('clears what was emptied by sending null', async () => {
    renderForm();
    await screen.findByRole('combobox', { name: 'Collecting Entity' });
    fireEvent.change(screen.getByLabelText('Provinsi'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Jumlah Penerima Manfaat'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }));

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(sentBody(patches()[0])).toMatchObject({ province: null, beneficiaryCount: null });
  });

  it('holds back a beneficiary count that is not a positive whole number', async () => {
    renderForm();
    await screen.findByRole('combobox', { name: 'Collecting Entity' });
    fireEvent.change(screen.getByLabelText('Jumlah Penerima Manfaat'), { target: { value: '-3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }));

    expect(await screen.findByText(/harus bilangan bulat lebih dari 0/)).toBeDefined();
    expect(patches()).toHaveLength(0);
  });

  it('clears the deadline with null when a wakaf Campaign leaves it empty', async () => {
    renderForm();
    await screen.findByRole('combobox', { name: 'Collecting Entity' });
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'WAKAF' } });
    fireEvent.change(screen.getByLabelText(/Batas Waktu/), { target: { value: '' } });

    fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }));

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(sentBody(patches()[0])).toMatchObject({ kind: 'WAKAF', deadline: null });
  });

  it('uploads a newly picked cover first and sends its URL', async () => {
    const { container } = renderForm();
    await screen.findByRole('combobox', { name: 'Collecting Entity' });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:preview' });
    fireEvent.change(input, { target: { files: [new File(['x'], 'baru.png', { type: 'image/png' })] } });

    fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }));

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(sentBody(patches()[0]).coverImage).toBe('/uploads/baru.jpg');
  });

  it('holds back an invalid form without calling the server', async () => {
    renderForm();
    await screen.findByRole('combobox', { name: 'Collecting Entity' });
    fireEvent.change(screen.getByLabelText(/Judul Campaign/), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/Cerita Campaign/), { target: { value: 'pendek' } });

    fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }));

    expect(await screen.findByText('Judul campaign harus diisi')).toBeDefined();
    expect(screen.getByText('Cerita campaign minimal 50 karakter')).toBeDefined();
    expect(patches()).toHaveLength(0);
  });

  it("shows the server's refusal and stays on the screen", async () => {
    patchResponse = () => Response.json({ error: 'Campaign tidak dapat diedit pada status ini.' }, { status: 409 });
    renderForm();
    await screen.findByRole('combobox', { name: 'Collecting Entity' });

    fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }));

    expect(await screen.findByText('Campaign tidak dapat diedit pada status ini.')).toBeDefined();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('"Simpan dan Ajukan" saves, then submits to the Verifier', async () => {
    renderForm();
    await screen.findByRole('combobox', { name: 'Collecting Entity' });

    fireEvent.click(screen.getByRole('button', { name: 'Simpan dan Ajukan ke Verifier' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/akun/kampanye-saya'));
    const order = calls.filter((c) => c.init?.method).map((c) => `${c.init?.method} ${c.url}`);
    expect(order).toEqual(['PATCH /api/campaigns/sumur', 'POST /api/campaigns/sumur/verification-requests']);
  });

  it('keeps the saved edit and says so when the submission is refused', async () => {
    submitResponse = () => Response.json({ error: 'Dokumen wajib belum lengkap.' }, { status: 409 });
    renderForm();
    await screen.findByRole('combobox', { name: 'Collecting Entity' });

    fireEvent.click(screen.getByRole('button', { name: 'Simpan dan Ajukan ke Verifier' }));

    expect(await screen.findByText(/Perubahan tersimpan, tetapi belum diajukan: Dokumen wajib belum lengkap\./)).toBeDefined();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
