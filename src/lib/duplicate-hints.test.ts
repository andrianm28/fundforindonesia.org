import { describe, it, expect } from 'vitest';
import {
  DuplicateCampaignNotFoundError,
  findDuplicateCampaignHints,
  InvalidDuplicateSimilarityThresholdError,
  setDuplicateSimilarityThreshold,
} from './duplicate-hints';

/**
 * Duplicate hints for a Verifier about to judge a Campaign (prd-compliance
 * 14, PRD FFI-05): the few existing Campaigns this one most resembles, so a
 * duplicate or a repeat fraud is caught before the Campaign is published.
 *
 * The three matches the PRD names -- same Fundraiser, trigram title
 * similarity over the Admin's threshold, identical beneficiary name -- are one
 * SQL question to Postgres, because the trigram similarity is a database
 * function and the other two are plain column comparisons on the same table.
 * So the stand-in below answers `$queryRaw` with the rows that statement would
 * return and records the statement it was asked, which is what the tests read
 * to pin the three matches, the cap, and the threshold.
 */

const NOW = new Date('2026-09-27T09:00:00Z');

type CampaignForHints = {
  id: string;
  title: string;
  creatorId: string;
  beneficiaryName: string | null;
};

type RawCall = { sql: string; values: unknown[] };

function hintRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'campaign-2',
    slug: 'bantu-korban-banjir',
    title: 'Bantu Korban Banjir Jawa Barat',
    lifecycleStatus: 'ACTIVE',
    reasons: ['SAME_FUNDRAISER'],
    titleSimilarity: 0.42,
    ...overrides,
  };
}

function makeDb(
  seed: {
    campaign?: CampaignForHints | null;
    threshold?: { threshold: number } | null;
    rows?: Record<string, unknown>[];
  } = {},
) {
  const calls: RawCall[] = [];
  const rows = seed.rows ?? [];
  const db = {
    campaign: {
      findUnique: async () =>
        seed.campaign === undefined
          ? {
              id: 'campaign-1',
              title: 'Bantu Korban Banjir',
              creatorId: 'creator-1',
              beneficiaryName: 'Keluarga Mahdi',
            }
          : seed.campaign,
    },
    duplicateSimilarityThreshold: { findFirst: async () => seed.threshold ?? null },
    $queryRaw: async (query: { sql?: string; text?: string; values: unknown[] }) => {
      calls.push({ sql: query.sql ?? query.text ?? '', values: query.values });
      return rows;
    },
  };
  return { db, calls };
}

