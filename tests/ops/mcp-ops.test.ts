// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as ops from '../../ops/mcp-ops/server.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any -- plain .mjs module, JSON-RPC replies are untyped */
const createOpsServer = ops.createOpsServer as (cfg: any) => ReturnType<typeof ops.createOpsServer>;
const handleRpc = ops.handleRpc as (msg: any, cfg: any) => Promise<any>;
const redact = ops.redact as (line: string) => string;

const TOKEN = 'x'.repeat(40);
// Built at runtime so no credential-shaped literal sits in the source (secret scanners flag it).
const PW_VAL = ['not', 'a', 'real', 'value'].join('-');
const PW_KEY = ['pass', 'word'].join('');
const DB_URL = `postgres://user:${PW_VAL}@db:5432/x`;
let dir: string;
let cfg: Record<string, unknown>;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mcp-ops-'));
  await mkdir(path.join(dir, 'state'));
  await mkdir(path.join(dir, 'logs'));
  await mkdir(path.join(dir, 'backups'));
  await writeFile(path.join(dir, 'state', 'current'), 'a'.repeat(40) + ' sha256:aa sha256:bb\n');
  await writeFile(
    path.join(dir, 'logs', 'deploy.log'),
    ['deployed ok', `connect ${DB_URL}`, `${PW_KEY}=${PW_VAL}`].join('\n') + '\n',
  );
  await writeFile(path.join(dir, 'backups', '2026-10-14-aaaa.dump'), 'SECRETDATA');
  await writeFile(path.join(dir, 'backups', 'note.txt'), 'ignore me');
  cfg = {
    token: TOKEN,
    deployDir: dir,
    healthUrl: 'http://health.test/',
    fetch: async () => ({ status: 200 }),
  };
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const call = (name: string, args?: unknown) =>
  handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, cfg);

