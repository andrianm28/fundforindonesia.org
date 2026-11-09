import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CampaignStatusHistory } from './CampaignStatusHistory';

describe('CampaignStatusHistory', () => {
  it('lists each change in order with its label, time in WIB, actor and capacity, and reason', () => {
    render(
      <CampaignStatusHistory
        entries={[
          { id: 'a', label: 'Diajukan', capacity: 'Penggalang', actorName: 'Siti', reason: null, at: new Date('2026-11-01T01:00:00Z') },
          { id: 'b', label: 'Disetujui', capacity: 'Verifier', actorName: 'Budi', reason: null, at: new Date('2026-11-02T03:00:00Z') },
          { id: 'c', label: 'Berakhir', capacity: 'Sistem', actorName: null, reason: 'Tenggat lewat.', at: new Date('2026-11-03T03:00:00Z') },
        ]}
      />,
    );

    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => li.querySelector('p')?.textContent)).toEqual(['Diajukan', 'Disetujui', 'Berakhir']);
    expect(items[0].textContent).toContain('Siti (Penggalang)');
    expect(items[0].textContent).toContain('08.00 WIB');
    expect(items[1].textContent).toContain('Budi (Verifier)');
    expect(items[2].textContent).toContain('Sistem');
    expect(items[2].textContent).toContain('Tenggat lewat.');
  });

  it('says so when nothing has been recorded', () => {
    render(<CampaignStatusHistory entries={[]} />);
    expect(screen.getByText('Belum ada perubahan status yang tercatat.')).toBeTruthy();
  });
});
