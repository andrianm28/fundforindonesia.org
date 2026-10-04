import { loadFieldKeys } from './field-encryption';

/**
 * Boot-time environment check, called from src/instrumentation.ts (the Node
 * runtime only, at server start; `next build` does not run it). Several
 * failures here are silent at request time: the rate limiter fails OPEN, a
 * missing JOBS_SECRET only answers 401 to the scheduler, and a localhost
 * NEXTAUTH_URL only breaks OAuth callbacks and cookies. Failing the boot makes
 * each omission loud instead. Only production is held to it; dev and tests may
 * run without.
 *
 * Every problem is reported in one error, by variable name only. A value is
 * never echoed, because a key that is wrong is still a key.
 */

const MIN_JOBS_SECRET_LENGTH = 16;

/** A host that cannot be the public address: loopback, private ranges, or a name no outsider can resolve. */
function isNonPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.includes(':')) return true; // an IPv6 literal is never the site's public name
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    );
  }
  if (!host.includes('.')) return true; // a bare name such as "app" or "web"
  return /\.(local|internal|lan|home|test|invalid|example)$/.test(host);
}

function checkAuthUrl(raw: string | undefined, problems: string[]): void {
  if (!raw) {
    problems.push('NEXTAUTH_URL must be set to the public https address of the site');
    return;
  }
  // The CI e2e job and the image smoke test run the production bundle on
  // localhost; they say so explicitly. Nothing else sets this.
  if (process.env.ALLOW_LOCAL_AUTH_URL === '1') return;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    problems.push('NEXTAUTH_URL is not a valid URL');
    return;
  }
  if (url.protocol !== 'https:') {
    problems.push('NEXTAUTH_URL must use https in production');
  } else if (isNonPublicHost(url.hostname)) {
    problems.push('NEXTAUTH_URL must be a public host, not localhost or a private address');
  }
}

export function assertProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const problems: string[] = [];

  if (!process.env.RATE_LIMIT_SECRET && !process.env.NEXTAUTH_SECRET) {
    problems.push('RATE_LIMIT_SECRET (or NEXTAUTH_SECRET) must be set');
  }

  // ADR 0012: no key means the app cannot write a contact detail at all, so
  // production refuses to start rather than refuse the first Donor. The loader
  // already rejects a partial set, a key that is not 32 bytes, one key used for
  // both jobs, and a shared key id; it returns null only when nothing is set.
  try {
    if (!loadFieldKeys(process.env)) {
      problems.push(
        'FIELD_ENCRYPTION_KEY, FIELD_ENCRYPTION_KEY_ID, FIELD_HMAC_KEY and FIELD_HMAC_KEY_ID must all be set',
      );
    }
  } catch (e) {
    problems.push(e instanceof Error ? e.message : 'the FIELD_* keys are invalid');
  }

  const jobs = process.env.JOBS_SECRET;
  if (!jobs || jobs.length < MIN_JOBS_SECRET_LENGTH) {
    problems.push(`JOBS_SECRET must be set, at least ${MIN_JOBS_SECRET_LENGTH} characters`);
  }

  checkAuthUrl(process.env.NEXTAUTH_URL, problems);

  if (problems.length > 0) {
    throw new Error(`Invalid production environment:\n- ${problems.join('\n- ')}`);
  }
}
