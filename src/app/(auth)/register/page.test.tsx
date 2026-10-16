import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import RegisterPage from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(cleanup);

describe('RegisterPage consent and claims (audit L3, L7)', () => {
  it('links the Terms and Privacy policy under the form', () => {
    render(<RegisterPage />);
    expect(screen.getByText(/Dengan mendaftar, Anda menyetujui/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Syarat & Ketentuan/ })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: 'Kebijakan Privasi' })).toHaveAttribute('href', '/privacy');
  });

  it('makes no claim about millions of members', () => {
    render(<RegisterPage />);
    expect(document.body.textContent).not.toMatch(/jutaan/);
  });
});
