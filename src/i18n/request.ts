import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { headers } from 'next/headers';
import { englishEnabled } from './gate';
import { LOCALE_SIGNATURE_HEADER, verifyLocaleSignature } from './locale-signature';
import { messages } from './messages';
import { routing } from './routing';

// The proxy tags /en/* requests with the locale (src/proxy.ts); every other
// request, Indonesian pages included, arrives untagged and is Indonesian.
// Pages sit at one folder path for both languages, so there is no [locale]
// segment to read it from. Indonesian paths skip the proxy, so a client can
// send the locale header there too: English is honoured only while the gate is
// on AND the proxy's signature accompanies the tag.
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  let locale: (typeof routing.locales)[number] = routing.defaultLocale;
  if (hasLocale(routing.locales, requested) && requested !== routing.defaultLocale && englishEnabled()) {
    const signature = (await headers()).get(LOCALE_SIGNATURE_HEADER);
    if (verifyLocaleSignature(requested, signature)) locale = requested;
  }
  return { locale, messages: messages[locale] };
});
