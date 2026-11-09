import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import AdminPartnershipInquiriesPage from './page';

/**
 * The partnership team's CSR pipeline (tickets 06 and pks-pemenuhan/17). The
 * ADMIN gate is the admin layout's (layout.test.tsx) and the rules on moving
 * are the API's; what this file proves is that every Inquiry is shown in the
 * column of its stage with its Program, company, budget and PIC, that its
 * detail (contact, address, NPWP, proposal, history with notes) opens from the
 * card, and that saving sends exactly the stage, PIC and note that changed.
 */
const PROGRAM = (n: number, title: string, sector: string) => ({ id: `program-${n}`, slug: `p-${n}`, title, sector });

const INQUIRIES = [
  {
    id: 'inquiry-1',
    companyName: 'PT Sinar Abadi',
    contactName: 'Rina Wijaya',
    status: 'NEW',
    budgetRange: null,
    periodStart: null,
    periodEnd: null,
    hasProposal: false,
    pic: null,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    program: PROGRAM(1, 'Klinik Keliling Pesisir', 'HEALTH'),
    lastStatusChange: null,
  },
  {
    id: 'inquiry-2',
    companyName: 'PT Bumi Hijau',
    contactName: 'Dimas Prakoso',
    status: 'NEGOTIATION',
    budgetRange: 'OVER_1B',
    periodStart: '2027-01',
    periodEnd: '2027-12',
    hasProposal: true,
    pic: { id: 'admin-2', name: 'Bagas Kemitraan' },
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt: '2026-09-26T00:00:00.000Z',
    program: PROGRAM(2, 'Hutan Kota Randhir', 'ENVIRONMENT'),
    lastStatusChange: {
      fromStatus: 'PROPOSAL',
      toStatus: 'NEGOTIATION',
      actedById: 'admin-2',
      actedByName: 'Bagas Kemitraan',
      actedAt: '2026-09-26T00:00:00.000Z',
    },
  },
  {
    id: 'inquiry-3',
    companyName: 'CV Cahaya Muda',
    contactName: 'Lina Kusuma',
    status: 'DONE',
    budgetRange: 'UNDER_50M',
    periodStart: null,
    periodEnd: null,
    hasProposal: false,
    pic: null,
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-18T00:00:00.000Z',
    program: PROGRAM(3, 'Sekolah Malam Pesisir', 'EDUCATION'),
    lastStatusChange: null,
  },
];

const PICS = [
  { id: 'admin-1', name: 'Dewi Partnership' },
  { id: 'admin-2', name: 'Bagas Kemitraan' },
];

const DETAIL = {
  id: 'inquiry-2',
  companyName: 'PT Bumi Hijau',
  contactName: 'Dimas Prakoso',
  contactEmail: 'dimas@bumihijau.test',
  contactPhone: '+62 811 0000 000',
  companyAddress: 'Jl. Contoh Nomor 2, Kota Contoh',
  companyNpwp: '0'.repeat(15),
  needs: 'Kami ingin menanam 10.000 pohon.',
  status: 'NEGOTIATION',
  budgetRange: 'OVER_1B',
  periodStart: '2027-01',
  periodEnd: '2027-12',
  createdAt: '2026-09-25T00:00:00.000Z',
  program: PROGRAM(2, 'Hutan Kota Randhir', 'ENVIRONMENT'),
  pic: { id: 'admin-2', name: 'Bagas Kemitraan' },
  proposals: [{ id: 'doc-9', label: 'Proposal kolaborasi', contentType: 'application/pdf', sizeBytes: 1000, uploadedAt: '2026-09-25T00:00:00.000Z' }],
  history: [
    {
      id: 'c1',
      fromStatus: 'PROPOSAL',
      toStatus: 'NEGOTIATION',
      actedById: 'admin-2',
      actedByName: 'Bagas Kemitraan',
      actedAt: '2026-09-26T00:00:00.000Z',
      note: 'Rapat pertama sudah dilakukan.',
      picChanged: false,
      picFromName: null,
      picToName: null,
    },
  ],
};

const LIST = '/api/admin/partnership-inquiries';

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

let fetchMock: Mock;
let detail: unknown;

beforeEach(() => {
  detail = DETAIL;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === LIST && !init?.method) return jsonResponse({ inquiries: INQUIRIES, pics: PICS });
    if (url === `${LIST}/inquiry-2` && !init?.method) return jsonResponse({ inquiry: detail });
    return jsonResponse({ inquiry: { id: 'inquiry-2', status: 'APPROVED' } });
  });
  global.fetch = fetchMock as never;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function patches() {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');
}

function loadsOfTheList() {
  return fetchMock.mock.calls.filter(([u, init]) => u === LIST && !init?.method);
}