describe('findDuplicateCampaignHints', () => {
  it('asks Postgres for the same Fundraiser, a similar trigram title, or the same beneficiary name, and never for the Campaign itself', async () => {
    const { db, calls } = makeDb({ rows: [] });

    await findDuplicateCampaignHints(db as never, { campaignId: 'campaign-1' });

    expect(calls).toHaveLength(1);
    const { sql, values } = calls[0];
    expect(sql).toContain('c."creatorId" = ?');
    expect(sql).toContain('c."beneficiaryName" = ?');
    // pg_trgm's own function, not a LIKE or a hand-rolled comparison.
    expect(sql).toContain('similarity(c."title", ?) >= ?');
    expect(sql).toContain('c."id" <> ?');
    expect(sql).toContain('LIMIT 5');
    // The Campaign's own values are parameters, never spliced into the text:
    // a title with a quote in it cannot break the statement.
    expect(values).toEqual(
      expect.arrayContaining(['campaign-1', 'creator-1', 'Keluarga Mahdi', 'Bantu Korban Banjir', 0.6]),
    );
  });

  it("matches titles on the threshold the Admin set, and on the PRD's 0.6 until they set one", async () => {
    const unset = makeDb({ rows: [] });
    await findDuplicateCampaignHints(unset.db as never, { campaignId: 'campaign-1' });
    expect(unset.calls[0].values).toContain(0.6);

    const set = makeDb({ rows: [], threshold: { threshold: 0.85 } });
    await findDuplicateCampaignHints(set.db as never, { campaignId: 'campaign-1' });
    expect(set.calls[0].values).toContain(0.85);
  });

  it('never matches two Campaigns that both name no beneficiary', async () => {
    const { db, calls } = makeDb({ campaign: { id: 'campaign-1', title: 'Bantu Korban Banjir', creatorId: 'creator-1', beneficiaryName: null } });

    await findDuplicateCampaignHints(db as never, { campaignId: 'campaign-1' });

    // The absent name reaches the statement as the empty string, so it is
    // compared against a NULL column and matches nothing, rather than
    // matching every Campaign that also leaves the name out.
    expect(calls[0].values).toContain('');
    expect(calls[0].values).not.toContain(null);
  });

  it('never hands a Verifier more than five hints, whatever the statement returned', async () => {
    const { db } = makeDb({
      rows: Array.from({ length: 8 }, (_, index) =>
        hintRow({ id: `campaign-${index + 2}`, reasons: ['SIMILAR_TITLE'] }),
      ),
    });

    const hints = await findDuplicateCampaignHints(db as never, { campaignId: 'campaign-1' });

    expect(hints).toHaveLength(5);
  });

  it('refuses a Campaign that is not there, rather than showing hints about nothing', async () => {
    const { db, calls } = makeDb({ campaign: null });

    await expect(findDuplicateCampaignHints(db as never, { campaignId: 'gone' })).rejects.toThrow(
      DuplicateCampaignNotFoundError,
    );
    expect(calls).toHaveLength(0);
  });

  it('names the Campaigns a Verifier should look at first, and why each one matched', async () => {
    const { db } = makeDb({
      rows: [
        hintRow({
          id: 'campaign-2',
          slug: 'bantu-korban-banjir-jawa-barat',
          title: 'Bantu Korban Banjir Jawa Barat',
          reasons: ['SAME_FUNDRAISER', 'SIMILAR_TITLE'],
          titleSimilarity: 0.91,
        }),
        hintRow({
          id: 'campaign-3',
          slug: 'bantu-korban-banjir-jateng',
          title: 'Bantu Korban Banjir Jawa Tengah',
          reasons: ['SIMILAR_TITLE'],
          titleSimilarity: 0.64,
        }),
        hintRow({
          id: 'campaign-4',
          slug: 'rumah-sihat-untuk-mba-sari',
          title: 'Rumah Sihat untuk Mbak Sari',
          reasons: ['SAME_BENEFICIARY'],
          titleSimilarity: 0.08,
        }),
      ],
    });

    const hints = await findDuplicateCampaignHints(db as never, { campaignId: 'campaign-1' });

    expect(hints).toEqual([
      {
        campaignId: 'campaign-2',
        slug: 'bantu-korban-banjir-jawa-barat',
        title: 'Bantu Korban Banjir Jawa Barat',
        lifecycleStatus: 'ACTIVE',
        reasons: ['SAME_FUNDRAISER', 'SIMILAR_TITLE'],
        titleSimilarity: 0.91,
      },
      {
        campaignId: 'campaign-3',
        slug: 'bantu-korban-banjir-jateng',
        title: 'Bantu Korban Banjir Jawa Tengah',
        lifecycleStatus: 'ACTIVE',
        reasons: ['SIMILAR_TITLE'],
        titleSimilarity: 0.64,
      },
      {
        campaignId: 'campaign-4',
        slug: 'rumah-sihat-untuk-mba-sari',
        title: 'Rumah Sihat untuk Mbak Sari',
        lifecycleStatus: 'ACTIVE',
        reasons: ['SAME_BENEFICIARY'],
        titleSimilarity: 0.08,
      },
    ]);
  });
});

describe('setDuplicateSimilarityThreshold', () => {
  function makeSettingDb() {
    const created: Record<string, unknown>[] = [];
    const db = {
      duplicateSimilarityThreshold: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: `threshold-${created.length}`, ...data };
        },
      },
    };
    return { db, created };
  }

  it('records the Admin and the time by inserting a new threshold, never by editing the old one', async () => {
    const { db, created } = makeSettingDb();

    await setDuplicateSimilarityThreshold(db as never, { threshold: 0.8, actorId: 'admin-1', now: NOW });

    expect(created).toEqual([{ threshold: 0.8, setById: 'admin-1', setAt: NOW }]);
  });

  it.each([0, -0.1, 1.1, Number.NaN, '0.7'])(
    'refuses %p, which is no similarity score',
    async (threshold) => {
      const { db, created } = makeSettingDb();

      await expect(
        setDuplicateSimilarityThreshold(db as never, { threshold: threshold as number, actorId: 'admin-1' }),
      ).rejects.toThrow(InvalidDuplicateSimilarityThresholdError);
      expect(created).toEqual([]);
    },
  );
});
