// CI ratchet: the TypeScript and lint error counts may only go down
// (.scratch/ci-cd-github-actions, ticket 03).
//
// Two comparisons, because the first one alone can be edited by the commit it
// judges. The counts go against ci/baselines.json as this commit has it, and
// that file goes against ci/baselines.json as the base branch has it: a pull
// request that raised the baseline would otherwise be measured against the
// number it raised, go green, and hand deploy-gate.sh a green `ratchet` job
// to look at. Raising it is still possible, but only where it is seen: set
// RATCHET_ALLOW_BASELINE_BUMP=1 on this job's step in .github/workflows/ci.yml,
// in the same pull request as the raise, so the diff carries two things
// instead of one. Nothing here reads that variable from the commit, and it is
// never set by default.
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { countTscErrors, countLintErrors, compare, compareBaselines } from './ratchet-counts.mjs';

const BASELINE_PATH = 'ci/baselines.json';

function run(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    // Both tools exit non-zero when they find errors; their output is still what we count.
    return `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The baseline the base branch last committed, which is what this commit
 * would have inherited had it not touched the file.
 *
 * Read at the merge base, not at the base branch's head: main lowers these
 * numbers as it goes, so a branch that lowers one too must not be told it
 * raised it. The first ref that resolves wins, so a plain clone (which has
 * `main` and not `origin/main`) is still measured, and RATCHET_BASE_REF names
 * another trunk for a repository that is not on main.
 *
 * If none of them resolves, this throws rather than skipping the comparison:
 * a ratchet that cannot see the baseline it is measuring against measures
 * nothing, and it would call that nothing green.
 */
function baselineFromBaseBranch() {
  const refs = (process.env.RATCHET_BASE_REF ?? 'origin/main main').split(/\s+/).filter(Boolean);
  for (const ref of refs) {
    let commit;
    try {
      commit = git(['merge-base', ref, 'HEAD']).trim();
    } catch {
      continue; // no such ref, or unrelated histories: try the next one
    }
    try {
      return JSON.parse(git(['show', `${commit}:${BASELINE_PATH}`]));
    } catch {
      continue; // the base branch has no readable baseline there
    }
  }
  throw new Error(
    `could not read ${BASELINE_PATH} as the base branch committed it (tried: ${refs.join(', ')}). ` +
      `Fetch the base branch (git fetch origin main) or set RATCHET_BASE_REF to the ref to measure against. ` +
      'The ratchet refuses to pass when it cannot tell a raise from an unchanged baseline.',
  );
}

const baselines = JSON.parse(readFileSync(new URL('./baselines.json', import.meta.url), 'utf8'));

let base;
try {
  base = baselineFromBaseBranch();
} catch (error) {
  console.log(`::error::${error.message}`);
  process.exit(1);
}

run('npx eslint . --format json --output-file .ratchet-lint.json');
const counts = {
  tsc: countTscErrors(run('npx tsc --noEmit')),
  lint: countLintErrors(readFileSync('.ratchet-lint.json', 'utf8')),
};
const verdicts = [
  ...compare(counts, baselines),
  ...compareBaselines(baselines, base, { allowBump: process.env.RATCHET_ALLOW_BASELINE_BUMP === '1' }),
];
for (const v of verdicts) {
  if (!v.ok) console.log(`::error::${v.message}`);
  else if (v.warning) console.log(`::warning::${v.message}`);
  else console.log(v.message);
}
process.exit(verdicts.every((v) => v.ok) ? 0 : 1);
