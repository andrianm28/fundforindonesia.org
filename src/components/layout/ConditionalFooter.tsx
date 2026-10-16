'use client';

import { usePathname } from 'next/navigation';
import type { SiteSettings } from '@/lib/site-settings';
import { Footer } from '@/components/layout/Footer';

const HIDE_FOOTER_PATTERNS = ['/login', '/register', '/admin', '/moderasi'];

export function ConditionalFooter({ footer, social }: { footer: SiteSettings['footer']; social: SiteSettings['social'] }) {
  const pathname = usePathname();
  const shouldHide = HIDE_FOOTER_PATTERNS.some(p => pathname.startsWith(p));
  if (shouldHide) return null;
  return <Footer footer={footer} social={social} />;
}
