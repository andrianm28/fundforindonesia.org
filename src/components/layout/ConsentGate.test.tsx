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

import { ConsentGate } from './ConsentGate';

function answer(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, json: async () => body });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
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
});
