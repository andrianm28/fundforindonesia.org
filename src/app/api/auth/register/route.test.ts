import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

// Mock bcryptjs
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$2a$12$hashedpassword'),
  },
}));

import { prisma } from '@/lib/prisma';

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

  it('should return 409 when email already exists', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'existing-user',
      email: 'test@example.com',
      name: 'Existing',
      password: 'hashed',
      avatar: null,
      phone: null,
      isVerified: false,
      verificationType: null,
      role: 'DONOR',
      donationBalance: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const req = createRequest({ name: 'Test', email: 'test@example.com', password: '12345678' });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.message).toBe('Email sudah terdaftar');
  });

  it('should return 201 on successful registration', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: 'new-user-id',
      email: 'new@example.com',
      name: 'New User',
      password: '$2a$12$hashedpassword',
      avatar: null,
      phone: null,
      isVerified: false,
      verificationType: null,
      role: 'DONOR',
      donationBalance: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const req = createRequest({ name: 'New User', email: 'new@example.com', password: '12345678' });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.message).toBe('Registrasi berhasil');
    expect(body.user.email).toBe('new@example.com');
    expect(body.user.name).toBe('New User');
  });

  it('should hash the password before storing', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: 'new-user-id',
      email: 'new@example.com',
      name: 'New User',
      password: '$2a$12$hashedpassword',
      avatar: null,
      phone: null,
      isVerified: false,
      verificationType: null,
      role: 'DONOR',
      donationBalance: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const req = createRequest({ name: 'New User', email: 'new@example.com', password: 'mypassword' });
    await POST(req);

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        name: 'New User',
        email: 'new@example.com',
        password: '$2a$12$hashedpassword',
      },
    });
  });
});
