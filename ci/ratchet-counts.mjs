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
