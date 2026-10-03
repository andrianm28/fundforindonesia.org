/**
 * Who is calling a public endpoint, as far as the rate limit (csr-06b) needs.
 *
 * Deployment assumption (docs: docker-compose.prod.yml binds the app to
 * 127.0.0.1:8093, so a reverse proxy on the host is the only way in; its
 * config is not in this repo and is the owner's to confirm): that proxy is
 * nginx with `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`,
 * which APPENDS the address it saw to whatever the client sent. So the front
 * of the header is client-controlled and spoofable, and the entry to trust is
 * the one the proxy added: the last, or the (hops)th from the end when more
 * than one trusted proxy sits in the chain (TRUSTED_PROXY_HOPS, default 1).
 * If the proxy overwrote the header instead, the last entry is still right.
 *
 * Without the header the caller shares one 'unknown' bucket: bounded, never
 * unbounded. This module is server-only; client code must not import it.
 */
export function clientAddress(headers: Headers): string {
  const raw = headers.get('x-forwarded-for');
  if (!raw) return 'unknown';
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  if (parts.length === 0) return 'unknown';
  const hops = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? '1', 10);
  const fromEnd = Number.isInteger(hops) && hops >= 1 ? hops : 1;
  const chosen = parts[Math.max(0, parts.length - fromEnd)];
  return normaliseAddress(chosen.slice(0, 64));
}

/**
 * The key an address is counted under. An IPv4-mapped IPv6 address
 * (::ffff:a.b.c.d) is the same host as a.b.c.d. A native IPv6 client is
 * counted by its /64: one subscriber is typically handed a whole /64, so
 * counting full addresses would let it dodge the limit by rotating the host
 * part. Anything not recognisably an address is returned unchanged.
 */
function normaliseAddress(address: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped) return mapped[1];
  if (!address.includes(':')) return address;
  const groups = expandIpv6(address);
  if (!groups) return address;
  return `${groups.slice(0, 4).join(':')}::/64`;
}

/** Eight lowercase hextets without leading zeros, or null if `address` is not IPv6. */
function expandIpv6(address: string): string[] | null {
  const bare = address.split('%')[0].toLowerCase();
  const halves = bare.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' ? [] : halves[0].split(':');
  const tail = halves.length === 2 && halves[1] !== '' ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (all.length !== 8 || !all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => g.replace(/^0+(?=.)/, ''));
}
