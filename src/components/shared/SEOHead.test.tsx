import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StructuredData } from './SEOHead';

describe('StructuredData', () => {
  it('renders a script tag with JSON-LD content', () => {
    const data = {
      '@context': 'https://schema.org',
      '@type': 'DonateAction',
      name: 'Test Campaign',
      description: 'A test campaign',
      url: 'https://kitabisa.com/campaign/test',
      recipient: {
        '@type': 'Organization',
        name: 'Test Org',
      },
    };

    const { container } = render(<StructuredData data={data} />);
    const script = container.querySelector('script[type="application/ld+json"]');

    expect(script).not.toBeNull();
    expect(JSON.parse(script!.innerHTML)).toEqual(data);
  });

  it('renders valid JSON-LD with correct @context', () => {
    const data = {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Kitabisa',
    };

    const { container } = render(<StructuredData data={data} />);
    const script = container.querySelector('script[type="application/ld+json"]');
    const parsed = JSON.parse(script!.innerHTML);

    expect(parsed['@context']).toBe('https://schema.org');
    expect(parsed['@type']).toBe('Organization');
  });
});
