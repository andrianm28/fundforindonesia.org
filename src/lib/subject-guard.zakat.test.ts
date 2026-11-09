import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { listableCampaignWhere } from './subject-guard';
import { DEFAULT_OPERATIONS } from './operations';

/** A db whose operations row holds the given zakat switch, and no Demo Campaign. */
function dbWith(zakatEnabled: boolean | 'unreadable') {
  return {
    campaign: { count: vi.fn().mockResolvedValue(1) },
    siteSetting: {
      findUnique: vi.fn(async () => {
        if (zakatEnabled === 'unreadable') throw new Error('db down');
        return {
          value: { ...DEFAULT_OPERATIONS, zakat: { ...DEFAULT_OPERATIONS.zakat, enabled: zakatEnabled } },
          updatedAt: new Date(1),
        };
      }),
    },
  } as never;
}

const NOT_ZAKAT = { kind: { not: 'ZAKAT' } };

describe('listableCampaignWhere and the zakat module (ADR 0028)', () => {
  it('leaves a zakat Campaign out of public listings while the module is off', async () => {
    const where = await listableCampaignWhere(dbWith(false), new Date());
    expect(JSON.stringify(where)).toContain(JSON.stringify(NOT_ZAKAT));
  });

  it('fails closed: an unreadable setting also leaves it out', async () => {
    const where = await listableCampaignWhere(dbWith('unreadable'), new Date());
    expect(JSON.stringify(where)).toContain(JSON.stringify(NOT_ZAKAT));
  });

  it('lists it once the module is on', async () => {
    const where = await listableCampaignWhere(dbWith(true), new Date());
    expect(JSON.stringify(where)).not.toContain(JSON.stringify(NOT_ZAKAT));
  });
});
