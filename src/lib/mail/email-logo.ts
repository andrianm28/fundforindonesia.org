import { publicUrl } from '@/lib/public-url';

/**
 * The logo block that opens every HTML email. An email client cannot reach a
 * relative path, so the address is absolute; PNG, not WebP, because Outlook and
 * some webmail do not render WebP. The text part of a message carries no logo.
 */
export function emailLogoHtml(): string {
  const src = publicUrl('/brand/logo-wordmark.png');
  return `<p><img src="${src}" alt="Fund for Indonesia" width="200" height="62" style="display:block;height:auto;border:0"></p>`;
}
