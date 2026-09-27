/**
 * `ledgerEntry.groupBy` for a fake transaction client: a real sum over real
 * rows, so the figure a test reads is a number the money module computed
 * rather than a constant the test asserted on.
 *
 * It was written out again in every test that shows a balance -- the money
 * layer's own readers (`ledger.ts`) are asked this question from
 * `ledger.test.ts`, `payouts.test.ts`, `refunds.test.ts`,
 * `manual-contributions.test.ts` and from every route test that renders a
 * figure, and each was carrying its own bucket loop. They drifted, and the
 * copies were the only place a reader had to check to know what
 * `escrowBalance` and `campaignBalance` would be handed in a test at all.
 *
 * One copy, in `tests/support/` with the other in-memory databases, and it
 * imports nothing -- so no test file has to reach into another test file for
 * it, and the fake cannot grow a dependency the module under test does not
 * have.
 *
 * `matches` is there for the two callers whose `where` is richer than the
 * plain equality the ledger's own readers ask for (`admin/reconcile`, which
 * filters on `lte` and `in`, and the impact database's own field matcher).
 */

type Row = Record<string, unknown>;

export type LedgerGroupByArgs = {
  by: string[];
  where?: Row;
};

/** One bucket per `by` combination, shaped the way Prisma returns it. */
export type LedgerGroupByResult = Array<Row & { _sum: { amount: number } }>;

export type LedgerGroupBy = (args: LedgerGroupByArgs) => Promise<LedgerGroupByResult>;

/**
 * Every column the `where` names, compared for equality. All the ledger's own
 * readers ask for exactly this: `{ account, campaignId }` or
 * `{ account, volunteerTripId }`.
 */
const matchesByEquality = (row: Row, where: Row): boolean =>
  Object.entries(where).every(([key, value]) => row[key] === value);

export function ledgerGroupBy(
  rows: readonly unknown[],
  options: { matches?: (row: Row, where: Row) => boolean } = {},
): LedgerGroupBy {
  const matches = options.matches ?? matchesByEquality;

  return async ({ by, where }) => {
    const all = rows as readonly Row[];
    // Filter first, then bucket: the `by` columns are not necessarily in the
    // `where`, so a bucket keyed on the filtered set is the grouping and not
    // an accident of the order rows were declared in.
    const buckets = new Map<string, { row: Row; sum: number }>();
    for (const row of all.filter((row) => matches(row, where ?? {}))) {
      const key = by.map((column) => String(row[column])).join('|');
      const bucket = buckets.get(key) ?? {
        row: Object.fromEntries(by.map((column) => [column, row[column]])),
        sum: 0,
      };
      bucket.sum += row.amount as number;
      buckets.set(key, bucket);
    }
    return Array.from(buckets.values()).map((bucket) => ({
      ...bucket.row,
      _sum: { amount: bucket.sum },
    }));
  };
}
