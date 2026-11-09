import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitToVerifier, TRUTH_STATEMENT_REQUIRED } from './verification-submission';

const fetchMock = vi.fn();

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('submitToVerifier (PKS pasal 3.3)', () => {
  it('sends the ticked truth statement as JSON, and resolves to null when the server accepts', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response('{}', { status: 201 }));

    expect(await submitToVerifier('sumur-desa', true)).toBeNull();

    expect(fetchMock).toHaveBeenCalledWith('/api/campaigns/sumur-desa/verification-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ truthStatement: true }),
    });
  });

  it('refuses without asking the server when the statement is not ticked', async () => {
    vi.stubGlobal('fetch', fetchMock);

    expect(await submitToVerifier('sumur-desa', false)).toBe(TRUTH_STATEMENT_REQUIRED);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the server's refusal through", async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Campaign ini ditolak secara final.' }), { status: 409 }));

    expect(await submitToVerifier('sumur-desa', true)).toBe('Campaign ini ditolak secara final.');
  });
});
