import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { Footer } from './Footer';

afterEach(cleanup);

describe('Footer support menu', () => {
  it('links Volunteer to the Volunteer Trip catalog (PRD section 3)', () => {
    render(<Footer />);

    expect(screen.getByRole('link', { name: 'Volunteer' })).toHaveAttribute('href', '/volunteer-trip');
  });
});
