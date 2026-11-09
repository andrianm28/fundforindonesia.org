import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CampaignStatusBadge, campaignBadgeLabel } from './CampaignStatusBadge';
import type { CampaignLifecycleStatus } from '@/types/campaign';

/** PKS pasal 3.3: the contract's status labels, one expectation per status. */
describe('campaignBadgeLabel', () => {
  const labels: [CampaignLifecycleStatus, string][] = [
    ['DRAFT', 'Draf'],
    ['SUBMITTED', 'Diajukan'],
    ['REJECTED', 'Perlu revisi'],
    ['ACTIVE', 'Aktif'],
    ['SUSPENDED', 'Ditangguhkan'],
    ['CANCELLED', 'Ditarik'],
    ['COMPLETED', 'Selesai'],
    ['EXPIRED', 'Berakhir'],
  ];

  it.each(labels)('reads %s as "%s"', (status, label) => {
    expect(campaignBadgeLabel(status)).toBe(label);
    render(<CampaignStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('reads a Rejected Campaign the Verifier closed for good as Ditolak, and one that may be resubmitted as Perlu revisi', () => {
    expect(campaignBadgeLabel('REJECTED', { rejectionFinal: true })).toBe('Ditolak');
    expect(campaignBadgeLabel('REJECTED', { rejectionFinal: false })).toBe('Perlu revisi');
  });

  it('ignores the final marker on any status but Rejected', () => {
    expect(campaignBadgeLabel('ACTIVE', { rejectionFinal: true })).toBe('Aktif');
  });
});
