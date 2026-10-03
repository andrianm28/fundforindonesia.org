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

// Mock the hashing wrapper (real cost/compat is covered in password-hash.test.ts)
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

  it('should return 400 when password is too short', async () => {
    const req = createRequest({ name: 'Test', email: 'test@example.com', password: '1234' });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.errors.password).toBe('Password minimal 8 karakter');
  });

  it('rejects a password over 72 bytes (bcrypt would ignore the tail) and accepts exactly 72', async () => {
    const over = await POST(createRequest({ name: 'Test', email: 'test@example.com', password: 'a'.repeat(73) }));
    expect(over.status).toBe(400);
    expect((await over.json()).errors.password).toBe('Password maksimal 72 byte');

    // 37 two-byte characters = 74 bytes but only 37 characters: bytes, not length, are limited.
    const multibyte = await POST(createRequest({ name: 'Test', email: 'test@example.com', password: 'é'.repeat(37) }));
    expect(multibyte.status).toBe(400);

    const edge = await POST(createRequest({ name: 'Test', email: 'test@example.com', password: 'a'.repeat(72) }));
    expect(edge.status).not.toBe(400);
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
    const where = vi.mocked(prisma.user.findFirst).mock.calls[0]![0]!.where as Record<string, unknown>;
    expect(Object.keys(where).sort()).toEqual(['emailHmac', 'emailHmacKeyId']);
    expect(where.emailHmac).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should hash the password before storing', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: 'new-user-id',
      name: 'New User',
      ...sealUserEmail('new@example.com'),
    } as never);

    const req = createRequest({ name: 'New User', email: 'new@example.com', password: 'mypassword' });
    await POST(req);

    const { data } = vi.mocked(prisma.user.create).mock.calls[0][0];
    expect(data).toMatchObject({ name: 'New User', password: '$2a$12$hashedpassword' });
    // Sealed, not stored in the clear (ADR 0012).
    expect(data).not.toHaveProperty('email');
    expect(data.emailHmac).toBeDefined();
  });
});
