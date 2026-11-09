import { describe, it, expect, vi } from 'vitest';
import { findRegistrableCampaign } from './service';
import { OPERATIONS_KEY } from '@/lib/operations';

/**
 * A recurring donation is a standing checkout, so a zakat Campaign can be
 * registered only when the zakat checkout itself would take it (ADR 0028).
 */

const NOW = new Date('2026-11-09T05:00:00.000Z');
const ON = { enabled: true, nisabAmount: 85_000_000, recipientOrganisationId: 'org-1' };

function fakeDb(zakat: unknown, collectingEntityId: string | null = 'org-1') {
  const campaign = {
    id: 'c-z',
    title: 'Zakat',
    kind: 'ZAKAT',
    category: 'zakat',
    isDemo: false,
    lifecycleStatus: 'ACTIVE',
    deadline: null,
    collectingEntity: collectingEntityId
      ? {
          id: collectingEntityId,
          name: 'Lembaga Zakat',
          permits: [{ kinds: ['ZAKAT'], validFrom: new Date('2026-01-01'), validTo: new Date('2027-12-31') }],
          kindAuthorisations: [{ kind: 'ZAKAT', validFrom: new Date('2026-01-01'), validTo: new Date('2027-12-31') }],
        }
      : null,
  };
  return {
    campaign: { findUnique: vi.fn(async () => campaign) },
    siteSetting: {
      findUnique: vi.fn(async () => ({
        key: OPERATIONS_KEY,
        value: { donationsOpen: true, maintenance: { on: false, message: '' }, zakat, history: [] },
        updatedAt: new Date(1),
      })),
    },
  } as never;
}

describe('findRegistrableCampaign and zakat', () => {
  it('refuses a zakat Campaign while the module is off', async () => {
    expect(await findRegistrableCampaign(fakeDb({ ...ON, enabled: false }), 'c-z', NOW)).toBeNull();
  });

  it('refuses a zakat Campaign that is not collected under the configured recipient', async () => {
    expect(await findRegistrableCampaign(fakeDb(ON, 'org-other'), 'c-z', NOW)).toBeNull();
  });

  it('accepts a zakat Campaign of the configured recipient while the module is on', async () => {
    expect(await findRegistrableCampaign(fakeDb(ON), 'c-z', NOW)).toEqual({ id: 'c-z', title: 'Zakat' });
  });
});
