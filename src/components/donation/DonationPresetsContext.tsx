'use client';

import { createContext, useContext } from 'react';
import { DEFAULT_DONATION_PRESETS } from '@/lib/operations';

/**
 * Carries the Admin's donation presets (src/lib/operations.ts, key
 * `donationPresets`) from the donate layout, a server component that reads the
 * database, down to the client donate page. Defaults to the old built-in
 * amounts, so a tree rendered without the provider (a test) still offers some.
 */
const DonationPresetsContext = createContext<readonly number[]>(DEFAULT_DONATION_PRESETS);

export function DonationPresetsProvider({
  presets,
  children,
}: {
  presets: readonly number[];
  children: React.ReactNode;
}) {
  return <DonationPresetsContext.Provider value={presets}>{children}</DonationPresetsContext.Provider>;
}

export function useDonationPresets(): number[] {
  return [...useContext(DonationPresetsContext)];
}
