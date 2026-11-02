import { defineRouting } from 'next-intl/routing';
import { pathnames } from './pathnames';

/**
 * ADR 0024 section 2. The URL alone decides the language: no detection, no
 * cookie, no Link header (alternates are emitted as head tags instead).
 */
export const routing = defineRouting({
  locales: ['id', 'en'],
  defaultLocale: 'id',
  localePrefix: 'as-needed',
  localeDetection: false,
  localeCookie: false,
  alternateLinks: false,
  pathnames,
});

export type Locale = (typeof routing.locales)[number];
