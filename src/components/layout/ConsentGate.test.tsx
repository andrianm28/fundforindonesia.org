import { render, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ user: { id: 'u1' } as { id: string } | null, pathname: '/explore', replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: state.user ? { user: state.user } : null }),
}));

import { ConsentGate, clearConsentCache } from './ConsentGate';
import { LEGAL_DOCS_VERSION } from '@/lib/site-identity';

const KEY_U1 = `consent-ok:${LEGAL_DOCS_VERSION}:u1`;

function answer(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, json: async () => body });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  window.sessionStorage.clear();
  state.user = { id: 'u1' };
  state.pathname = '/explore';
  state.replace.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ConsentGate (Google first sign-in, PKS 3.1)', () => {
  it('sends a person with a missing acceptance to the consent page', async () => {
    answer({ pending: true });
    render(<ConsentGate />);
    await waitFor(() => expect(state.replace).toHaveBeenCalledWith('/akun/persetujuan'));
  });

  it('leaves a person who has accepted where they are', async () => {
    const fetchMock = answer({ pending: false });
    render(<ConsentGate />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(state.replace).not.toHaveBeenCalled();
  });

  it('does not ask on the consent page or the documents, nor when signed out', async () => {
    const fetchMock = answer({ pending: true });
    for (const path of ['/akun/persetujuan', '/terms', '/privacy']) {
      state.pathname = path;
      render(<ConsentGate />);
      cleanup();
    }
    state.user = null;
    state.pathname = '/explore';
    render(<ConsentGate />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets the person through when the check fails', async () => {
    const fetchMock = answer({ error: 'x' }, false);
    render(<ConsentGate />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(state.replace).not.toHaveBeenCalled();
  });

  it('fails open on a network error and asks again next time', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<ConsentGate />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(state.replace).not.toHaveBeenCalled();
    state.pathname = '/campaigns';
    rerender(<ConsentGate />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('asks once per session: later navigations reuse the accepted answer', async () => {
    const fetchMock = answer({ pending: false });
    const { rerender } = render(<ConsentGate />);
    await waitFor(() => expect(window.sessionStorage.getItem(KEY_U1)).toBe('1'));
    for (const path of ['/campaigns', '/akun', '/explore']) {
      state.pathname = path;
      rerender(<ConsentGate />);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads the answer from sessionStorage for that user id, and not for another', async () => {
    window.sessionStorage.setItem(KEY_U1, '1');
    const fetchMock = answer({ pending: false });
    render(<ConsentGate />);
    expect(fetchMock).not.toHaveBeenCalled();
    cleanup();
    state.user = { id: 'u2' };
    render(<ConsentGate />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it('does not remember a pending answer, and asks again once the cache is cleared', async () => {
    const fetchMock = answer({ pending: true });
    render(<ConsentGate />);
    await waitFor(() => expect(state.replace).toHaveBeenCalled());
    expect(window.sessionStorage.getItem(KEY_U1)).toBeNull();

    window.sessionStorage.setItem(KEY_U1, '1');
    clearConsentCache();
    expect(window.sessionStorage.getItem(KEY_U1)).toBeNull();
    cleanup();
    render(<ConsentGate />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('does not trust an acceptance remembered for an older document version', async () => {
    window.sessionStorage.setItem('consent-ok:2000-01-01:u1', '1');
    window.sessionStorage.setItem('consent-ok:u1', '1');
    const fetchMock = answer({ pending: true });
    render(<ConsentGate />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(state.replace).toHaveBeenCalled());
  });
});
