// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { CampaignStatusChangeAction } from '@/generated/prisma/client';
import { loadCampaignStatusHistory, statusChangeLabel } from './campaign-status-history';

describe('statusChangeLabel (PKS pasal 3.4)', () => {
  const expected: Record<string, string> = {
    SUBMITTED: 'Diajukan',
    SUBMISSION_APPROVED: 'Disetujui',
    SUBMISSION_WITHDRAWN: 'Pengajuan ditarik',
    COMPLETED: 'Selesai',
    SUSPENDED: 'Ditangguhkan',
    SUSPENSION_LIFTED: 'Penangguhan dicabut',
    CANCELLED: 'Ditarik',
    EXPIRED: 'Berakhir',
    URGENT_SET: 'Ditandai mendesak',
    URGENT_CLEARED: 'Tanda mendesak dicabut',
    COLLECTING_ENTITY_ASSIGNED: 'Collecting Entity ditetapkan',
  };

  it.each(Object.entries(expected))('reads %s as "%s"', (action, label) => {
    expect(statusChangeLabel({ action: action as CampaignStatusChangeAction, final: false })).toBe(label);
  });

  it('reads a rejection as Perlu revisi, or Ditolak when it was final', () => {
    expect(statusChangeLabel({ action: 'SUBMISSION_REJECTED', final: false })).toBe('Perlu revisi');
    expect(statusChangeLabel({ action: 'SUBMISSION_REJECTED', final: true })).toBe('Ditolak');
  });

  it('has a label for every action the schema knows, so a new one cannot show up blank', () => {
    for (const action of Object.values(CampaignStatusChangeAction)) {
      expect(statusChangeLabel({ action, final: false }), action).toBeTruthy();
    }
  });
});

describe('loadCampaignStatusHistory', () => {
  it("reads one Campaign's changes oldest first and names who acted, in what capacity, and why", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'c1', action: 'SUBMITTED', final: false, capacity: 'FUNDRAISER', reason: null, createdAt: new Date('2026-11-01T01:00:00Z'), actor: { name: 'Siti' } },
      { id: 'c2', action: 'SUBMISSION_REJECTED', final: true, capacity: 'VERIFIER', reason: 'Terindikasi penipuan.', createdAt: new Date('2026-11-02T01:00:00Z'), actor: { name: 'Budi' } },
      { id: 'c3', action: 'EXPIRED', final: false, capacity: 'SYSTEM', reason: null, createdAt: new Date('2026-11-03T01:00:00Z'), actor: null },
    ]);

    const history = await loadCampaignStatusHistory({ campaignStatusChange: { findMany } } as never, 'campaign-1');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { campaignId: 'campaign-1' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    );
    expect(history).toEqual([
      { id: 'c1', label: 'Diajukan', capacity: 'Penggalang', actorName: 'Siti', reason: null, at: new Date('2026-11-01T01:00:00Z') },
      { id: 'c2', label: 'Ditolak', capacity: 'Verifier', actorName: 'Budi', reason: 'Terindikasi penipuan.', at: new Date('2026-11-02T01:00:00Z') },
      { id: 'c3', label: 'Berakhir', capacity: 'Sistem', actorName: null, reason: null, at: new Date('2026-11-03T01:00:00Z') },
    ]);
  });

  it('selects only the actor name, never the account row', async () => {
    const findMany = vi.fn().mockResolvedValue([]);

    await loadCampaignStatusHistory({ campaignStatusChange: { findMany } } as never, 'campaign-1');

    expect(findMany.mock.calls[0][0].select.actor).toEqual({ select: { name: true } });
  });
});
