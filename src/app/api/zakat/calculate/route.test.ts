import { describe, it, expect, vi } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';

function createRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/zakat/calculate', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/zakat/calculate', () => {
  it('should calculate zakat correctly when assets exceed nisab', async () => {
    const request = createRequest({ assets: 100_000_000 });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.netAssets).toBe(100_000_000);
    expect(data.isAboveNisab).toBe(true);
    expect(data.zakatAmount).toBe(Math.round((100_000_000 - 85_000_000) * 0.025));
    expect(data.nisabThreshold).toBe(85_000_000);
  });

  it('should return 0 zakat when assets are below nisab', async () => {
    const request = createRequest({ assets: 50_000_000 });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.zakatAmount).toBe(0);
    expect(data.isAboveNisab).toBe(false);
  });

  it('should subtract debts from assets', async () => {
    const request = createRequest({ assets: 100_000_000, debts: 20_000_000 });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.netAssets).toBe(80_000_000);
    expect(data.isAboveNisab).toBe(false);
    expect(data.zakatAmount).toBe(0);
  });

  it('should use custom nisab when provided', async () => {
    const request = createRequest({ assets: 100_000_000, nisab: 50_000_000 });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.nisabThreshold).toBe(50_000_000);
    expect(data.zakatAmount).toBe(Math.round((100_000_000 - 50_000_000) * 0.025));
  });

  it('should return 400 for invalid body', async () => {
    const request = createRequest({ assets: -100 });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Validasi gagal');
    expect(data.fieldErrors).toBeDefined();
  });

  it('should return 400 when assets is missing', async () => {
    const request = createRequest({});
    const response = await POST(request);

    expect(response.status).toBe(400);
  });
});
