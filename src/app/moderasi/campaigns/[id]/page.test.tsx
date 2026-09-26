import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { CampaignStatus } from '@/generated/prisma/client';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    verificationRequest: { findFirst: vi.fn() },
    identityVerification: { findUnique: vi.fn() },
  },
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { prisma } from '@/lib/prisma';
import ModerasiCampaignDetailPage from './page';

function campaign(lifecycleStatus: CampaignStatus, overrides: Record<string, unknown> = {}) {
  return {
    id: 'campaign-1',
    title: 'Sumur untuk Desa',
    lifecycleStatus,
    deadline: null,
    coverImage: '',
    description: 'Deskripsi',
    story: '<p>Cerita</p>',
    category: 'lingkungan',
    targetAmount: 10_000_000,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    creatorId: 'creator-1',
    creator: { name: 'Budi', email: 'budi@test.com' },
    ...overrides,
  };
}

const PENDING_REQUEST = {
  id: 'verification-1',
  campaignId: 'campaign-1',
  submittedAt: new Date('2026-09-24T08:00:00Z'),
  outcome: 'PENDING',
  isFirst: true,
  checklist: [
    { id: 'item-1', label: 'KTP penanggung jawab', required: true, position: 1, ticked: false },
    { id: 'item-2', label: 'Foto kondisi lapangan', required: false, position: 2, ticked: false },
  ],
};

