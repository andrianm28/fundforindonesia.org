import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { Footer } from './Footer';

afterEach(cleanup);

describe('Footer', () => {
  it('shows the current year in the copyright line, not a fixed one', () => {
    render(<Footer />);
    expect(screen.getByText(new RegExp(`© ${new Date().getFullYear()} Fund for Indonesia`))).toBeDefined();
  });
});

describe('Footer support menu', () => {
  it('links Volunteer to the Volunteer Trip catalog (PRD section 3)', () => {
    render(<Footer />);

    expect(screen.getByRole('link', { name: 'Volunteer' })).toHaveAttribute('href', '/volunteer-trip');
  });
});

describe('Footer public settings', () => {
  it('shows the Admin-set text and only the social links that are set', () => {
    render(
      <Footer
        footer={{ about: 'Teks dari Admin.' }}
        social={{ instagram: 'https://instagram.com/akun', twitter: '', facebook: '' }}
      />,
    );

    expect(screen.getByText('Teks dari Admin.')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Instagram' })).toHaveAttribute('href', 'https://instagram.com/akun');
    expect(screen.queryByRole('link', { name: 'Twitter' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Facebook' })).toBeNull();
  });
});