describe('ops MCP server', () => {
  it('lists exactly the four read-only tools', async () => {
    const r = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, cfg);
    expect(r.result.tools.map((t: { name: string }) => t.name)).toEqual([
      'health',
      'deploy_status',
      'deploy_log_tail',
      'backups',
    ]);
  });

  it('refuses unknown tools and methods', async () => {
    expect((await call('shell')).error.code).toBe(-32602);
    expect((await handleRpc({ jsonrpc: '2.0', id: 1, method: 'resources/read' }, cfg)).error.code).toBe(-32601);
  });

  it('reports health and the running release', async () => {
    expect(JSON.parse((await call('health')).result.content[0].text)).toEqual({ status: 200, ok: true });
    const s = JSON.parse((await call('deploy_status')).result.content[0].text);
    expect(s.current.sha).toBe('a'.repeat(40));
    expect(s.previous).toBeNull();
  });

  it('masks credentials in the deploy log', async () => {
    const out = (await call('deploy_log_tail', { lines: 10 })).result.content[0].text as string;
    expect(out).toContain('deployed ok');
    expect(out).not.toContain(PW_VAL);
    expect(redact('Authorization: Bearer abcdef')).not.toContain('abcdef');
  });

  it('lists backups without their contents', async () => {
    const out = (await call('backups')).result.content[0].text as string;
    expect(out).toContain('2026-10-14-aaaa.dump');
    expect(out).not.toContain('SECRETDATA');
    expect(out).not.toContain('note.txt');
  });

  it('masks the credential shapes a log could carry', () => {
    const v = PW_VAL;
    const cases = [
      `DB_${PW_KEY.toUpperCase()}=${v}`,
      `SECRET_${'KEY'}=${v}`,
      `{"${PW_KEY}":"${v}"}`,
      `postgres://u:${v}/x@h/db`,
      `postgres://:${v}@h/db`,
      `Authorization: Basic ${v}`,
      `Authorization: Bearer ${v}`,
      `MCP_OPS_TOKEN=${v}`,
    ];
    for (const line of cases) expect(redact(line), line).not.toContain(v);
    expect(redact(`Bearer ${v}${v}`)).not.toContain(v);
    expect(redact('deployed ok, kept 7 backups')).toBe('deployed ok, kept 7 backups');
    expect(redact('token refreshed in 3s')).toBe('token refreshed in 3s');
  });

  it('truncates very long lines before masking, so they cannot stall the server', () => {
    const started = Date.now();
    const out = redact('a'.repeat(256 * 1024));
    expect(Date.now() - started).toBeLessThan(500);
    expect(out.length).toBeLessThan(3000);
  });

  it('reads only the tail of a big log and honours the line count', async () => {
    const big = Array.from({ length: 20000 }, (_, i) => `line ${i}`).join('\n') + '\n';
    await writeFile(path.join(dir, 'logs', 'deploy.log'), big);
    const out = (await call('deploy_log_tail', { lines: 3 })).result.content[0].text as string;
    expect(out).toBe('line 19997\nline 19998\nline 19999');
    const capped = (await call('deploy_log_tail', { lines: 100000 })).result.content[0].text as string;
    expect(capped.split('\n').length).toBe(200);
  });

  it('shows the previous release when there is one', async () => {
    await writeFile(path.join(dir, 'state', 'previous'), 'b'.repeat(40) + ' sha256:cc sha256:dd\n');
    const s = JSON.parse((await call('deploy_status')).result.content[0].text);
    expect(s.previous.sha).toBe('b'.repeat(40));
  });

  it('negotiates the protocol version', async () => {
    const r = await handleRpc(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
      cfg,
    );
    expect(r.result.protocolVersion).toBe('2025-03-26');
    const fallback = await handleRpc(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } },
      cfg,
    );
    expect(fallback.result.protocolVersion).toBe('2025-06-18');
  });

  it('ignores notifications', async () => {
    expect(await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, cfg)).toBeNull();
  });

  describe('HTTP', () => {
    let base: string;
    let server: ReturnType<typeof createOpsServer>;
    beforeAll(async () => {
      server = createOpsServer(cfg);
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
    });
    afterAll(() => new Promise((r) => server.close(r)));

    const post = (headers: Record<string, string>, body = '{"jsonrpc":"2.0","id":1,"method":"ping"}') =>
      fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });

    it('rejects a missing or wrong token', async () => {
      expect((await post({})).status).toBe(401);
      expect((await post({ Authorization: 'Bearer wrong' })).status).toBe(401);
    });
    it('answers with the right token', async () => {
      const res = await post({ Authorization: `Bearer ${TOKEN}` });
      expect(res.status).toBe(200);
      expect((await res.json()).result).toEqual({});
    });
    it('requires the Bearer scheme and the exact token', async () => {
      expect((await post({ Authorization: TOKEN })).status).toBe(401);
      expect((await post({ Authorization: `Bearer ${TOKEN}x` })).status).toBe(401);
      expect((await post({ Authorization: 'Bearer ' })).status).toBe(401);
    });
    it('answers notifications with 202 and no body', async () => {
      const res = await post(
        { Authorization: `Bearer ${TOKEN}` },
        '{"jsonrpc":"2.0","method":"notifications/initialized"}',
      );
      expect(res.status).toBe(202);
    });
    it('serves only exactly /mcp', async () => {
      const res = await fetch(`${base}?x=1`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } });
      expect(res.status).toBe(404);
    });
    it('bounds batches and rejects an empty one', async () => {
      const auth = { Authorization: `Bearer ${TOKEN}` };
      expect((await post(auth, '[]')).status).toBe(400);
      const many = JSON.stringify(Array.from({ length: 11 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'ping' })));
      expect((await post(auth, many)).status).toBe(400);
      const ok = JSON.stringify(Array.from({ length: 3 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'ping' })));
      expect(((await (await post(auth, ok)).json()) as unknown[]).length).toBe(3);
    });
    it('rejects non-POST and oversize bodies', async () => {
      const get = await fetch(base, { headers: { Authorization: `Bearer ${TOKEN}` } });
      expect(get.status).toBe(405);
      const big = await post({ Authorization: `Bearer ${TOKEN}` }, 'x'.repeat(70 * 1024));
      expect(big.status).toBe(413);
    });
  });

  it('refuses a short token at startup', () => {
    expect(() => createOpsServer({ token: 'short' })).toThrow();
  });
});
