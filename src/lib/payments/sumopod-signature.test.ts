import { describe, it, expect } from 'vitest';
import { computeSumopodSignature, verifySumopodSignature } from './sumopod-signature';

/**
 * Sumopod signs webhooks with the svix scheme: HMAC-SHA256 over
 * `{svix-id}.{svix-timestamp}.{raw body}`, keyed by the base64 body of the
 * `whsec_` secret, and base64-encoded.
 *
 * Tested against the algorithm as documented rather than against this
 * implementation's own output. A test that asserts the code matches itself
 * would pass just as happily on a wrong algorithm, and this is the one piece
 * of crypto standing between "Sumopod says this was paid" and "anyone who
 * found the URL says this was paid".
 */

// A real-shaped secret. The bytes after the prefix are base64.
const SECRET = 'whsec_OkjY4nDqKbBxbBRPcHjT5ZvpXeWTm6J2';
const SVIX_ID = 'msg_2abcDEF1234567890';
const RAW_BODY = '{"event_type":"payment.completed","data":{"order_id":"donation-1"}}';

/** Seconds, as svix sends it. */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function referenceSignature(
  id: string,
  timestamp: string,
  body: string,
  secret: string,
): Promise<string> {
  const rawKey = atob(secret.replace(/^whsec_/, ''));
  const keyBytes = new Uint8Array(rawKey.length);
  for (let i = 0; i < rawKey.length; i++) keyBytes[i] = rawKey.charCodeAt(i);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  );
  const macBytes = new Uint8Array(mac);
  let binary = '';
  for (let i = 0; i < macBytes.length; i++) binary += String.fromCharCode(macBytes[i]);
  return btoa(binary);
}

describe('computeSumopodSignature', () => {
  it('is base64 HMAC-SHA256 of id.timestamp.body keyed by the decoded secret', async () => {
    const timestamp = String(nowSeconds());
    const expected = await referenceSignature(SVIX_ID, timestamp, RAW_BODY, SECRET);

    await expect(
      computeSumopodSignature({ id: SVIX_ID, timestamp, body: RAW_BODY }, SECRET),
    ).resolves.toBe(expected);
  });

  it('treats the whsec_ prefix as not part of the key', async () => {
    const timestamp = String(nowSeconds());

    const withPrefix = await computeSumopodSignature(
      { id: SVIX_ID, timestamp, body: RAW_BODY },
      SECRET,
    );
    const withoutPrefix = await computeSumopodSignature(
      { id: SVIX_ID, timestamp, body: RAW_BODY },
      SECRET.replace(/^whsec_/, ''),
    );

    expect(withPrefix).toBe(withoutPrefix);
  });

  it('changes when the body changes by a single character', async () => {
    const timestamp = String(nowSeconds());

    const a = await computeSumopodSignature({ id: SVIX_ID, timestamp, body: RAW_BODY }, SECRET);
    const b = await computeSumopodSignature(
      { id: SVIX_ID, timestamp, body: `${RAW_BODY} ` },
      SECRET,
    );

    expect(a).not.toBe(b);
  });
});

describe('verifySumopodSignature', () => {
  it('accepts a correctly signed delivery', async () => {
    const timestamp = String(nowSeconds());
    const sig = await referenceSignature(SVIX_ID, timestamp, RAW_BODY, SECRET);

    await expect(
      verifySumopodSignature(
        { id: SVIX_ID, timestamp, body: RAW_BODY, header: `v1,${sig}` },
        SECRET,
      ),
    ).resolves.toBe(true);
  });

  it('accepts when the header carries several signatures and one matches', async () => {
    // Svix sends both the old and the new signature for about a day after the
    // secret is rotated. Checking only the first would break every delivery in
    // that window.
    const timestamp = String(nowSeconds());
    const sig = await referenceSignature(SVIX_ID, timestamp, RAW_BODY, SECRET);

    await expect(
      verifySumopodSignature(
        { id: SVIX_ID, timestamp, body: RAW_BODY, header: `v1,someOtherSignature== v1,${sig}` },
        SECRET,
      ),
    ).resolves.toBe(true);
  });

  it('rejects a signature computed over a different body', async () => {
    const timestamp = String(nowSeconds());
    const sig = await referenceSignature(SVIX_ID, timestamp, RAW_BODY, SECRET);

    await expect(
      verifySumopodSignature(
        { id: SVIX_ID, timestamp, body: '{"event_type":"payment.completed"}', header: `v1,${sig}` },
        SECRET,
      ),
    ).resolves.toBe(false);
  });

  it('rejects a signature computed under a different secret', async () => {
    const timestamp = String(nowSeconds());
    const sig = await referenceSignature(SVIX_ID, timestamp, RAW_BODY, 'whsec_AAAAAAAAAAAAAAAA');

    await expect(
      verifySumopodSignature(
        { id: SVIX_ID, timestamp, body: RAW_BODY, header: `v1,${sig}` },
        SECRET,
      ),
    ).resolves.toBe(false);
  });

  it('rejects a header with no v1 signature in it', async () => {
    const timestamp = String(nowSeconds());

    await expect(
      verifySumopodSignature(
        { id: SVIX_ID, timestamp, body: RAW_BODY, header: 'garbage' },
        SECRET,
      ),
    ).resolves.toBe(false);
  });

  it('rejects a delivery whose timestamp is older than the replay window', async () => {
    // A correctly signed body captured off the wire stays correctly signed
    // forever. The timestamp is inside the signed message precisely so an old
    // capture can be refused, and svix's own libraries refuse beyond five
    // minutes.
    const timestamp = String(nowSeconds() - 6 * 60);
    const sig = await referenceSignature(SVIX_ID, timestamp, RAW_BODY, SECRET);

    await expect(
      verifySumopodSignature(
        { id: SVIX_ID, timestamp, body: RAW_BODY, header: `v1,${sig}` },
        SECRET,
      ),
    ).resolves.toBe(false);
  });

  it('rejects a delivery timestamped far in the future', async () => {
    const timestamp = String(nowSeconds() + 6 * 60);
    const sig = await referenceSignature(SVIX_ID, timestamp, RAW_BODY, SECRET);

    await expect(
      verifySumopodSignature(
        { id: SVIX_ID, timestamp, body: RAW_BODY, header: `v1,${sig}` },
        SECRET,
      ),
    ).resolves.toBe(false);
  });

  it('accepts a delivery inside the replay window', async () => {
    const timestamp = String(nowSeconds() - 60);
    const sig = await referenceSignature(SVIX_ID, timestamp, RAW_BODY, SECRET);

    await expect(
      verifySumopodSignature(
        { id: SVIX_ID, timestamp, body: RAW_BODY, header: `v1,${sig}` },
        SECRET,
      ),
    ).resolves.toBe(true);
  });

  it('rejects a non-numeric timestamp rather than treating it as fresh', async () => {
    const sig = await referenceSignature(SVIX_ID, 'not-a-number', RAW_BODY, SECRET);

    await expect(
      verifySumopodSignature(
        { id: SVIX_ID, timestamp: 'not-a-number', body: RAW_BODY, header: `v1,${sig}` },
        SECRET,
      ),
    ).resolves.toBe(false);
  });
});
