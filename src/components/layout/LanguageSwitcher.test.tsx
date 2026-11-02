import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { messages } from '@/i18n/messages';

const mockPathname = vi.hoisted(() => ({ value: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname.value }));

import { LanguageSwitcher } from './LanguageSwitcher';

afterEach(cleanup);

function renderAt(pathname: string, locale: 'id' | 'en') {
  mockPathname.value = pathname;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      <LanguageSwitcher />
    </NextIntlClientProvider>,
  );
}

describe('LanguageSwitcher', () => {
  it('on an Indonesian page links to the English counterpart (Q7: /wakaf -> /en/waqf)', () => {
    renderAt('/wakaf', 'id');
    const link = screen.getByRole('link', { name: 'Ganti bahasa ke English' });
    expect(link).toHaveAttribute('href', '/en/waqf');
    expect(link).toHaveAttribute('lang', 'en');
    expect(link).toHaveTextContent('English');
  });

  it('on an English page links back to the Indonesian one', () => {
    renderAt('/en/waqf', 'en');
    const link = screen.getByRole('link', { name: 'Switch language to Bahasa Indonesia' });
    expect(link).toHaveAttribute('href', '/wakaf');
    expect(link).toHaveAttribute('lang', 'id');
  });

  it('is a plain link: no cookie, no redirect, no script (ADR Q3)', () => {
    renderAt('/tentang-kami', 'id');
    expect(screen.getByRole('link')).toHaveAttribute('href', '/en/about');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders nothing where the page has no counterpart (back-office)', () => {
    const { container } = renderAt('/admin', 'id');
    expect(container).toBeEmptyDOMElement();
  });
});
