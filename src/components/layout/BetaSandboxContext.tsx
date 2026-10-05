'use client';

import { createContext, useContext } from 'react';

/**
 * Carries the answer to "is this the public beta?" from the root layout (a
 * server component, the only place that reads BETA_SANDBOX) down to client
 * components that need to show it, such as the donation page's confirmation
 * step. They read this, never the environment: a client bundle cannot see a
 * server variable, and inlining one at build time is exactly what the marker
 * must not do (src/lib/deploy-environment.ts). Defaults to false, so a tree
 * rendered without the provider (a test, Storybook) shows no banner.
 */
const BetaSandboxContext = createContext(false);

export function BetaSandboxProvider({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <BetaSandboxContext.Provider value={active}>{children}</BetaSandboxContext.Provider>;
}

export function useBetaSandbox(): boolean {
  return useContext(BetaSandboxContext);
}