async function openDetailOfBumiHijau() {
  render(<AdminPartnershipInquiriesPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Kelola PT Bumi Hijau' }));
  return screen.findByRole('complementary', { name: 'Rincian Partnership Inquiry' });
}

describe('AdminPartnershipInquiriesPage pipeline', () => {
  it('shows a column for each of the eight stages, in order, with the number of Inquiries in each', async () => {
    render(<AdminPartnershipInquiriesPage />);

    const columns = await screen.findAllByRole('region', { name: /^Tahap / });

    expect(columns.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Tahap Baru',
      'Tahap Dihubungi',
      'Tahap Proposal',
      'Tahap Negosiasi',
      'Tahap Disetujui',
      'Tahap Berjalan',
      'Tahap Selesai',
      'Tahap Tidak dilanjutkan',
    ]);
    expect(within(columns[0]).getByText('1')).toBeTruthy();
    expect(within(columns[1]).getByText('0')).toBeTruthy();
  });

  it('puts each Inquiry in the column of its stage, with Program, company, budget, period and PIC', async () => {
    render(<AdminPartnershipInquiriesPage />);

    const negotiation = await screen.findByRole('region', { name: 'Tahap Negosiasi' });
    expect(within(negotiation).getByText('PT Bumi Hijau')).toBeTruthy();
    expect(negotiation.textContent).toContain('Hutan Kota Randhir');
    expect(negotiation.textContent).toContain('Dimas Prakoso');
    expect(negotiation.textContent).toContain('Di atas Rp1 miliar');
    expect(negotiation.textContent).toContain('2027-01');
    expect(negotiation.textContent).toContain('Bagas Kemitraan');
    expect(negotiation.textContent).toContain('Proposal terlampir');

    const fresh = await screen.findByRole('region', { name: 'Tahap Baru' });
    expect(within(fresh).getByText('PT Sinar Abadi')).toBeTruthy();
    expect(fresh.textContent).toContain('Belum ada PIC');
    const done = await screen.findByRole('region', { name: 'Tahap Selesai' });
    expect(within(done).getByText('CV Cahaya Muda')).toBeTruthy();
  });

  it('says so when the pipeline cannot be loaded', async () => {
    fetchMock = vi.fn(async () => jsonResponse({}, false));
    global.fetch = fetchMock as never;
    render(<AdminPartnershipInquiriesPage />);

    expect(await screen.findByText(/Gagal memuat/)).toBeTruthy();
  });
});

describe('AdminPartnershipInquiriesPage detail', () => {
  it('opens the Inquiry in full: contact, address, NPWP, needs, proposal link and the history with its notes', async () => {
    const panel = await openDetailOfBumiHijau();

    expect(panel.textContent).toContain('dimas@bumihijau.test');
    expect(panel.textContent).toContain('Jl. Contoh Nomor 2, Kota Contoh');
    expect(panel.textContent).toContain('0'.repeat(15));
    expect(panel.textContent).toContain('Kami ingin menanam 10.000 pohon.');
    expect(panel.textContent).toContain('Rapat pertama sudah dilakukan.');
    const link = within(panel).getByRole('link', { name: /Proposal kolaborasi/ });
    expect(link.getAttribute('href')).toBe('/api/documents/doc-9');
  });

  it('saves the stage, PIC and note that changed, and reloads both the pipeline and the detail', async () => {
    const panel = await openDetailOfBumiHijau();

    fireEvent.change(within(panel).getByLabelText('Tahap'), { target: { value: 'APPROVED' } });
    fireEvent.change(within(panel).getByLabelText('PIC'), { target: { value: 'admin-1' } });
    fireEvent.change(within(panel).getByLabelText('Catatan tindak lanjut'), { target: { value: 'Anggaran disetujui.' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Simpan perubahan' }));

    await waitFor(() => expect(patches()).toHaveLength(1));
    const [url, init] = patches()[0];
    expect(url).toBe(`${LIST}/inquiry-2`);
    expect(JSON.parse(String(init?.body))).toEqual({ status: 'APPROVED', picId: 'admin-1', note: 'Anggaran disetujui.' });
    await waitFor(() => expect(loadsOfTheList().length).toBe(2));
  });

  it('sends only what changed: a PIC change alone does not resend the stage', async () => {
    const panel = await openDetailOfBumiHijau();

    fireEvent.change(within(panel).getByLabelText('PIC'), { target: { value: 'admin-1' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Simpan perubahan' }));

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(JSON.parse(String(patches()[0][1]?.body))).toEqual({ picId: 'admin-1' });
  });

  it('clears the PIC by sending null', async () => {
    const panel = await openDetailOfBumiHijau();

    fireEvent.change(within(panel).getByLabelText('PIC'), { target: { value: '' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Simpan perubahan' }));

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(JSON.parse(String(patches()[0][1]?.body))).toEqual({ picId: null });
  });

  it('offers nothing to save until something changes', async () => {
    const panel = await openDetailOfBumiHijau();

    expect(within(panel).getByRole('button', { name: 'Simpan perubahan' }).hasAttribute('disabled')).toBe(true);
  });

  it('asks for a reason before an Inquiry leaves Selesai, and will not save without one', async () => {
    detail = { ...DETAIL, id: 'inquiry-2', status: 'DONE' };
    const panel = await openDetailOfBumiHijau();

    fireEvent.change(within(panel).getByLabelText('Tahap'), { target: { value: 'ONGOING' } });

    expect(within(panel).getByText(/Alasan wajib diisi/)).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Simpan perubahan' }).hasAttribute('disabled')).toBe(true);

    fireEvent.change(within(panel).getByLabelText('Catatan tindak lanjut'), { target: { value: 'Kontrak diperpanjang.' } });
    expect(within(panel).getByRole('button', { name: 'Simpan perubahan' }).hasAttribute('disabled')).toBe(false);
  });

  it('offers only Admin users as PIC', async () => {
    const panel = await openDetailOfBumiHijau();

    const options = within(within(panel).getByLabelText('PIC')).getAllByRole('option').map((o) => o.textContent);

    expect(options).toEqual(['Belum ada PIC', 'Dewi Partnership', 'Bagas Kemitraan']);
  });

  it('shows the refusal when the change is refused', async () => {
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === LIST && !init?.method) return jsonResponse({ inquiries: INQUIRIES, pics: PICS });
      if (!init?.method) return jsonResponse({ inquiry: DETAIL });
      return jsonResponse({ error: 'PIC harus berupa pengguna Admin.' }, false);
    });
    global.fetch = fetchMock as never;
    const panel = await openDetailOfBumiHijau();

    fireEvent.change(within(panel).getByLabelText('PIC'), { target: { value: 'admin-1' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Simpan perubahan' }));

    expect(await screen.findByText('PIC harus berupa pengguna Admin.')).toBeTruthy();
  });
});
