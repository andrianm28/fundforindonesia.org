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
      url: 'https://fundforindonesia.org/campaign/test',
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
      name: 'Fund for Indonesia',
    };

    const { container } = render(<StructuredData data={data} />);
    const script = container.querySelector('script[type="application/ld+json"]');
    const parsed = JSON.parse(script!.innerHTML);

    expect(parsed['@context']).toBe('https://schema.org');
    expect(parsed['@type']).toBe('Organization');
  });

  it('cannot be closed early by a value containing </script>, so a Campaign title cannot inject markup', () => {
    const data = { name: '</script><script>window.__pwned = 1</script>', note: 'a & b <c> \u2028' };

    const { container } = render(<StructuredData data={data} />);
    const scripts = container.querySelectorAll('script');

    expect(scripts).toHaveLength(1);
    expect(scripts[0].innerHTML).not.toMatch(/<\/?script/i);
    expect(JSON.parse(scripts[0].innerHTML)).toEqual(data);
  });
});
