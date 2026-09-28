// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { compareBaselines } from '../../ci/ratchet-counts.mjs';

/**
 * The ratchet judged ci/baselines.json from the commit it was judging, so a
 * pull request that raised the baseline was measured against the number it
 * raised: 60 errors against a baseline of 60 is at the baseline, the job went
 * green, and deploy-gate.sh saw a green `ratchet` job and let the commit
 * through. The rule against raising it lived in docs/agents/verification.md
 * and in nothing executable.
 *
 * These run the real ci/ratchet.mjs in a throwaway git repository whose
 * `main` holds one baseline and whose branch holds the one under test, with
 * `npx` stubbed so tsc and ESLint report a fixed number of errors (the
 * technique of deploy-gate.test.ts). Nothing here runs the real type checker
 * or linter, and nothing reaches the network.
 */

/** What the stubbed `npx tsc` prints: one `error TS…` line per error asked for. */
const NPX_STUB = `#!/bin/bash
case "$1" in
  tsc)
    for i in $(seq 1 "\${STUB_TSC_ERRORS:-0}"); do
      echo "src/file$i.ts(1,1): error TS2322: Type 'x' is not assignable to type 'y'."
    done
    ;;
  eslint)
    out=""
    while [ $# -gt 0 ]; do
      [ "$1" = --output-file ] && out="$2"
      shift
    done
    [ -n "$out" ] || exit 0
    printf '[{"filePath":"src/a.ts","errorCount":%s,"warningCount":0}]\\n' "\${STUB_LINT_ERRORS:-0}" > "$out"
    ;;
esac
`;

let root: string;
let repo: string;
let bin: string;

const BASE = { tsc: 47, lint: 193 };

type Fixture = {
  /** The baseline on the commit `main` was at when the branch left it. */
  base?: object;
  /** The baseline the branch under test commits. */
  committed?: object;
  /** The baseline `main`'s head carries afterwards, when main moved on. */
  mainHead?: object;
};

/** A repository with one commit on `main` holding `base`, and a branch whose
 * committed ci/baselines.json is `committed`. */
function checkout({ base = BASE, committed = base, mainHead }: Fixture = {}) {
  repo = join(root, 'repo');
  bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'npx'), NPX_STUB, { mode: 0o755 });
  mkdirSync(join(repo, 'ci'), { recursive: true });
  for (const file of ['ratchet.mjs', 'ratchet-counts.mjs']) {
    copyFileSync(resolve('ci', file), join(repo, 'ci', file));
  }
  const git = (...args: string[]) =>
    spawnSync('git', args, { cwd: repo, encoding: 'utf8' })?.stdout ?? '';

  writeFileSync(join(repo, 'ci', 'baselines.json'), JSON.stringify(base, null, 2));
  git('init', '-q');
  git('checkout', '-q', '-b', 'main');
  git('config', 'user.email', 'ratchet@test.invalid');
  git('config', 'user.name', 'ratchet test');
  git('add', '-A');
  git('commit', '-qm', 'base');

  git('checkout', '-q', '-b', 'the-pull-request');
  writeFileSync(join(repo, 'ci', 'baselines.json'), JSON.stringify(committed, null, 2));
  git('commit', '-qam', 'under test');

  if (mainHead) {
    git('checkout', '-q', 'main');
    writeFileSync(join(repo, 'ci', 'baselines.json'), JSON.stringify(mainHead, null, 2));
    git('commit', '-qam', 'main moved on');
    git('checkout', '-q', 'the-pull-request');
  }
}

/** Runs the ratchet in that repository. `errors` is what the stubbed tools
 * report; `env` is added to an otherwise clean environment. */
