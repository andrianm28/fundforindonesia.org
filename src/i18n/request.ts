import { getRequestConfig } from 'next-intl/server';
import { messages } from './messages';

// Foundation only: the locale is fixed to Indonesian until the page PRs move
// the routes under [locale] and read it from the URL (ADR 0024 section 5).
export default getRequestConfig(async () => ({
  locale: 'id',
  messages: messages.id,
}));
