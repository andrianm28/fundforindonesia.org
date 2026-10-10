import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isBetaSandbox } from './deploy-environment';

let saved: string | undefined;

beforeEach(() => {
  saved = process.env.BETA_SANDBOX;
  delete process.env.BETA_SANDBOX;
});

afterEach(() => {
  if (saved === undefined) delete process.env.BETA_SANDBOX;
  else process.env.BETA_SANDBOX = saved;
});

describe('isBetaSandbox', () => {
  it('is off when the marker is absent', () => {
    expect(isBetaSandbox()).toBe(false);
  });

  it('is on for exactly "true"', () => {
    process.env.BETA_SANDBOX = 'true';
    expect(isBetaSandbox()).toBe(true);
  });

  it('does not read a near miss as the beta: the permissive direction is the dangerous one', () => {
    for (const almost of ['True', 'TRUE', ' true', 'true ', '1', 'yes', 'beta', 'false', '']) {
      process.env.BETA_SANDBOX = almost;
      expect(isBetaSandbox(), JSON.stringify(almost)).toBe(false);
    }
  });

  it('is read per call, so a change applies without a rebuild', () => {
    process.env.BETA_SANDBOX = 'true';
    expect(isBetaSandbox()).toBe(true);
    delete process.env.BETA_SANDBOX;
    expect(isBetaSandbox()).toBe(false);
  });
});
