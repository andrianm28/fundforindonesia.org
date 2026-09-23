import { describe, it, expect, vi, beforeEach } from 'vitest';
import { releaseExpiredHolds } from './registration';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    registration: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';

const mockFindMany = prisma.registration.findMany as unknown as import('vitest').Mock;
const mockUpdateMany = prisma.registration.updateMany as unknown as import('vitest').Mock;

describe('releaseExpiredHolds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flips expired HOLD registrations to EXPIRED, scoped to the given batch', async () => {
    mockFindMany.mockResolvedValue([{ id: 'reg-1' }, { id: 'reg-2' }]);
    mockUpdateMany.mockResolvedValue({ count: 2 });

    const result = await releaseExpiredHolds('batch-1');

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ batchId: 'batch-1', status: 'HOLD', holdExpiresAt: { lte: expect.any(Date) } }),
      }),
    );
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['reg-1', 'reg-2'] }, status: 'HOLD' }),
        data: { status: 'EXPIRED' },
      }),
    );
    expect(result).toEqual({ expiredCount: 2, consideredCount: 2 });
  });

  it('returns zero counts when nothing is expired', async () => {
    mockFindMany.mockResolvedValue([]);

    const result = await releaseExpiredHolds('batch-1');

    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(result).toEqual({ expiredCount: 0, consideredCount: 0 });
  });

  it('sweeps across all batches when no batchId is given', async () => {
    mockFindMany.mockResolvedValue([]);
    await releaseExpiredHolds();
    const call = mockFindMany.mock.calls[0][0];
    expect(call.where.batchId).toBeUndefined();
  });
});