async function renderFor(
  row: ReturnType<typeof campaign>,
  { request = null as typeof PENDING_REQUEST | null, identity = null as Record<string, unknown> | null } = {},
) {
  vi.mocked(prisma.campaign.findUnique).mockResolvedValue(row as any);
  vi.mocked(prisma.verificationRequest.findFirst).mockResolvedValue(request as any);
  vi.mocked(prisma.identityVerification.findUnique).mockResolvedValue(identity as any);
  render(await ModerasiCampaignDetailPage({ params: Promise.resolve({ id: row.id }) }));
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the moderation page of one Campaign', () => {
  it("renders the open request's checklist with tick boxes, a reason field, and approve and reject", async () => {
    await renderFor(campaign('SUBMITTED'), { request: PENDING_REQUEST });

    expect(screen.getByText('Diajukan')).toBeDefined();
    const ktp = screen.getByRole('checkbox', { name: /KTP penanggung jawab/ }) as HTMLInputElement;
    expect(ktp.checked).toBe(false);
    expect(screen.getByRole('checkbox', { name: /Foto kondisi lapangan/ })).toBeDefined();
    expect(screen.getByText('Wajib')).toBeDefined();
    expect(screen.getByRole('textbox', { name: /Alasan penolakan/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Loloskan/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Tolak/ })).toBeDefined();
  });

  it('asks for an optional identity note when the Fundraiser has no Identity Verification yet', async () => {
    await renderFor(campaign('SUBMITTED'), { request: PENDING_REQUEST });

    expect(screen.getByRole('textbox', { name: /Catatan verifikasi identitas/ })).toBeDefined();
  });

  it('says the identity was already verified, and asks for no note, when it was', async () => {
    await renderFor(campaign('SUBMITTED'), {
      request: PENDING_REQUEST,
      identity: { userId: 'creator-1', verifiedAt: new Date('2026-08-01T00:00:00Z') },
    });

    expect(screen.queryByRole('textbox', { name: /Catatan verifikasi identitas/ })).toBeNull();
    expect(screen.getByText(/Identitas Fundraiser sudah diverifikasi/)).toBeDefined();
  });

  it('approving sends the request id, the ticked items and the note', async () => {
    await renderFor(campaign('SUBMITTED'), { request: PENDING_REQUEST });

    fireEvent.click(screen.getByRole('checkbox', { name: /KTP penanggung jawab/ }));
    fireEvent.change(screen.getByRole('textbox', { name: /Catatan verifikasi identitas/ }), {
      target: { value: 'KTP cocok.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Loloskan/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/moderasi/campaigns/campaign-1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({
      action: 'approve',
      requestId: 'verification-1',
      ticked: ['item-1'],
      identityNote: 'KTP cocok.',
    });
  });

  describe('required checklist items', () => {
    const TWO_REQUIRED = {
      ...PENDING_REQUEST,
      checklist: [
        { id: 'item-1', label: 'KTP penanggung jawab', required: true, position: 1, ticked: false },
        { id: 'item-2', label: 'Rencana anggaran', required: true, position: 2, ticked: false },
        { id: 'item-3', label: 'Foto kondisi lapangan', required: false, position: 3, ticked: false },
      ],
    };
    const approve = () => screen.getByRole('button', { name: /Loloskan/ }) as HTMLButtonElement;

    it('disables approve, and says which required items are unticked, until every one is ticked', async () => {
      await renderFor(campaign('SUBMITTED'), { request: TWO_REQUIRED });

      expect(approve().disabled).toBe(true);
      expect(
        screen.getByText('Centang semua butir wajib untuk meloloskan: KTP penanggung jawab, Rencana anggaran.'),
      ).toBeDefined();

      fireEvent.click(screen.getByRole('checkbox', { name: /KTP penanggung jawab/ }));
      expect(approve().disabled).toBe(true);
      expect(screen.getByText('Centang semua butir wajib untuk meloloskan: Rencana anggaran.')).toBeDefined();

      fireEvent.click(screen.getByRole('checkbox', { name: /Rencana anggaran/ }));
      expect(approve().disabled).toBe(false);
      expect(screen.queryByText(/Centang semua butir wajib/)).toBeNull();
    });

    it('does not ask the server when approve is clicked while disabled', async () => {
      await renderFor(campaign('SUBMITTED'), { request: TWO_REQUIRED });

      fireEvent.click(approve());

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('leaves reject available whatever is ticked', async () => {
      await renderFor(campaign('SUBMITTED'), { request: TWO_REQUIRED });

      expect((screen.getByRole('button', { name: /Tolak/ }) as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it('rejecting sends the reason', async () => {
    await renderFor(campaign('SUBMITTED'), { request: PENDING_REQUEST });

    fireEvent.change(screen.getByRole('textbox', { name: /Alasan penolakan/ }), {
      target: { value: 'KTP buram.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Tolak/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      action: 'reject',
      requestId: 'verification-1',
      reason: 'KTP buram.',
    });
  });

  it('refuses to reject without a reason before asking the server', async () => {
    await renderFor(campaign('SUBMITTED'), { request: PENDING_REQUEST });

    fireEvent.click(screen.getByRole('button', { name: /Tolak/ }));

    expect(await screen.findByText('Alasan penolakan wajib diisi.')).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server's refusal", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Verification Request ini sudah diputuskan.' }), { status: 409 }),
    );
    await renderFor(campaign('SUBMITTED'), { request: PENDING_REQUEST });

    fireEvent.click(screen.getByRole('checkbox', { name: /KTP penanggung jawab/ }));
    fireEvent.click(screen.getByRole('button', { name: /Loloskan/ }));

    expect(await screen.findByText('Verification Request ini sudah diputuskan.')).toBeDefined();
  });

  it.each<CampaignStatus>(['DRAFT', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'CANCELLED', 'COMPLETED', 'EXPIRED'])(
    'offers no decision for a %s Campaign with no open request',
    async (status) => {
      await renderFor(campaign(status));

      expect(screen.queryByRole('button', { name: /Loloskan/ })).toBeNull();
      expect(screen.queryByRole('checkbox')).toBeNull();
      expect(screen.getByText('Tidak ada Verification Request yang menunggu keputusan.')).toBeDefined();
    },
  );

  it('asks only for the open request of this Campaign', async () => {
    await renderFor(campaign('SUBMITTED'), { request: PENDING_REQUEST });

    expect(prisma.verificationRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { campaignId: 'campaign-1', outcome: 'PENDING' } }),
    );
  });

  it('shows an Active Campaign past its deadline as Expired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-25T12:00:00Z'));

    await renderFor(campaign('ACTIVE', { deadline: new Date('2026-09-24T12:00:00Z') }));

    expect(screen.getByText('Berakhir')).toBeDefined();
  });
});
