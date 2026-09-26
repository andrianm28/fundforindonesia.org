// CI ratchet: the TypeScript and lint error counts may only go down
// (.scratch/ci-cd-github-actions, ticket 03).
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { countTscErrors, countLintErrors, compare } from './ratchet-counts.mjs';

function run(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    // Both tools exit non-zero when they find errors; their output is still what we count.
    return `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
}

const baselines = JSON.parse(readFileSync(new URL('./baselines.json', import.meta.url), 'utf8'));
run('npx next lint --format json --output-file .ratchet-lint.json');
const counts = {
  tsc: countTscErrors(run('npx tsc --noEmit')),
  lint: countLintErrors(readFileSync('.ratchet-lint.json', 'utf8')),
};
const verdicts = compare(counts, baselines);
for (const v of verdicts) console.log(v.ok ? v.message : `::error::${v.message}`);
process.exit(verdicts.every((v) => v.ok) ? 0 : 1);
