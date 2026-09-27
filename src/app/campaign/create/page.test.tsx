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
  let submission: { status: number; body: unknown };
  let sponsorOptions: { own: { id: string; name: string } | null; sponsors: { id: string; name: string }[] };

  beforeEach(() => {
    calls.length = 0;
    submission = { status: 201, body: { campaign: { lifecycleStatus: 'SUBMITTED' } } };
    sponsorOptions = { own: null, sponsors: [{ id: 'sponsor', name: 'Yayasan Penaung' }] };
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
        if (url === '/api/upload') return Response.json({ url: 'https://cdn.test/cover.jpg' });
        if (url === '/api/campaigns') return Response.json({ slug: 'bantu-banjir-abc123' }, { status: 201 });
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

  async function fillInToReview({ kind = 'DONATION', deadline = '2099-12-31' } = {}) {
    const { container } = render(<CampaignCreatePage />);
    await screen.findByTestId('collecting-entity');
    fireEvent.change(screen.getByRole('combobox', { name: 'Collecting Entity' }), { target: { value: 'sponsor' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Kind' }), { target: { value: kind } });
    fireEvent.change(screen.getByPlaceholderText('Contoh: Bantu Korban Banjir Jakarta'), {
      target: { value: 'Bantu Banjir' },
    });
    fireEvent.change(screen.getByPlaceholderText('1.000.000'), { target: { value: '5000000' } });
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: deadline } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Kategori' }), { target: { value: 'bencana-alam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' }));

    const cover = new File(['x'], 'cover.png', { type: 'image/png' });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [cover] } });
    fireEvent.change(screen.getByPlaceholderText(/Ceritakan alasan Anda/), {
      target: { value: 'Banjir merendam ratusan rumah warga dan mereka butuh bantuan segera.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan' }));
  }

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

  it('sends the Kind the Fundraiser chose', async () => {
    await fillInToReview({ kind: 'ZAKAT' });

    fireEvent.click(screen.getByRole('button', { name: 'Simpan Draft' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(calls.find((c) => c.url === '/api/campaigns')?.body).toMatchObject({ kind: 'ZAKAT' });
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
