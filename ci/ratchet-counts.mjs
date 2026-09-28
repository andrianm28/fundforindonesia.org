// Pure counting and comparison for the CI ratchet (ci/ratchet.mjs).
// Kept free of process and fs so it can be unit-tested.

/** `error TS…` lines from `tsc --noEmit`, ignoring generated `.next/` types,
 * which only exist after a local build and would make counts machine-dependent. */
export function countTscErrors(output) {
  return output
    .split('\n')
    .filter((line) => /error TS\d+:/.test(line) && !line.startsWith('.next/'))
    .length;
}

/** Total `errorCount` across ESLint's JSON formatter output. */
export function countLintErrors(json) {
  const results = JSON.parse(json);
  return results.reduce((sum, file) => sum + (file.errorCount ?? 0), 0);
}

/** One verdict per check: fail when a count exceeds its baseline; when it
 * drops, pass but ask for the baseline to be lowered so it cannot grow back. */
export function compare(counts, baselines) {
  return Object.keys(baselines).map((name) => {
    const count = counts[name];
    const baseline = baselines[name];
    if (count > baseline) {
      return { name, ok: false, message: `${name}: ${count} errors, above the baseline of ${baseline}. Fix the new errors.` };
    }
    if (count < baseline) {
      return { name, ok: true, message: `${name}: ${count} errors, below the baseline of ${baseline}. Lower ci/baselines.json "${name}" to ${count}.` };
    }
    return { name, ok: true, message: `${name}: ${count} errors, at the baseline.` };
  });
}

const HOW_TO_RAISE =
  'Fix the new errors instead. To raise it deliberately (a refactor that moved or created files, a lint rule that was just turned on), set RATCHET_ALLOW_BASELINE_BUMP=1 on the ratchet step in .github/workflows/ci.yml in the same pull request, and remove that line in the next one. It is never set by default: the raise is meant to be a second thing in the diff that a reviewer sees.';

/** One verdict per check, about the baseline itself rather than the counts it
 * is compared with. `committed` is ci/baselines.json as the commit under test
 * has it; `base` is the same file as the base branch has it, which is the
 * whole point: a commit that raised its own baseline would otherwise be
 * measured against the number it raised, and go green.
 *
 * A baseline may go down, and stay; it may not go up, and no check may be
 * added or dropped, without `allowBump` -- the environment variable, set by
 * hand in the workflow, never read from the commit. `ok` verdicts carry
 * `warning: true` when the escape hatch was used, so a raise leaves a
 * ::warning:: in the job log after it has been allowed.
 *
 * @returns {{ name: string, ok: boolean, warning: boolean, message: string }[]}
 */
export function compareBaselines(committed, base, { allowBump = false } = {}) {
  const raised = (name, from, to) => ({
    name,
    ok: allowBump,
    warning: allowBump,
    message: allowBump
      ? `baseline ${name}: raised from ${from} to ${to}, allowed by RATCHET_ALLOW_BASELINE_BUMP=1. Remove that line from .github/workflows/ci.yml in the next pull request, and lower the baseline back as soon as the errors are gone.`
      : `ci/baselines.json raises ${name} from ${from} to ${to}, which is what the ratchet exists to prevent: raising a baseline hides the errors it was raised for. ${HOW_TO_RAISE}`,
  });
  const isCount = (value) => typeof value === 'number' && Number.isFinite(value);
  const names = [...new Set([...Object.keys(base), ...Object.keys(committed)])].sort();

  return names.map((name) => {
    if (!(name in committed)) {
      return {
        name,
        ok: false,
        message: `ci/baselines.json no longer has "${name}", so the ratchet stops counting it and every ${name} error after this passes. ${HOW_TO_RAISE}`,
      };
    }
    if (!(name in base)) {
      return {
        name,
        ok: false,
        message: `ci/baselines.json adds "${name}", which the base branch does not have. A new check starts at what main actually has, not at a number that hides errors. ${HOW_TO_RAISE}`,
      };
    }
    const from = base[name];
    const to = committed[name];
    if (!isCount(from) || !isCount(to)) {
      return { name, ok: false, message: `ci/baselines.json "${name}" is ${JSON.stringify(to)}, not a number. It has to be a count of errors, comparable with the base branch's ${JSON.stringify(from)}.` };
    }
    if (to > from) return raised(name, from, to);
    if (to < from) return { name, ok: true, message: `baseline ${name}: lowered from ${from} to ${to}. The errors behind the old number cannot come back through this commit.` };
    return { name, ok: true, message: `baseline ${name}: unchanged at ${to}.` };
  });
}
