// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordJobsRun, readJobsHeartbeat } from './jobs-heartbeat';

let dir: string;
let file: string;
const T1 = new Date('2026-10-16T01:00:00.000Z');
const T2 = new Date('2026-10-16T01:15:00.000Z');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hb-'));
  file = join(dir, 'hb.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('jobs heartbeat', () => {
  it('reads null before any run has been recorded', () => {
    expect(readJobsHeartbeat(file)).toBeNull();
  });

  it('records a successful run as both the last run and the last success', () => {
    recordJobsRun({ ok: true, failedPhases: [] }, T1, file);

    expect(readJobsHeartbeat(file)).toEqual({
      lastRunAt: T1.toISOString(),
      lastRunOk: true,
      failedPhases: [],
      lastSuccessAt: T1.toISOString(),
    });
  });

  it('a failed run moves lastRunAt but keeps the previous lastSuccessAt', () => {
    recordJobsRun({ ok: true, failedPhases: [] }, T1, file);
    recordJobsRun({ ok: false, failedPhases: ['escrowRelease'] }, T2, file);

    expect(readJobsHeartbeat(file)).toEqual({
      lastRunAt: T2.toISOString(),
      lastRunOk: false,
      failedPhases: ['escrowRelease'],
      lastSuccessAt: T1.toISOString(),
    });
  });

  it('a first-ever failed run has no lastSuccessAt', () => {
    recordJobsRun({ ok: false, failedPhases: ['escrowRelease'] }, T1, file);

    expect(readJobsHeartbeat(file)?.lastSuccessAt).toBeNull();
  });

  it('treats a corrupt file as no heartbeat instead of throwing', () => {
    writeFileSync(file, '{not json');

    expect(readJobsHeartbeat(file)).toBeNull();
  });

  it('never throws when the file cannot be written', () => {
    expect(() =>
      recordJobsRun({ ok: true, failedPhases: [] }, T1, join(dir, 'no', 'such', 'dir', 'hb.json')),
    ).not.toThrow();
  });
});
