import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AkadWakafView } from './AkadWakafView';

/**
 * The Akad Wakaf print page (CONTEXT.md, Akad Wakaf): names the Wakif, the
 * amount, the purpose and the nazhir (the Collecting Entity, ADR 0010), and
 * can be printed the same way the Receipt page can.
 */

function baseProps() {
  return {
    wakifName: 'Sari',
    amount: 500_000,
    purpose: 'Wakaf Pembangunan Masjid Al-Ikhlas',
    nazhirName: 'Yayasan Contoh',
    createdAt: '2026-09-26T10:00:00.000Z',
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AkadWakafView', () => {
  it('shows the Wakif, the amount, the purpose and the nazhir', () => {
    render(<AkadWakafView {...baseProps()} />);

    expect(screen.getByText('Sari')).toBeTruthy();
    expect(screen.getByText('Rp500.000')).toBeTruthy();
    expect(screen.getByText('Wakaf Pembangunan Masjid Al-Ikhlas')).toBeTruthy();
    expect(screen.getByText('Yayasan Contoh')).toBeTruthy();
  });

  it('falls back to a generic label when there is no Wakif name', () => {
    render(<AkadWakafView {...baseProps()} wakifName={null} />);

    // Both the "Wakif" field label and its fallback value read "Wakif".
    expect(screen.getAllByText('Wakif')).toHaveLength(2);
  });

  it('prints the page when Cetak is clicked', () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    render(<AkadWakafView {...baseProps()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cetak' }));

    expect(print).toHaveBeenCalledTimes(1);
  });
});
