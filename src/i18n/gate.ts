/**
 * English is served only when the owner switches it on (E7: the English pages
 * and renamed URLs wait for the 11 Nov launch). Anything but the exact string
 * `true` is off, so a typo can never open /en. Read per request.
 */
export const englishEnabled = (): boolean => process.env.I18N_ENGLISH_ENABLED === 'true';
