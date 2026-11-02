import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      // The duplicate check goes through the lookup HMAC, so it is a findFirst
      // and not a findUnique on a unique field (ADR 0012).
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

// Registration must never hash a password any more; mocked to prove it is not called.
vi.mock('@/lib/password-hash', () => ({
  hashPassword: vi.fn().mockResolvedValue('$2a$12$hashedpassword'),
}));

import { prisma } from '@/lib/prisma';
import { sealUserEmail } from '@/lib/contact-fields';

function createRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 when name is missing', async () => {
    const req = createRequest({ email: 'test@example.com', password: '12345678' });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.errors.name).toBeDefined();
  });

  it('should return 400 when email format is invalid', async () => {
    const req = createRequest({ name: 'Test', email: 'invalid-email', password: '12345678' });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.errors.email).toBe('Format email tidak valid');
  });

  it('should return 409 when email already exists', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'existing-user' } as never);

    const req = createRequest({ name: 'Test', email: 'test@example.com', password: '12345678' });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.message).toBe('Email sudah terdaftar');
  });

  it('should return 201 on successful registration', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: 'new-user-id',
      name: 'New User',
      ...sealUserEmail('new@example.com'),
    } as never);

    const req = createRequest({ name: 'New User', email: 'new@example.com', password: '12345678' });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.message).toBe('Registrasi berhasil');
    expect(body.user.email).toBe('new@example.com');
    expect(body.user.name).toBe('New User');
  });

  // The contract step of ADR 0012: the plaintext column is gone, so the address
  // is sealed on the way in and the response gets it back by decrypting.
  it('stores the email only as its protected columns, and answers with the address the Donor gave', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: 'new-user-id',
      name: 'New User',
      ...sealUserEmail('New@Example.com'),
    } as never);

    const res = await POST(
      createRequest({ name: 'New User', email: 'New@Example.com', password: '12345678' }),
    );
    const body = await res.json();

    const written = vi.mocked(prisma.user.create).mock.calls[0][0].data as Record<string, unknown>;
    expect(written).not.toHaveProperty('email');
    expect(written.emailHmac).toBeDefined();
    expect(body.user.email).toBe('New@Example.com');
  });

  it('looks the address up by its HMAC, so a duplicate is found however it was typed', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'existing' } as never);

    await POST(createRequest({ name: 'Test', email: 'TEST@Example.com', password: '12345678' }));

    // A 64-hex HMAC and never the address itself, which is what closes the
    // case-sensitivity gap the old case-sensitive `email @unique` had.
    const where = vi.mocked(prisma.user.findFirst).mock.calls[0]![0]!.where as { OR: Record<string, unknown>[] };
    expect(Object.keys(where)).toEqual(['OR']);
    expect(Object.keys(where.OR[0]!).sort()).toEqual(['emailHmac', 'emailHmacKeyId']);
    expect(where.OR[0]!.emailHmac).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a duplicate whose stored address was hashed under a retired HMAC key', async () => {
    const saved = { ...process.env };
    try {
      const old = sealUserEmail('dup@example.com');
      process.env.FIELD_HMAC_PREVIOUS_KEYS = `${process.env.FIELD_HMAC_KEY_ID}:${process.env.FIELD_HMAC_KEY}`;
      process.env.FIELD_HMAC_KEY = Buffer.alloc(32, 9).toString('base64');
      process.env.FIELD_HMAC_KEY_ID = 'hmac-test-2';
      // Like the database: a row matches when any OR branch equals its stored pair.
      vi.mocked(prisma.user.findFirst).mockImplementation((async ({ where }: { where: { OR: Record<string, string>[] } }) =>
        where.OR.some((p) => p.emailHmac === old.emailHmac && p.emailHmacKeyId === old.emailHmacKeyId)
          ? { id: 'existing' }
          : null) as never);

      const response = await POST(createRequest({ name: 'Test', email: 'DUP@example.com', password: '12345678' }));

      expect(response.status).toBe(409);
      expect(prisma.user.create).not.toHaveBeenCalled();
    } finally {
      process.env = saved;
    }
  });

  // Sign-in is by mailed code now, so an account needs no password; the
  // address is proven by the first code typed back (src/lib/login-code.ts).
  it('creates an account without a password and hashes nothing', async () => {
    const { hashPassword } = await import('@/lib/password-hash');
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: 'new-user-id',
      name: 'New User',
      ...sealUserEmail('new@example.com'),
    } as never);

    const res = await POST(createRequest({ name: 'New User', email: 'new@example.com' }));

    expect(res.status).toBe(201);
    expect(hashPassword).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.user.create).mock.calls[0][0].data.password).toBeNull();
  });

  // A password typed at registration was typed by whoever typed the address,
  // who may not own it (pre-registration takeover, ADR 0026), so none is
  // accepted: the account is entered only through a code mailed to it.
  it('ignores a password sent at registration and stores none', async () => {
    const { hashPassword } = await import('@/lib/password-hash');
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: 'new-user-id',
      name: 'New User',
      ...sealUserEmail('new@example.com'),
    } as never);

    const res = await POST(createRequest({ name: 'New User', email: 'new@example.com', password: 'attacker-chosen' }));

    expect(res.status).toBe(201);
    expect(hashPassword).not.toHaveBeenCalled();
    const { data } = vi.mocked(prisma.user.create).mock.calls[0][0];
    expect(data.password).toBeNull();
    // Sealed, not stored in the clear (ADR 0012).
    expect(data).not.toHaveProperty('email');
    expect(data.emailHmac).toBeDefined();
  });
});
