import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Page, { metadata } from './page';

describe('/wakaf landing', () => {
  it('has a heading, a status box and a next step', () => {
    render(<Page />);

    expect(screen.getByRole('heading', { level: 1, name: 'Wakaf' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Status' })).toHaveTextContent('Status saat ini');
    expect(screen.getAllByRole('link')[0]).toHaveAttribute('href', '/contact');
  });

  it('has SEO metadata', () => {
    expect(String(metadata.title)).toContain('Wakaf');
    expect(metadata.description).toBeTruthy();
  });
});
