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
 * and Hibah are honestly marked `comingSoon` -- none of these modules has a
 * frontend yet -- so QuickActionTiles renders them as disabled, non-clickable
 * tiles instead of silently falling back to /explore/all pretending to be a
 * real feature. Zakat keeps its own working /zakat route but no longer gets
 * a dedicated homepage tile, per the PRD folding it under Donasi.
 */
export const quickActionTiles: QuickActionTile[] = [
  { icon: '💰', label: 'Donasi', href: '/explore/all', color: '#E7F2ED' },
  { icon: '📢', label: 'Galang Dana', href: '/campaign/create', color: '#FBEAE3' },
  { icon: '🤝', label: 'Kolaborasi CSR', comingSoon: true },
  { icon: '🕌', label: 'Wakaf', comingSoon: true },
  { icon: '🎁', label: 'Hibah', comingSoon: true },
];
