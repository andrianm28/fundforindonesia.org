import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { AdminUsageReportPanel } from './AdminUsageReportPanel';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function usageReport(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ur-1',
    narrative: 'Dana dipakai untuk sembako.',
    lineItems: [{ label: 'Sembako', amount: 300_000 }],
    beneficiaryCount: 15,
    photos: ['https://example.com/bukti.jpg'],
    disputedAt: null,
    disputedReason: null,
    ...overrides,
  };
}

/**
 * The photo is the PRD's public evidence (ticket 22; PRD FFI-07a), and an
 * Admin deciding whether to dispute a report needs to see it too -- the same
 * requirement the public Campaign page's Pencairan Dana tab renders
 * (CampaignDetailView.test.tsx).
 */
describe('AdminUsageReportPanel -- photos', () => {
  afterEach(() => cleanup());

  it('renders each http(s) photo as a link with rel="noopener noreferrer"', () => {
    render(
      <AdminUsageReportPanel
        slug="kampanye"
        payoutId="payout-1"
        usageReport={usageReport({ photos: ['https://example.com/a.jpg', 'http://example.com/b.jpg'] })}
      />,
    );

    const links = screen.getAllByRole('link', { name: /foto bukti/i });
    expect(links).toHaveLength(2);
    links.forEach((link) => expect(link.getAttribute('rel')).toBe('noopener noreferrer'));
  });

  it('does not render a javascript: photo URL as a link', () => {
    render(
      <AdminUsageReportPanel
        slug="kampanye"
        payoutId="payout-1"
        usageReport={usageReport({ photos: ['javascript:alert(1)'] })}
      />,
    );

    expect(screen.queryByRole('link', { name: /foto bukti/i })).toBeNull();
  });
});
