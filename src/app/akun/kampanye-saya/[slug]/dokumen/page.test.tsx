import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    verificationChecklistItem: { findMany: vi.fn() },
    document: { findMany: vi.fn() },
  },
}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import CampaignDocumentsPage from './page';

/** Ticket 64: the Fundraiser's own documents screen for one Campaign. */
const CAMPAIGN = { id: 'c1', slug: 'sumur', title: 'Sumur Desa', kind: 'DONATION', creatorId: 'u1', lifecycleStatus: 'DRAFT' };
const ITEMS = [
  { id: 'ktp', label: 'KTP Fundraiser', required: true },
  { id: 'rab', label: 'Rencana anggaran', required: true },
];
const KTP_DOC = { id: 'd1', label: 'KTP Fundraiser', checklistItemId: 'ktp', contentType: 'application/pdf', sizeBytes: 2048, uploadedAt: new Date('2026-10-29T00:00:00Z') };

const page = () => CampaignDocumentsPage({ params: Promise.resolve({ slug: 'sumur' }) });

beforeEach(() => {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as never);
  vi.mocked(prisma.campaign.findUnique).mockResolvedValue(CAMPAIGN as never);
  vi.mocked(prisma.verificationChecklistItem.findMany).mockResolvedValue(ITEMS as never);
  vi.mocked(prisma.document.findMany).mockResolvedValue([KTP_DOC] as never);
});

afterEach(() => cleanup());

describe('the Campaign documents page', () => {
  it('sends a signed-out visitor to sign in', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    await expect(page()).rejects.toThrow('NEXT_REDIRECT /login');
  });

  it("answers 404 for a Campaign that is not this account's", async () => {
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ ...CAMPAIGN, creatorId: 'someone-else' } as never);
    await expect(page()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('lists every document item with what was uploaded for it, a picker for each, and what is still missing', async () => {
    render(await page());

    expect(screen.getByTestId('documents-missing').textContent).toContain('Rencana anggaran');
    expect(screen.getByTestId('documents-missing').textContent).not.toContain('KTP');
    expect(screen.getByRole('link', { name: 'KTP Fundraiser' }).getAttribute('href')).toBe('/api/documents/d1');
    expect(screen.getByLabelText('Berkas KTP Fundraiser')).toBeDefined();
    expect(screen.getByLabelText('Berkas Rencana anggaran')).toBeDefined();
  });

  it('offers no upload on a closed Campaign, and still shows what it holds', async () => {
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ ...CAMPAIGN, lifecycleStatus: 'COMPLETED' } as never);

    render(await page());

    expect(screen.queryByLabelText('Berkas KTP Fundraiser')).toBeNull();
    expect(screen.getByText('Campaign ini sudah ditutup dan tidak menerima dokumen baru.')).toBeDefined();
    expect(screen.getByRole('link', { name: 'KTP Fundraiser' })).toBeDefined();
  });
});
