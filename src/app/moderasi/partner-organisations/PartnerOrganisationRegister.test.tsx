import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { PartnerOrganisationRegister } from './PartnerOrganisationRegister';

/**
 * The Verifier's register screen (prd-compliance 10), against a stand-in
 * fetch that records what the screen asked of the API.
 */
const ORGANISATION = {
  id: 'yiem',
  name: 'Yayasan Indonesia Emas Merdeka',
  acceptsIndividualCampaigns: false,
  fundraiser: { name: 'YIEM', email: 'yiem@example.org' },
  permits: [
    {
      id: 'permit-1',
      number: '123/PUB/2026',
      issuer: 'Kementerian Sosial',
      kinds: ['DONATION'],
      validFrom: '2020-01-01T00:00:00.000Z',
      validTo: '2020-12-31T00:00:00.000Z',
    },
  ],
};

const calls: Array<{ url: string; method: string; body?: unknown }> = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      if ((init?.method ?? 'GET') === 'GET') return Response.json({ organisations: [ORGANISATION] });
      return Response.json({}, { status: 201 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PartnerOrganisationRegister', () => {
  it('lists each organisation with its account and permits, marking a lapsed permit', async () => {
    render(<PartnerOrganisationRegister />);

    expect(await screen.findByText('Yayasan Indonesia Emas Merdeka')).toBeDefined();
    expect(screen.getByText(/yiem@example.org/)).toBeDefined();
    expect(screen.getByText('123/PUB/2026 · Kementerian Sosial')).toBeDefined();
    expect(screen.getByText('(tidak berlaku)')).toBeDefined();
  });

  it('marks a permit and a Kind Authorisation that cover today as berlaku', async () => {
    const current = {
      ...ORGANISATION,
      permits: [{ ...ORGANISATION.permits[0], validFrom: '2020-01-01T00:00:00.000Z', validTo: '2999-12-31T00:00:00.000Z' }],
      kindAuthorisations: [
        {
          id: 'auth-1',
          kind: 'WAKAF',
          documentReference: 'SK-1',
          validFrom: '2020-01-01T00:00:00.000Z',
          validTo: '2999-12-31T00:00:00.000Z',
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ organisations: [current] })),
    );
    render(<PartnerOrganisationRegister />);

    await screen.findByText('Yayasan Indonesia Emas Merdeka');
    expect(screen.getAllByText('(berlaku)')).toHaveLength(2);
    expect(screen.queryByText('(tidak berlaku)')).toBeNull();
  });

  it('registers an organisation with the account that acts for it', async () => {
    render(<PartnerOrganisationRegister />);
    await screen.findByText('Yayasan Indonesia Emas Merdeka');

    fireEvent.change(screen.getByLabelText('Nama organisasi'), { target: { value: 'Yayasan Baru' } });
    fireEvent.change(screen.getByLabelText('Email akun Fundraiser yang mewakilinya'), {
      target: { value: 'baru@example.org' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Daftarkan' }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toEqual({
        url: '/api/moderasi/partner-organisations',
        method: 'POST',
        body: { name: 'Yayasan Baru', fundraiserEmail: 'baru@example.org', acceptsIndividualCampaigns: false },
      }),
    );
  });

  it('turns on accepting individual Campaigns', async () => {
    render(<PartnerOrganisationRegister />);
    await screen.findByText('Yayasan Indonesia Emas Merdeka');

    fireEvent.click(screen.getAllByLabelText('Menaungi Campaign Fundraiser perorangan')[1]);

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')).toEqual({
        url: '/api/moderasi/partner-organisations/yiem',
        method: 'PATCH',
        body: { acceptsIndividualCampaigns: true },
      }),
    );
  });

  it('records a permit, its days taken as whole days in WIB', async () => {
    render(<PartnerOrganisationRegister />);
    await screen.findByText('Yayasan Indonesia Emas Merdeka');
    const permitForm = within(screen.getByLabelText('Nomor izin').closest('form')!);

    fireEvent.change(permitForm.getByLabelText('Nomor izin'), { target: { value: '456/PUB/2027' } });
    fireEvent.change(permitForm.getByLabelText('Penerbit'), { target: { value: 'Dinas Sosial' } });
    fireEvent.change(permitForm.getByLabelText('Berlaku dari'), { target: { value: '2027-01-01' } });
    fireEvent.change(permitForm.getByLabelText('Berlaku sampai'), { target: { value: '2027-12-31' } });
    fireEvent.click(permitForm.getByLabelText('Wakaf'));
    fireEvent.click(permitForm.getByRole('button', { name: 'Catat izin' }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toEqual({
        url: '/api/moderasi/partner-organisations/yiem/permits',
        method: 'POST',
        body: {
          number: '456/PUB/2027',
          issuer: 'Dinas Sosial',
          kinds: ['WAKAF'],
          validFrom: '2026-12-31T17:00:00.000Z',
          validTo: '2027-12-31T16:59:59.999Z',
        },
      }),
    );
  });

  describe('Koreksi Fundraising Permit (ticket 97)', () => {
    const openCorrection = async () => {
      render(<PartnerOrganisationRegister />);
      await screen.findByText('Yayasan Indonesia Emas Merdeka');
      fireEvent.click(screen.getByRole('button', { name: 'Koreksi' }));
      return within(screen.getByRole('form', { name: 'Koreksi Fundraising Permit' }));
    };

    it('sends only the fields that changed, days taken as whole days in WIB', async () => {
      const form = await openCorrection();

      expect((form.getByLabelText('Nomor izin') as HTMLInputElement).value).toBe('123/PUB/2026');
      fireEvent.change(form.getByLabelText('Nomor izin'), { target: { value: '999/PUB/2026' } });
      fireEvent.change(form.getByLabelText('Berlaku sampai'), { target: { value: '2999-12-31' } });
      fireEvent.click(form.getByRole('button', { name: 'Simpan koreksi' }));

      await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toBeDefined());
      expect(calls.find((c) => c.method === 'PATCH')).toEqual({
        url: '/api/moderasi/partner-organisations/yiem/permits/permit-1',
        method: 'PATCH',
        body: { number: '999/PUB/2026', validTo: '2999-12-31T16:59:59.999Z' },
      });
    });

    it('sends the Kinds only when the selection changed', async () => {
      const form = await openCorrection();

      fireEvent.click(form.getByLabelText('Wakaf'));
      fireEvent.click(form.getByRole('button', { name: 'Simpan koreksi' }));

      await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toBeDefined());
      expect((calls.find((c) => c.method === 'PATCH')?.body as { kinds: string[] }).kinds.sort()).toEqual([
        'DONATION',
        'WAKAF',
      ]);
      expect(Object.keys(calls.find((c) => c.method === 'PATCH')!.body as object)).toEqual(['kinds']);
    });

    it('sends nothing when nothing changed', async () => {
      const form = await openCorrection();

      fireEvent.click(form.getByRole('button', { name: 'Simpan koreksi' }));

      expect(calls.find((c) => c.method === 'PATCH')).toBeUndefined();
      expect(await screen.findByText('Tidak ada perubahan untuk Fundraising Permit.')).toBeDefined();
    });

    it("shows the server's validation error on the permit's card and keeps the form open", async () => {
      vi.mocked(fetch).mockImplementation(async (url, init) => {
        calls.push({ url: String(url), method: init?.method ?? 'GET', body: undefined });
        if ((init?.method ?? 'GET') === 'GET') return Response.json({ organisations: [ORGANISATION] });
        return Response.json({ error: 'Nomor izin wajib diisi.' }, { status: 400 });
      });
      const form = await openCorrection();

      fireEvent.change(form.getByLabelText('Nomor izin'), { target: { value: ' ' } });
      fireEvent.click(form.getByRole('button', { name: 'Simpan koreksi' }));

      const card = screen.getByText('123/PUB/2026 · Kementerian Sosial').closest('li')!;
      expect((await within(card).findByRole('alert')).textContent).toBe('Nomor izin wajib diisi.');
      expect(screen.getByRole('form', { name: 'Koreksi Fundraising Permit' })).toBeDefined();
    });

    it('flips the berlaku label to follow the new dates once saved', async () => {
      let stored = ORGANISATION;
      vi.mocked(fetch).mockImplementation(async (url, init) => {
        const method = init?.method ?? 'GET';
        calls.push({ url: String(url), method, body: undefined });
        if (method === 'GET') return Response.json({ organisations: [stored] });
        stored = { ...ORGANISATION, permits: [{ ...ORGANISATION.permits[0], validTo: '2999-12-31T16:59:59.999Z' }] };
        return Response.json({ permit: stored.permits[0] });
      });
      const form = await openCorrection();
      expect(screen.getByText('(tidak berlaku)')).toBeDefined();

      fireEvent.change(form.getByLabelText('Berlaku sampai'), { target: { value: '2999-12-31' } });
      fireEvent.click(form.getByRole('button', { name: 'Simpan koreksi' }));

      expect(await screen.findByText('(berlaku)')).toBeDefined();
      expect(screen.queryByText('(tidak berlaku)')).toBeNull();
      expect(screen.queryByRole('form', { name: 'Koreksi Fundraising Permit' })).toBeNull();
    });
  });

  it('lists Kind Authorisations, marking a lapsed one', async () => {
    const organisationWithAuthorisation = {
      ...ORGANISATION,
      kindAuthorisations: [
        {
          id: 'kind-authorisation-1',
          kind: 'WAKAF',
          documentReference: 'SK Pengukuhan Nazhir 001/2026',
          validFrom: '2020-01-01T00:00:00.000Z',
          validTo: '2020-12-31T00:00:00.000Z',
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method ?? 'GET', body: undefined });
        if ((init?.method ?? 'GET') === 'GET') return Response.json({ organisations: [organisationWithAuthorisation] });
        return Response.json({}, { status: 201 });
      }),
    );

    render(<PartnerOrganisationRegister />);

    expect(await screen.findByText('Wakaf · SK Pengukuhan Nazhir 001/2026')).toBeDefined();
    expect(screen.getAllByText('(tidak berlaku)')).toHaveLength(2);
  });

  it('grants a Kind Authorisation, its days taken as whole days in WIB', async () => {
    render(<PartnerOrganisationRegister />);
    await screen.findByText('Yayasan Indonesia Emas Merdeka');
    const authorisationForm = within(screen.getByLabelText('Rujukan dokumen').closest('form')!);

    fireEvent.change(authorisationForm.getByLabelText('Kind'), { target: { value: 'WAKAF' } });
    fireEvent.change(authorisationForm.getByLabelText('Rujukan dokumen'), { target: { value: 'SK Nazhir 001/2027' } });
    fireEvent.change(authorisationForm.getByLabelText('Berlaku dari'), { target: { value: '2027-01-01' } });
    fireEvent.change(authorisationForm.getByLabelText('Berlaku sampai'), { target: { value: '2027-12-31' } });
    fireEvent.click(authorisationForm.getByRole('button', { name: 'Berikan Kind Authorisation' }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toEqual({
        url: '/api/moderasi/partner-organisations/yiem/kind-authorisations',
        method: 'POST',
        body: {
          kind: 'WAKAF',
          documentReference: 'SK Nazhir 001/2027',
          validFrom: '2026-12-31T17:00:00.000Z',
          validTo: '2027-12-31T16:59:59.999Z',
        },
      }),
    );
  });

  it("lists an organisation's legal documents through the ACL route, and uploads a new one with its title (ticket 64)", async () => {
    const documented = {
      ...ORGANISATION,
      documents: [
        { id: 'doc-akta', label: 'Akta pendirian', contentType: 'application/pdf', sizeBytes: 4096, uploadedAt: '2026-10-29T00:00:00.000Z' },
      ],
    };
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body instanceof FormData ? Object.fromEntries([...init.body.entries()].filter(([k]) => k !== 'file')) : undefined });
      if ((init?.method ?? 'GET') === 'GET') return Response.json({ organisations: [documented] });
      return Response.json({ document: { id: 'doc-2' } }, { status: 201 });
    });
    render(<PartnerOrganisationRegister />);

    const link = await screen.findByRole('link', { name: 'Akta pendirian' });
    expect(link.getAttribute('href')).toBe('/api/documents/doc-akta');

    fireEvent.change(screen.getByLabelText('Nama dokumen'), { target: { value: 'SK Kemenkumham' } });
    fireEvent.change(screen.getByLabelText(/Berkas dokumen Yayasan/), {
      target: { files: [new File(['%PDF-1.7'], 'sk.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unggah' }));

    await waitFor(() => expect(calls.filter((c) => c.url === '/api/documents')).toHaveLength(1));
    expect(calls.find((c) => c.url === '/api/documents')?.body).toEqual({ partnerOrganisationId: 'yiem', label: 'SK Kemenkumham' });
    await screen.findByText('Dokumen terunggah.');
  });
});