function ratchet(
  errors: { tsc: number; lint: number },
  env: Record<string, string> = {},
  { baseRef = 'main' }: { baseRef?: string } = {},
) {
  const result = spawnSync(process.execPath, [join(repo, 'ci', 'ratchet.mjs')], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
      RATCHET_BASE_REF: baseRef,
      STUB_TSC_ERRORS: String(errors.tsc),
      STUB_LINT_ERRORS: String(errors.lint),
      ...env,
    },
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ratchet-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the ratchet and the baseline under test', () => {
  it('fails a commit that raised its own baseline, even at exactly that number', () => {
    // The bug: 60 errors, baseline raised from 47 to 60 in the same commit.
    checkout({ committed: { tsc: 60, lint: 193 } });
    const { status, output } = ratchet({ tsc: 60, lint: 193 });
    expect(status).toBe(1);
    expect(output).toContain('::error::');
    expect(output).toContain('raises tsc from 47 to 60');
    // The counts themselves were fine; it is the raise that is refused, and
    // the escape hatch is named so the reader is not left at a dead end.
    expect(output).toContain('RATCHET_ALLOW_BASELINE_BUMP=1');
    expect(output).not.toContain('above the baseline of 60');
  });

  it('fails a raised lint baseline the same way', () => {
    checkout({ committed: { tsc: 47, lint: 220 } });
    const { status, output } = ratchet({ tsc: 47, lint: 220 });
    expect(status).toBe(1);
    expect(output).toContain('raises lint from 193 to 220');
  });

  it('passes a commit that lowered the baseline, the ordinary cleanup', () => {
    checkout({ committed: { tsc: 40, lint: 190 } });
    const { status, output } = ratchet({ tsc: 40, lint: 190 });
    expect(status, output).toBe(0);
    expect(output).toContain('lowered from 47 to 40');
    expect(output).toContain('lowered from 193 to 190');
  });

  it('passes a commit that left the baseline alone', () => {
    checkout();
    const { status, output } = ratchet(BASE);
    expect(status, output).toBe(0);
    expect(output).toContain('baseline tsc: unchanged at 47');
  });

  it('still fails new errors at an unchanged baseline', () => {
    checkout();
    const { status, output } = ratchet({ tsc: 48, lint: 193 });
    expect(status).toBe(1);
    expect(output).toContain('48 errors, above the baseline of 47');
  });

  it('lets a deliberate raise through the one path that is visible, as a warning', () => {
    checkout({ committed: { tsc: 60, lint: 193 } });
    const { status, output } = ratchet(
      { tsc: 60, lint: 193 },
      { RATCHET_ALLOW_BASELINE_BUMP: '1' },
    );
    expect(status, output).toBe(0);
    expect(output).toContain('::warning::');
    expect(output).toContain('raised from 47 to 60');
    expect(output).not.toContain('::error::');
    // The raise is still recorded where the next pull request will be read.
    expect(output).toContain('Remove that line from .github/workflows/ci.yml');
  });

  it('does not take anything but "1" as that permission', () => {
    checkout({ committed: { tsc: 60, lint: 193 } });
    for (const value of ['true', '0', '', 'yes', '1 ']) {
      const { status, output } = ratchet({ tsc: 60, lint: 193 }, { RATCHET_ALLOW_BASELINE_BUMP: value });
      expect(status, `"${value}" must not permit a raise`).toBe(1);
      expect(output).toContain('raises tsc from 47 to 60');
    }
  });

  it('fails a commit that stopped counting a check', () => {
    checkout({ committed: { tsc: 47 } });
    const { status, output } = ratchet(BASE);
    expect(status).toBe(1);
    expect(output).toContain('no longer has "lint"');
  });

  it('fails a commit that added a check at a number of its own', () => {
    checkout({ committed: { ...BASE, jest: 999 } });
    const { status, output } = ratchet(BASE);
    expect(status).toBe(1);
    expect(output).toContain('adds "jest"');
  });

  it('refuses to pass when it cannot read the base branch, rather than skipping the comparison', () => {
    checkout({ committed: { tsc: 60, lint: 193 } });
    const { status, output } = ratchet({ tsc: 60, lint: 193 }, {}, { baseRef: 'no-such-ref' });
    expect(status).toBe(1);
    expect(output).toContain('could not read ci/baselines.json as the base branch committed it');
    // The counts are never even run: there is nothing to compare them to.
    expect(output).not.toContain('at the baseline');
  });

  it('measures against the merge base, not the head of the base branch', () => {
    // main lowered both numbers after this branch left it (it is at 40/190 now,
    // the branch branched at 47/193). The branch is measured against what it
    // branched at: 47/193 is unchanged, not a raise of main's 40/190. Reading
    // main's head instead would call every long-lived branch a raiser, and
    // the documented answer to that is "merge the newest base in" -- which
    // would then be a second thing to fix for no gain.
    checkout({ committed: BASE, mainHead: { tsc: 40, lint: 190 } });
    const { status, output } = ratchet(BASE);
    expect(status, output).toBe(0);
    expect(output).toContain('baseline tsc: unchanged at 47');
  });
});

describe('compareBaselines', () => {
  it('names both numbers and the escape hatch when a baseline goes up', () => {
    const [verdict] = compareBaselines({ tsc: 60 }, { tsc: 47 });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('from 47 to 60');
    expect(verdict.message).toContain('RATCHET_ALLOW_BASELINE_BUMP=1');
  });

  it('warns rather than failing when the raise was permitted', () => {
    const [verdict] = compareBaselines({ tsc: 60 }, { tsc: 47 }, { allowBump: true });
    expect(verdict.ok).toBe(true);
    expect(verdict.warning).toBe(true);
  });

  it('passes a lowered and an unchanged baseline, and does not warn for either', () => {
    const verdicts = compareBaselines({ tsc: 40, lint: 193 }, { tsc: 47, lint: 193 }, { allowBump: true });
    expect(verdicts.every((v) => v.ok)).toBe(true);
    expect(verdicts.some((v) => v.warning)).toBe(false);
  });

  it('rejects a baseline that is not a number, which no comparison would catch', () => {
    const [verdict] = compareBaselines({ tsc: null }, { tsc: 47 });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('not a number');
  });
});

describe('the repository as it stands', () => {
  it('keeps both checks in ci/baselines.json, which the ratchet iterates over', () => {
    // What a raise looks like is not checked here: the base branch is not
    // readable from a shallow clone, and the ratchet is what compares the two.
    // What is checked is that the file this repo ships is the two counts the
    // ratchet iterates over, so a key cannot quietly go missing.
    const committed: unknown = JSON.parse(readFileSync(resolve('ci/baselines.json'), 'utf8'));
    expect(Object.keys(committed as object).sort()).toEqual(['lint', 'tsc']);
    for (const value of Object.values(committed as object)) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value as number).toBeGreaterThanOrEqual(0);
    }
  });
});
