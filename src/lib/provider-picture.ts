/**
 * A picture URL that is the provider's to set: https, on Google's image host.
 * Anything else (http:, javascript:, data:, another host) is never stored or
 * rendered from a sign-in. Used both to accept an incoming picture and to
 * recognise a stored one as the provider's rather than uploaded here.
 */
export function isRemoteProviderPicture(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".googleusercontent.com");
  } catch {
    return false;
  }
}

/**
 * The picture the identity provider reports on this sign-in, when it is one.
 * Google's raw profile calls it `picture`; next-auth's own type only knows
 * `image`, so the raw field is read as unknown and checked.
 */
export function providerPicture(profile: unknown): string | null {
  if (typeof profile !== "object" || profile === null) return null;
  const { picture } = profile as { picture?: unknown };
  return typeof picture === "string" && isRemoteProviderPicture(picture) ? picture : null;
}
