import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { messages } from './messages';
import { routing } from './routing';

// The proxy tags /en/* requests with the locale (src/proxy.ts); every other
// request, Indonesian pages included, arrives untagged and is Indonesian.
// Pages sit at one folder path for both languages, so there is no [locale]
// segment to read it from.
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return { locale, messages: messages[locale] };
});
