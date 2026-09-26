import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CampaignStatus } from '@/generated/prisma/client';
import {
  campaignRow,
  makeCampaignDb,
  verificationRequestRow,
  type VerificationRequestRow,
} from '../../../../tests/support/in-memory-campaign-db';

/**
 * The Verifier's queue holds exactly the open Verification Requests: the
 * PENDING ones (CONTEXT.md, Verification Request; verification-request 01).
 * Run against the in-memory Campaign db, so it asserts which requests are
 * listed, not how the query is built.
 */

const holder = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('../../../../tests/support/in-memory-campaign-db').makeCampaignDb>,
}));

// The page shows each Campaign's creator and target, which the in-memory
// rows do not carry; they are filled in so the page can render.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    verificationRequest: {
      findMany: async (args: object) =>
        (await holder.db.prisma.verificationRequest.findMany(args)).map(
          (row) => ({
            ...row,
            campaign: {
              ...('campaign' in row ? row.campaign : null),
              targetAmount: 1_000_000,
              creator: { name: 'Budi', email: 'budi@test.com' },
            },
          }),
        ),
    },
  },
}));

import ModerasiCampaignsPage from './page';

function campaign(title: string, lifecycleStatus: CampaignStatus) {
  return campaignRow({ id: title, slug: title, title, lifecycleStatus });
}

function request(campaignId: string, outcome: VerificationRequestRow['outcome']) {
  return verificationRequestRow({ id: `${campaignId}-${outcome}`, campaignId, outcome });
}

beforeEach(() => {
  holder.db = makeCampaignDb({
    campaigns: [
      campaign('submitted-one', 'SUBMITTED'),
      campaign('submitted-two', 'SUBMITTED'),
      campaign('draft', 'DRAFT'),
      campaign('active', 'ACTIVE'),
      campaign('rejected', 'REJECTED'),
      campaign('withdrawn', 'DRAFT'),
    ],
    verificationRequests: [
      request('submitted-one', 'PENDING'),
      request('submitted-two', 'REJECTED'),
      request('submitted-two', 'PENDING'),
      request('active', 'APPROVED'),
      request('rejected', 'REJECTED'),
      request('withdrawn', 'WITHDRAWN'),
    ],
  });
});

afterEach(() => cleanup());

describe('the Verifier queue', () => {
  it('lists the Campaigns of PENDING Verification Requests and nothing else', async () => {
    render(await ModerasiCampaignsPage());

    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent).sort();
    expect(titles).toEqual(['submitted-one', 'submitted-two']);
  });

  it('marks a resubmission apart from a first submission', async () => {
    holder.db = makeCampaignDb({
      campaigns: [campaign('first', 'SUBMITTED'), campaign('again', 'SUBMITTED')],
      verificationRequests: [
        verificationRequestRow({ id: 'r1', campaignId: 'first', isFirst: true }),
        verificationRequestRow({ id: 'r2', campaignId: 'again', isFirst: false }),
      ],
    });

    render(await ModerasiCampaignsPage());

    const card = (title: string) => screen.getByRole('heading', { level: 3, name: title }).closest('a')!;
    expect(card('again').textContent).toContain('Pengajuan ulang');
    expect(card('first').textContent).not.toContain('Pengajuan ulang');
  });
});
