import { escapeHtml } from './escape-html';
import { emailLogoHtml } from './email-logo';
import type { MailMessage } from './types';

/** A value on one line: a subject is a header, and a line break has no business there. */
export function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * The plain letter most platform emails are: a greeting, paragraphs, an
 * optional link, and the team's sign-off, as text and as HTML. Every
 * paragraph and the link are escaped in the HTML body, so a title or a
 * reason typed by a person can never become markup.
 */
export function letter(input: {
  to: string;
  subject: string;
  greeting: string;
  body: string[];
  /** Shown after the body, as itself and as a link. */
  url?: string;
}): MailMessage {
  const closing = 'Salam,\nTim Fund for Indonesia';
  const text = [input.greeting, ...input.body, ...(input.url ? [input.url] : []), closing].join('\n\n');
  const url = input.url ? escapeHtml(input.url) : null;
  const html = [
    emailLogoHtml(),
    `<p>${escapeHtml(input.greeting)}</p>`,
    ...input.body.map((line) => `<p>${escapeHtml(line)}</p>`),
    ...(url ? [`<p><a href="${url}">${url}</a></p>`] : []),
    `<p>${escapeHtml(closing).replace('\n', '<br>')}</p>`,
  ].join('\n');
  return { to: input.to, subject: oneLine(input.subject), text, html };
}

/** "Halo Nama," when the name is known, "Halo," otherwise. */
export function greetingFor(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? `Halo ${trimmed},` : 'Halo,';
}
