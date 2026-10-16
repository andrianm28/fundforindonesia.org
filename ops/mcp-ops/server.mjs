// Read-only ops MCP server for the production host (no dependencies, Node 24).
//
// Four tools, each a fixed read: app health, the release now running, the tail
// of the deploy log, and the list of database backups (names and sizes only).
// No shell, no database, no .env, no docker, no write of any kind. Runbook:
// docs/runbooks/mcp-ops.md.
//
// Transport: MCP "streamable HTTP", stateless, JSON replies only (POST /mcp).
// Bind it to 127.0.0.1 and put nginx with TLS in front of it. Every request
// needs `Authorization: Bearer <MCP_OPS_TOKEN>`.

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { open, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY_BYTES = 64 * 1024;
const MAX_BATCH = 10;
const MAX_LOG_LINES = 200;
const LOG_TAIL_BYTES = 256 * 1024;

const TOOLS = [
  {
    name: 'health',
    description: 'GET the app health endpoint on the host. Returns the HTTP status only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'deploy_status',
    description: 'The release now running and the one before it (commit SHA and image digests).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'deploy_log_tail',
    description: `The last N lines of the deploy log (default 50, max ${MAX_LOG_LINES}). Secrets are masked.`,
    inputSchema: {
      type: 'object',
      properties: { lines: { type: 'integer', minimum: 1, maximum: MAX_LOG_LINES } },
      additionalProperties: false,
    },
  },
  {
    name: 'backups',
    description: 'File names, sizes and times of the database backups. Never their contents.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

// Masks what must never leave the host even if a log line contains it. Best
// effort: it knows URL credentials, `key=value` / `"key":"value"` pairs whose
// key contains a sensitive word, and Bearer/Basic values. Anything else that
// reaches deploy.log in the clear is not masked, so deploy.sh must never print it.
const SENSITIVE = '(?:bearer|token|secret|password|passwd|pwd|key|authorization|credential)';
const PAIR = new RegExp(
  `([a-z0-9_.-]*${SENSITIVE}[a-z0-9_.-]*)(["']?\\s*[=:]\\s*["']?|\\s+)(?:(?:bearer|basic)\\s+)?[^\\s"',;}]+`,
  'gi',
);
export function redact(line) {
  return line.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s@]*@/gi, '$1***@').replace(PAIR, '$1$2***');
}

const text = (s) => ({ content: [{ type: 'text', text: s }] });
const toolError = (s) => ({ isError: true, content: [{ type: 'text', text: s }] });

async function readState(deployDir, name) {
  try {
    const raw = (await readFile(path.join(deployDir, 'state', name), 'utf8')).trim();
    const [sha, app, migrate] = raw.split(/\s+/);
    return { sha, appDigest: app, migrateDigest: migrate };
  } catch {
    return null;
  }
}

export async function callTool(name, args, cfg) {
  const fetchImpl = cfg.fetch ?? fetch;
  switch (name) {
    case 'health': {
      try {
        const res = await fetchImpl(cfg.healthUrl, { signal: AbortSignal.timeout(5000) });
        return text(JSON.stringify({ status: res.status, ok: res.status === 200 }));
      } catch {
        return text(JSON.stringify({ status: null, ok: false, error: 'no answer' }));
      }
    }
    case 'deploy_status': {
      const [current, previous] = await Promise.all([
        readState(cfg.deployDir, 'current'),
        readState(cfg.deployDir, 'previous'),
      ]);
      return text(JSON.stringify({ current, previous }));
    }
    case 'deploy_log_tail': {
      const n = Number.isInteger(args?.lines) ? Math.min(Math.max(args.lines, 1), MAX_LOG_LINES) : 50;
      try {
        const fh = await open(path.join(cfg.deployDir, 'logs', 'deploy.log'), 'r');
        let tail;
        try {
          const { size } = await fh.stat();
          const start = Math.max(0, size - LOG_TAIL_BYTES);
          const buf = Buffer.alloc(size - start);
          await fh.read(buf, 0, buf.length, start);
          tail = buf.toString('utf8');
        } finally {
          await fh.close();
        }
        const lines = tail.split('\n').filter(Boolean).slice(-n).map(redact);
        return text(lines.join('\n') || '(log is empty)');
      } catch {
        return toolError('deploy log not readable');
      }
    }
    case 'backups': {
      try {
        const dir = path.join(cfg.deployDir, 'backups');
        const names = (await readdir(dir)).filter((f) => f.endsWith('.dump')).sort();
        const rows = await Promise.all(
          names.map(async (f) => {
            const s = await stat(path.join(dir, f));
            return { name: f, bytes: s.size, modified: s.mtime.toISOString() };
          }),
        );
        return text(JSON.stringify(rows));
      } catch {
        return toolError('backups directory not readable');
      }
    }
    default:
      return null;
  }
}

// One JSON-RPC message in, one response out (null for notifications).
export async function handleRpc(msg, cfg) {
  const id = msg?.id;
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'Invalid request');
  if (id === undefined) return null; // notification, e.g. notifications/initialized

  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      return reply({
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'ffi-ops-readonly', version: '1.0.0' },
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call': {
      const result = await callTool(msg.params?.name, msg.params?.arguments, cfg);
      return result ? reply(result) : fail(-32602, 'Unknown tool');
    }
    default:
      return fail(-32601, 'Method not found');
  }
}

function tokenOk(header, token) {
  const m = /^Bearer (.+)$/i.exec(String(header ?? ''));
  if (!m) return false;
  const given = Buffer.from(m[1]);
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

export function createOpsServer(cfg) {
  if (!cfg.token || cfg.token.length < 32) throw new Error('MCP_OPS_TOKEN must be at least 32 characters');
  return createServer(async (req, res) => {
    const send = (code, body, headers = {}) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    if (req.url !== '/mcp') return send(404, { error: 'not found' });
    if (!tokenOk(req.headers.authorization, cfg.token)) {
      return send(401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
    }
    if (req.method !== 'POST') return send(405, { error: 'method not allowed' }, { Allow: 'POST' });

    let size = 0;
    const chunks = [];
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) return send(413, { error: 'too large' });
        chunks.push(chunk);
      }
    } catch {
      return; // client went away mid-body
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    if (Array.isArray(body)) {
      if (body.length === 0 || body.length > MAX_BATCH) {
        return send(400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } });
      }
      const out = (await Promise.all(body.map((m) => handleRpc(m, cfg)))).filter(Boolean);
      return out.length ? send(200, out) : send(202);
    }
    const out = await handleRpc(body, cfg);
    return out ? send(200, out) : send(202);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cfg = {
    token: process.env.MCP_OPS_TOKEN ?? '',
    deployDir: process.env.DEPLOY_DIR ?? '',
    healthUrl: process.env.HEALTH_URL ?? 'http://127.0.0.1:8093/api/health',
  };
  if (!cfg.deployDir) throw new Error('DEPLOY_DIR is required');
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 8787);
  createOpsServer(cfg).listen(port, host, () => console.log(`ffi-ops-readonly on ${host}:${port}`));
}
