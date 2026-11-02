import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { messages } from '@/i18n/messages';
import type { Locale } from '@/i18n/routing';

/** `render` inside the provider the root layout supplies, Indonesian unless told otherwise. */
export function renderIntl(ui: ReactElement, locale: Locale = 'id') {
  return render(ui, {
    wrapper: ({ children }) => (
      <NextIntlClientProvider locale={locale} messages={messages[locale]}>
        {children}
      </NextIntlClientProvider>
    ),
  });
}
