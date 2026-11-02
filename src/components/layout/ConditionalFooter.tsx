'use client';

import { usePathname } from 'next/navigation';
import type { SiteSettings } from '@/lib/site-settings';
import { Footer } from '@/components/layout/Footer';
import { stripLocalePrefix } from '@/i18n/locale-path';

const HIDE_FOOTER_PATTERNS = ['/login', '/register', '/admin', '/moderasi'];

export function ConditionalFooter({
  footer,
  social,
  showLanguageSwitcher = false,
}: {
  footer: SiteSettings['footer'];
  social: SiteSettings['social'];
  /** English gate (I18N_ENGLISH_ENABLED), decided on the server by the root layout. */
  showLanguageSwitcher?: boolean;
}) {
  // /en/login hides the footer like /login does.
  const pathname = stripLocalePrefix(usePathname());
  const shouldHide = HIDE_FOOTER_PATTERNS.some(p => pathname.startsWith(p));
  if (shouldHide) return null;
  return <Footer footer={footer} social={social} showLanguageSwitcher={showLanguageSwitcher} />;
}
