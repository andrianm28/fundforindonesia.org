'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { pairedLocalePath } from '@/i18n/locale-path';
import { routing, type Locale } from '@/i18n/routing';

/**
 * A plain link to the same page in the other language (ADR 0024 Q3: the URL
 * alone decides the language, so there is no cookie and no redirect). The
 * caller shows it only while English is on (`englishEnabled()` in the root
 * layout); this component does not know the gate.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const t = useTranslations('Common');
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const target = routing.locales.find((l) => l !== locale);
  if (!target) return null;
  const href = pairedLocalePath(pathname, target);
  if (!href) return null;
  const language = t(`languageNames.${target}`);
  return (
    // Plain <a>: a language change is a full document change (lang attribute, catalogue).
    <a href={href} lang={target} hrefLang={target} className={className} aria-label={t('switchLanguage', { language })}>
      {language}
    </a>
  );
}
