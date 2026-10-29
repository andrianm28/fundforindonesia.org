import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Heartbeat of the scheduled jobs trigger (audit OPS-2): when the last run
 * happened, whether it was clean, and when one last was.
 *
 * Stored as a small JSON file in the container's temp directory, not in the
 * database. The only generic key-value table, SiteSetting, is the public-page
 * content table: its writer needs a real User id (updatedById is a required
 * foreign key) and its keys are the five page sections. A schema change was
 * out of scope. Consequences, stated so nobody relies on more than this gives:
 *
 *  - it lives as long as the app container, so it reads null after every
 *    deploy until the next run (the cron fires every 15 minutes);
 *  - one container only, which is what production runs.
 *
 * Consumers (a health or monitoring check) call `readJobsHeartbeat()` and
 * decide on the age of `lastSuccessAt`. Nothing here throws: a heartbeat that
 * cannot be written must never fail the jobs it describes.
 */
export interface JobsRunOutcome {
  ok: boolean;
  failedPhases: string[];
}

export interface JobsHeartbeat {
  lastRunAt: string;
  lastRunOk: boolean;
  failedPhases: string[];
  lastSuccessAt: string | null;
}

export const DEFAULT_HEARTBEAT_FILE = join(tmpdir(), 'ffi-jobs-heartbeat.json');

export function readJobsHeartbeat(file: string = DEFAULT_HEARTBEAT_FILE): JobsHeartbeat | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<JobsHeartbeat>;
    if (typeof parsed.lastRunAt !== 'string' || typeof parsed.lastRunOk !== 'boolean') return null;
    return {
      lastRunAt: parsed.lastRunAt,
      lastRunOk: parsed.lastRunOk,
      failedPhases: Array.isArray(parsed.failedPhases) ? parsed.failedPhases.map(String) : [],
      lastSuccessAt: typeof parsed.lastSuccessAt === 'string' ? parsed.lastSuccessAt : null,
    };
  } catch {
    return null;
  }
}

export function recordJobsRun(outcome: JobsRunOutcome, now: Date, file: string = DEFAULT_HEARTBEAT_FILE): void {
  try {
    const previous = readJobsHeartbeat(file);
    const next: JobsHeartbeat = {
      lastRunAt: now.toISOString(),
      lastRunOk: outcome.ok,
      failedPhases: outcome.failedPhases,
      lastSuccessAt: outcome.ok ? now.toISOString() : (previous?.lastSuccessAt ?? null),
    };
    // Write-then-rename so a reader never sees half a file.
    const partial = `${file}.${process.pid}.tmp`;
    writeFileSync(partial, JSON.stringify(next));
    renameSync(partial, file);
  } catch (err) {
    console.error('jobs heartbeat: could not record the run', err);
  }
}
