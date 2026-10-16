export interface QuickActionWorkingTile {
  icon: string;
  label: string;
  href: string;
  color: string;
  comingSoon?: false;
}

export interface QuickActionComingSoonTile {
  icon: string;
  label: string;
  comingSoon: true;
}

export type QuickActionTile = QuickActionWorkingTile | QuickActionComingSoonTile;

/**
 * The homepage's quick-action tiles, matching the PRD's actual main menu:
 * Donasi, Galang Dana, Kolaborasi CSR, Wakaf, Hibah. Donasi and Galang Dana
 * are real, working destinations, restyled in tints of the Ledger Line brand
 * colors (`primary` for Donasi, `accent` for the fundraising CTA, matching
 * accent's own role as "CTAs that must stand out"). Kolaborasi CSR, Wakaf,
 * and Hibah each open their own landing, which states plainly what is and is not
 * open yet (ticket 75); the `comingSoon` tile shape stays for any future module
 * that has no page. Zakat is out of scope (2026-10-16).
 */
export const quickActionTiles: QuickActionTile[] = [
  { icon: '💰', label: 'Donasi', href: '/explore/all', color: '#E7F2ED' },
  { icon: '📢', label: 'Galang Dana', href: '/campaign/create', color: '#FBEAE3' },
  { icon: '🤝', label: 'Kolaborasi CSR', href: '/kolaborasi-csr', color: '#EAF0F8' },
  { icon: '🕌', label: 'Wakaf', href: '/wakaf', color: '#EEF3E4' },
  { icon: '🎁', label: 'Hibah', href: '/hibah', color: '#F6ECF1' },
];
