import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const mockUseSession = vi.fn();
vi.mock('next-auth/react', () => ({
  useSession: () => mockUseSession(),
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import CampaignCreatePage from './page';

function signedIn() {
  return {
    status: 'authenticated',
    data: {
      user: { id: 'user-1', assignments: [] },
      expires: '2099-01-01',
    },
  };
}

describe('CampaignCreatePage access', () => {
  afterEach(() => {
    cleanup();
    mockUseSession.mockReset();
  });

  it('lets any registered user, with no Role or assignment, fill in a Campaign (FFI-04)', () => {
    mockUseSession.mockReturnValue(signedIn());

    render(<CampaignCreatePage />);

    expect(screen.getByText('Judul Campaign')).toBeDefined();
    expect(screen.queryByText('Belum Terdaftar sebagai Fundraiser')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hubungi Admin' })).toBeNull();
    expect(screen.queryByText('Verifikasi Identitas Diperlukan')).toBeNull();
  });
});

/**
 * The review step saves a Draft or submits it to a Verifier
 * (verification-request 01). The server is stood in by a fetch that records
 * what was asked of it.
 */
describe('CampaignCreatePage review step', () => {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  let uploadAnswer: () => Response | Promise<Response>;
  let submission: { status: number; body: unknown };
  let categoryRows: { slug: string; name: string }[];
  let sponsorOptions: { own: { id: string; name: string } | null; sponsors: { id: string; name: string }[] };
  let documentItems: { id: string; label: string; required: boolean }[];
  let documentAnswer: () => Response;

  beforeEach(() => {
    calls.length = 0;
    uploadAnswer = () => Response.json({ url: 'https://cdn.test/cover.jpg' });
    submission = { status: 201, body: { campaign: { lifecycleStatus: 'SUBMITTED' } } };
    categoryRows = [
      { slug: 'bencana-alam', name: 'Bencana Alam' },
      { slug: 'rumah-ibadah', name: 'Rumah Ibadah' },
    ];
    sponsorOptions = { own: null, sponsors: [{ id: 'sponsor', name: 'Yayasan Penaung' }] };
    documentItems = [];
    documentAnswer = () => Response.json({ document: { id: 'doc-1' } }, { status: 201 });
    mockUseSession.mockReturnValue(signedIn());
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:cover' }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({
          url,
          method: init?.method ?? 'GET',
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        });
        if (url === '/api/partner-organisations/sponsors') return Response.json(sponsorOptions);
        if (url === '/api/categories') return Response.json({ categories: categoryRows });
        if (url === '/api/upload') return uploadAnswer();
        if (url.startsWith('/api/verification-checklist/documents')) return Response.json({ items: documentItems });
        if (url === '/api/documents') {
          const form = init?.body as FormData;
          calls[calls.length - 1].body = { campaignId: form.get('campaignId'), checklistItemId: form.get('checklistItemId') };
          return documentAnswer();
        }
        if (url === '/api/campaigns') return Response.json({ id: 'campaign-new', slug: 'bantu-banjir-abc123' }, { status: 201 });
        return Response.json(submission.body, { status: submission.status });
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    mockUseSession.mockReset();
    mockPush.mockReset();
  });

  async function fillInToReview({
    kind = 'DONATION',
    deadline = '2099-12-31',
    location,
  }: { kind?: string; deadline?: string; location?: { province: string; regency: string; description: string; count: string } } = {}) {
    const { container } = render(<CampaignCreatePage />);
    await screen.findByTestId('collecting-entity');
    await screen.findByRole('option', { name: 'Bencana Alam' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Collecting Entity' }), { target: { value: 'sponsor' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Kind' }), { target: { value: kind } });
    fireEvent.change(screen.getByPlaceholderText('Contoh: Bantu Korban Banjir Jakarta'), {
      target: { value: 'Bantu Banjir' },
    });
    fireEvent.change(screen.getByPlaceholderText('1.000.000'), { target: { value: '5000000' } });
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: deadline } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Kategori' }), { target: { value: 'bencana-alam' } });
    if (location) {
      fireEvent.change(screen.getByLabelText('Provinsi'), { target: { value: location.province } });
      fireEvent.change(screen.getByLabelText('Kabupaten/Kota'), { target: { value: location.regency } });
      fireEvent.change(screen.getByLabelText('Penerima Manfaat'), { target: { value: location.description } });
      fireEvent.change(screen.getByLabelText('Jumlah Penerima Manfaat'), { target: { value: location.count } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' }));

    const cover = new File(['x'], 'cover.png', { type: 'image/png' });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [cover] } });
    fireEvent.change(screen.getByPlaceholderText(/Ceritakan alasan Anda/), {
      target: { value: 'Banjir merendam ratusan rumah warga dan mereka butuh bantuan segera.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' }));
  }

  it('offers exactly the Categories the table holds, by slug, and no hardcoded ones', async () => {
    categoryRows = [{ slug: 'masjid', name: 'Masjid' }, { slug: 'sekolah', name: 'Sekolah' }];
    render(<CampaignCreatePage />);

    await screen.findByRole('option', { name: 'Masjid' });
    const select = screen.getByRole('combobox', { name: 'Kategori' }) as HTMLSelectElement;
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
      ['', 'Pilih Kategori'],
      ['masjid', 'Masjid'],
      ['sekolah', 'Sekolah'],
    ]);
    expect(screen.queryByRole('option', { name: 'Lainnya' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Bantuan Medis & Kesehatan' })).toBeNull();
  });

  describe('the documents PRD §7.1 asks for (ticket 64)', () => {
    const KTP = { id: 'ktp', label: 'KTP Fundraiser', required: true };
    const FOTO = { id: 'foto', label: 'Foto kondisi', required: false };
    const pdf = () => new File(['%PDF-1.7'], 'ktp.pdf', { type: 'application/pdf' });

    it("asks for the Kind's documents on the review step, and holds back submitting until the required ones are picked", async () => {
      documentItems = [KTP, FOTO];
      await fillInToReview();

      await screen.findByLabelText('Berkas KTP Fundraiser');
      const submit = screen.getByRole('button', { name: 'Ajukan ke Verifier' }) as HTMLButtonElement;
      expect(submit.disabled).toBe(true);
      expect(screen.getByText(/Untuk mengajukan ke Verifier, lengkapi dulu: KTP Fundraiser\./)).toBeDefined();
      expect((screen.getByRole('button', { name: 'Simpan Draft' }) as HTMLButtonElement).disabled).toBe(false);

      fireEvent.change(screen.getByLabelText('Berkas KTP Fundraiser'), { target: { files: [pdf()] } });

      expect(submit.disabled).toBe(false);
    });

    it('uploads each picked document to the private store after creating the Draft, before submitting it', async () => {
      documentItems = [KTP];
      await fillInToReview();
      fireEvent.change(await screen.findByLabelText('Berkas KTP Fundraiser'), { target: { files: [pdf()] } });

      fireEvent.click(screen.getByRole('button', { name: 'Ajukan ke Verifier' }));

      await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/akun/kampanye-saya'));
      expect(calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual([
        '/api/upload',
        '/api/campaigns',
        '/api/documents',
        '/api/campaigns/bantu-banjir-abc123/verification-requests',
      ]);
      expect(calls.find((c) => c.url === '/api/documents')?.body).toEqual({ campaignId: 'campaign-new', checklistItemId: 'ktp' });
    });

    it('keeps the Draft and does not submit when a document is refused, naming it', async () => {
      documentItems = [KTP];
      documentAnswer = () => Response.json({ error: 'Isi berkas tidak sesuai dengan tipenya.' }, { status: 415 });
      await fillInToReview();
      fireEvent.change(await screen.findByLabelText('Berkas KTP Fundraiser'), { target: { files: [pdf()] } });

      fireEvent.click(screen.getByRole('button', { name: 'Ajukan ke Verifier' }));

      expect(await screen.findByText(/Campaign tersimpan sebagai Draft, tetapi belum diajukan: KTP Fundraiser: Isi berkas tidak sesuai/)).toBeDefined();
      expect(calls.filter((c) => c.url.endsWith('/verification-requests'))).toHaveLength(0);
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  it('offers "Simpan Draft" and "Ajukan ke Verifier"', async () => {
    await fillInToReview();

    expect(screen.getByRole('button', { name: 'Simpan Draft' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Ajukan ke Verifier' })).toBeDefined();
  });

  it('"Simpan Draft" creates the Draft without submitting it', async () => {
    await fillInToReview();

    fireEvent.click(screen.getByRole('button', { name: 'Simpan Draft' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/akun/kampanye-saya'));
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual(['/api/upload', '/api/campaigns']);
  });

  it('"Ajukan ke Verifier" creates the Draft, then submits it', async () => {
    await fillInToReview();

    fireEvent.click(screen.getByRole('button', { name: 'Ajukan ke Verifier' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/akun/kampanye-saya'));
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual([
      '/api/upload',
      '/api/campaigns',
      '/api/campaigns/bantu-banjir-abc123/verification-requests',
    ]);
  });

  it.each([
    ['the upload answers an error', () => Response.json({ error: 'x' }, { status: 500 })],
    ['the upload answers without a url', () => Response.json({})],
    ['the upload request fails', () => Promise.reject(new Error('network'))],
  ])('stops without creating the Campaign when %s', async (_name, answer) => {
    uploadAnswer = answer;
    await fillInToReview();

    fireEvent.click(screen.getByRole('button', { name: 'Simpan Draft' }));

    expect(await screen.findByText('Gagal mengunggah gambar sampul. Silakan coba lagi.')).toBeDefined();
    expect(calls.filter((c) => c.url === '/api/campaigns')).toHaveLength(0);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('keeps the Draft when submitting fails, and a retry submits it without creating another', async () => {
    submission = { status: 500, body: { error: 'Terjadi kesalahan pada server.' } };
    await fillInToReview();

    fireEvent.click(screen.getByRole('button', { name: 'Ajukan ke Verifier' }));
    expect(await screen.findByText(/tersimpan sebagai Draft/)).toBeDefined();
    expect(mockPush).not.toHaveBeenCalled();

    submission = { status: 201, body: { campaign: { lifecycleStatus: 'SUBMITTED' } } };
    fireEvent.click(screen.getByRole('button', { name: 'Ajukan ke Verifier' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/akun/kampanye-saya'));
    expect(calls.filter((c) => c.url === '/api/campaigns')).toHaveLength(1);
    expect(calls.filter((c) => c.url.endsWith('/verification-requests'))).toHaveLength(2);
  });

  it('does not offer Zakat as a Kind (out of scope since 2026-10-16)', () => {
    render(<CampaignCreatePage />);
    expect(screen.queryByRole('option', { name: 'Zakat' })).toBeNull();
  });

  it('sends the province, regency and beneficiaries when filled in (ticket 74)', async () => {
    await fillInToReview({
      location: { province: '32', regency: ' Kabupaten Garut ', description: 'Anak yatim', count: '40' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Simpan Draft' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(calls.find((c) => c.url === '/api/campaigns')?.body).toMatchObject({
      province: '32',
      regency: 'Kabupaten Garut',
      beneficiaryDescription: 'Anak yatim',
      beneficiaryCount: 40,
    });
  });

  it('lets all four go blank: they are optional, and are sent as null', async () => {
    await fillInToReview();

    fireEvent.click(screen.getByRole('button', { name: 'Simpan Draft' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(calls.find((c) => c.url === '/api/campaigns')?.body).toMatchObject({
      province: null,
      regency: null,
      beneficiaryDescription: null,
      beneficiaryCount: null,
    });
  });

  it('holds the first step on a beneficiary count that is not a positive whole number', async () => {
    render(<CampaignCreatePage />);
    await screen.findByTestId('collecting-entity');
    fireEvent.change(screen.getByLabelText('Jumlah Penerima Manfaat'), { target: { value: '0' } });

    fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' }));

    expect(await screen.findByText(/harus bilangan bulat lebih dari 0/)).toBeDefined();
    expect(screen.getByLabelText('Provinsi')).toBeDefined();
  });

  it('sends the Kind the Fundraiser chose', async () => {
    await fillInToReview({ kind: 'WAKAF' });

    fireEvent.click(screen.getByRole('button', { name: 'Simpan Draft' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(calls.find((c) => c.url === '/api/campaigns')?.body).toMatchObject({ kind: 'WAKAF' });
  });

  it('offers Hibah as a Kind choice, labelled in Indonesian (CONTEXT.md, Kind), and sends it', async () => {
    render(<CampaignCreatePage />);
    await screen.findByTestId('collecting-entity');
    expect(screen.getByRole('option', { name: 'Hibah' })).toBeDefined();
    cleanup();

    await fillInToReview({ kind: 'HIBAH' });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Draft' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(calls.find((c) => c.url === '/api/campaigns')?.body).toMatchObject({ kind: 'HIBAH' });
  });

  it('lets a wakaf Campaign go without a deadline', async () => {
    await fillInToReview({ kind: 'WAKAF', deadline: '' });

    expect(screen.getByText('Tanpa batas waktu')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Draft' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    const body = calls.find((c) => c.url === '/api/campaigns')?.body as Record<string, unknown>;
    expect(body.kind).toBe('WAKAF');
    expect(body).not.toHaveProperty('deadline');
  });

  it('holds any other Kind on the first step until a deadline is chosen', async () => {
    render(<CampaignCreatePage />);
    await screen.findByTestId('collecting-entity');
    fireEvent.change(screen.getByRole('combobox', { name: 'Kind' }), { target: { value: 'HIBAH' } });
    fireEvent.change(screen.getByPlaceholderText('Contoh: Bantu Korban Banjir Jakarta'), {
      target: { value: 'Bantu Banjir' },
    });
    fireEvent.change(screen.getByPlaceholderText('1.000.000'), { target: { value: '5000000' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Kategori' }), { target: { value: 'bencana-alam' } });

    fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' }));

    expect(screen.getByText('Batas waktu harus dipilih')).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Kind' })).toBeDefined();
  });

  describe('the Collecting Entity (prd-compliance 10, ADR 0010)', () => {
    it('tells an individual Fundraiser plainly that they collect under a sponsoring organisation, and sends the one chosen', async () => {
      await fillInToReview();

      expect(screen.getByText('Yayasan Penaung')).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: 'Simpan Draft' }));

      await waitFor(() => expect(mockPush).toHaveBeenCalled());
      expect(calls.find((c) => c.url === '/api/campaigns')?.body).toMatchObject({ collectingEntityId: 'sponsor' });
    });

    it('explains the sponsorship on the first step', async () => {
      render(<CampaignCreatePage />);

      expect(await screen.findByText(/Fundraiser perorangan menggalang dana di bawah naungan Partner Organisation/)).toBeDefined();
    });

    it('holds an individual Fundraiser on the first step until they pick a sponsoring organisation', async () => {
      const { container } = render(<CampaignCreatePage />);
      await screen.findByTestId('collecting-entity');
      fireEvent.change(screen.getByRole('combobox', { name: 'Kind' }), { target: { value: 'DONATION' } });
      fireEvent.change(screen.getByPlaceholderText('Contoh: Bantu Korban Banjir Jakarta'), {
        target: { value: 'Bantu Banjir' },
      });
      fireEvent.change(screen.getByPlaceholderText('1.000.000'), { target: { value: '5000000' } });
      fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '2099-12-31' } });
      fireEvent.change(screen.getByRole('combobox', { name: 'Kategori' }), { target: { value: 'bencana-alam' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' }));

      expect(screen.getByText('Pilih Partner Organisation yang menaungi Campaign ini')).toBeDefined();
      expect(screen.getByRole('combobox', { name: 'Kind' })).toBeDefined();
    });

    it("names an organisation's own account's organisation and asks nothing", async () => {
      sponsorOptions = { own: { id: 'yiem', name: 'Yayasan Indonesia Emas Merdeka' }, sponsors: [] };
      render(<CampaignCreatePage />);

      expect(
        await screen.findByText('Dana Campaign ini dihimpun atas nama Yayasan Indonesia Emas Merdeka, organisasi yang diwakili akun Anda.'),
      ).toBeDefined();
      expect(screen.queryByRole('combobox', { name: 'Collecting Entity' })).toBeNull();
    });

    it('says so when no organisation accepts individual Campaigns yet', async () => {
      sponsorOptions = { own: null, sponsors: [] };
      render(<CampaignCreatePage />);

      expect(await screen.findByText(/Belum ada Partner Organisation yang menaungi Campaign perorangan/)).toBeDefined();
    });
  });
});
