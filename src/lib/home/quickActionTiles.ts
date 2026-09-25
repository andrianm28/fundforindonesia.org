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
 * The homepage's quick-action tiles. Donasi, Zakat, and Galang Dana are real,
 * working destinations, restyled in tints of the Ledger Line brand colors
 * (`primary` for the two giving actions, `accent` for the fundraising CTA,
 * matching accent's own role as "CTAs that must stand out"). Volunteer
 * (formerly "Experience") and Kolaborasi CSR are honestly marked
 * `comingSoon` -- neither module has a frontend yet -- so QuickActionTiles
 * renders them as disabled, non-clickable tiles instead of silently falling
 * back to /explore/all pretending to be a real feature. Asuransi is not a
 * real platform module and has no entry here at all. Wakaf and Hibah stay
 * reachable as Campaign Kind filters within Donasi/Explore -- they do not
 * get dedicated cards here.
 */
export const quickActionTiles: QuickActionTile[] = [
  { icon: '💰', label: 'Donasi', href: '/explore/all', color: '#E7F2ED', comingSoon: undefined },
  { icon: '🕌', label: 'Zakat', href: '/zakat', color: '#D3E7DC', comingSoon: undefined },
  {
    icon: '📢',
    label: 'Galang Dana',
    href: '/campaign/create',
    color: '#FBEAE3',
    comingSoon: undefined,
  },
  { icon: '✨', label: 'Volunteer', comingSoon: true },
  { icon: '🤝', label: 'Kolaborasi CSR', comingSoon: true },
];
