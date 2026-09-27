import { describe, it, expect, beforeEach } from 'vitest';
import { captureTrafficSource, readCapturedTrafficSource } from './traffic-source-capture';

/**
 * The `src` param a shared link carries is only present on the Campaign
 * page a visitor first lands on; by the time they reach the donate page
 * (a separate route) it is gone from the URL. Ticket 24 needs it to survive
 * that navigation, so it is captured once, per Campaign, into
 * sessionStorage -- private to this tab, gone once the visitor closes it,
 * never sent anywhere on its own.
 */
describe('traffic source capture', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('captures a well-formed src and makes it readable back for the same campaign', () => {
    captureTrafficSource('campaign-a', 'https://example.com/campaign/campaign-a?src=whatsapp');

    expect(readCapturedTrafficSource('campaign-a')).toBe('whatsapp');
  });

  it('returns null when nothing was ever captured for that campaign', () => {
    expect(readCapturedTrafficSource('campaign-b')).toBeNull();
  });

  it('does not capture anything when the URL has no src param', () => {
    captureTrafficSource('campaign-a', 'https://example.com/campaign/campaign-a');

    expect(readCapturedTrafficSource('campaign-a')).toBeNull();
  });

  it('sanitizes an unsafe src before storing it', () => {
    captureTrafficSource('campaign-a', 'https://example.com/campaign/campaign-a?src=%3Cscript%3E');

    expect(readCapturedTrafficSource('campaign-a')).toBe('script');
  });

  it('keeps sources for different campaigns apart', () => {
    captureTrafficSource('campaign-a', 'https://example.com/campaign/campaign-a?src=whatsapp');
    captureTrafficSource('campaign-b', 'https://example.com/campaign/campaign-b?src=facebook');

    expect(readCapturedTrafficSource('campaign-a')).toBe('whatsapp');
    expect(readCapturedTrafficSource('campaign-b')).toBe('facebook');
  });

  it('never throws when sessionStorage is unavailable', () => {
    const original = window.sessionStorage;
    Object.defineProperty(window, 'sessionStorage', {
      value: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
      },
      configurable: true,
    });

    expect(() => captureTrafficSource('campaign-a', 'https://example.com/x?src=whatsapp')).not.toThrow();
    expect(readCapturedTrafficSource('campaign-a')).toBeNull();

    Object.defineProperty(window, 'sessionStorage', { value: original, configurable: true });
  });
});
