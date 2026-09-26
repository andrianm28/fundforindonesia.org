import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    prayer: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';

const mockPrayerFindUnique = prisma.prayer.findUnique as unknown as Mock;
const mockPrayerUpdate = prisma.prayer.update as unknown as Mock;

function createRequest(id: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/prayers/${id}/amiin`, {
    method: 'POST',
  });
}

describe('POST /api/prayers/[id]/amiin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should increment amiin count and return 200 with new count', async () => {
    mockPrayerFindUnique.mockResolvedValue({ id: 'prayer-1' });
    mockPrayerUpdate.mockResolvedValue({ id: 'prayer-1', amiinCount: 6 });

    const request = createRequest('prayer-1');
    const response = await POST(request, { params: Promise.resolve({ id: 'prayer-1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.id).toBe('prayer-1');
    expect(data.amiinCount).toBe(6);
  });

  it('should return 404 when prayer is not found', async () => {
    mockPrayerFindUnique.mockResolvedValue(null);

    const request = createRequest('nonexistent');
    const response = await POST(request, { params: Promise.resolve({ id: 'nonexistent' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Doa tidak ditemukan');
  });

  it('should call prisma.prayer.update with increment: 1', async () => {
    mockPrayerFindUnique.mockResolvedValue({ id: 'prayer-1' });
    mockPrayerUpdate.mockResolvedValue({ id: 'prayer-1', amiinCount: 1 });

    const request = createRequest('prayer-1');
    await POST(request, { params: Promise.resolve({ id: 'prayer-1' }) });

    expect(mockPrayerUpdate).toHaveBeenCalledWith({
      where: { id: 'prayer-1' },
      data: { amiinCount: { increment: 1 } },
      select: { id: true, amiinCount: true },
    });
  });

  it('should return 500 when a database error occurs', async () => {
    mockPrayerFindUnique.mockRejectedValue(new Error('DB error'));

    const request = createRequest('prayer-1');
    const response = await POST(request, { params: Promise.resolve({ id: 'prayer-1' }) });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Gagal menambahkan amiin');
  });

  it('should not call update when prayer does not exist', async () => {
    mockPrayerFindUnique.mockResolvedValue(null);

    const request = createRequest('nonexistent');
    await POST(request, { params: Promise.resolve({ id: 'nonexistent' }) });

    expect(mockPrayerUpdate).not.toHaveBeenCalled();
  });
});
