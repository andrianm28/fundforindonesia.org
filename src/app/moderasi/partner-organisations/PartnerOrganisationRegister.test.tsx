import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
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

    fireEvent.change(screen.getByLabelText('Nomor izin'), { target: { value: '456/PUB/2027' } });
    fireEvent.change(screen.getByLabelText('Penerbit'), { target: { value: 'Dinas Sosial' } });
    fireEvent.change(screen.getByLabelText('Berlaku dari'), { target: { value: '2027-01-01' } });
    fireEvent.change(screen.getByLabelText('Berlaku sampai'), { target: { value: '2027-12-31' } });
    fireEvent.click(screen.getByLabelText('Zakat'));
    fireEvent.click(screen.getByRole('button', { name: 'Catat izin' }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toEqual({
        url: '/api/moderasi/partner-organisations/yiem/permits',
        method: 'POST',
        body: {
          number: '456/PUB/2027',
          issuer: 'Dinas Sosial',
          kinds: ['ZAKAT'],
          validFrom: '2026-12-31T17:00:00.000Z',
          validTo: '2027-12-31T16:59:59.999Z',
        },
      }),
    );
  });
});
