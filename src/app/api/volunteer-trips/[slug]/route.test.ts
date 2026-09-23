import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { PATCH } from './route';

const mockFindUnique = prisma.volunteerTrip.findUnique as unknown as Mock;
const mockUpdate = prisma.volunteerTrip.update as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

function patchRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/volunteer-trips/some-slug', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function routeContext(slug = 'some-slug') {
  return { params: Promise.resolve({ slug }) };
}

describe('PATCH /api/volunteer-trips/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'owner-1', role: 'CAMPAIGN_CREATOR' } });
    mockFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'owner-1', status: 'DRAFT' });
    mockUpdate.mockResolvedValue({ id: 'trip-1', status: 'DRAFT', title: 'Updated title' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await PATCH(patchRequest({ title: 'x' }), routeContext());
    expect(response.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 for a nonexistent slug', async () => {
    mockFindUnique.mockResolvedValue(null);
    const response = await PATCH(patchRequest({ title: 'x' }), routeContext());
    expect(response.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-owning Fundraiser', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'someone-else', role: 'CAMPAIGN_CREATOR' } });
    const response = await PATCH(patchRequest({ title: 'x' }), routeContext());
    expect(response.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('allows an ADMIN to edit a Trip they do not own', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    const response = await PATCH(patchRequest({ title: 'Updated title' }), routeContext());
    expect(response.status).toBe(200);
  });

  it('allows the owning Fundraiser to edit fields while DRAFT', async () => {
    const response = await PATCH(patchRequest({ title: 'Updated title' }), routeContext());
    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: 'Updated title' }) }),
    );
  });

  it('allows editing while REJECTED', async () => {
    mockFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'owner-1', status: 'REJECTED' });
    const response = await PATCH(patchRequest({ title: 'Updated title' }), routeContext());
    expect(response.status).toBe(200);
  });

  it('returns 400 when editing fields on an ACTIVE Trip', async () => {
    mockFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'owner-1', status: 'ACTIVE' });
    const response = await PATCH(patchRequest({ title: 'Updated title' }), routeContext());
    expect(response.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('submits a DRAFT Trip: action "submit" sets status to SUBMITTED', async () => {
    const response = await PATCH(patchRequest({ action: 'submit' }), routeContext());
    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUBMITTED' }) }),
    );
  });

  it('ignores a client-supplied status field entirely -- cannot be used to jump straight to ACTIVE', async () => {
    const response = await PATCH(patchRequest({ title: 'x', status: 'ACTIVE' }), routeContext());
    expect(response.status).toBe(200);
    const updateCall = mockUpdate.mock.calls[0][0];
    expect(updateCall.data.status).toBeUndefined();
  });

  it('returns 400 for an unknown action value', async () => {
    const response = await PATCH(patchRequest({ action: 'publish' }), routeContext());
    expect(response.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
