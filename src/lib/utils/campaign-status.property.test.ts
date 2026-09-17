import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { determineCampaignStatus } from './campaign-status';

/**
 * Property-based tests for Campaign Status Consistency (Property 13)
 *
 * **Validates: Requirements 4.3, 3.7**
 *
 * Property 13: Campaign Status Consistency
 * For any Campaign: if collectedAmount >= targetAmount, status SHALL be "completed".
 * If current time is past deadline and collectedAmount < targetAmount, status SHALL be "expired".
 * Otherwise status SHALL be "active".
 */

describe('Property 13: Campaign Status Consistency', () => {
  const now = new Date('2024-06-15T12:00:00Z');

  it('when collected >= target, status is always "completed" regardless of deadline', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000 }), // targetAmount
        fc.integer({ min: 0, max: 100_000_000 }), // extra above target
        fc.option(fc.integer({ min: -365 * 4, max: 365 * 4 })), // deadline offset in days (past or future or null)
        (targetAmount, extra, deadlineOffsetDays) => {
          const collectedAmount = targetAmount + extra; // always >= target
          const deadline = deadlineOffsetDays !== null
            ? new Date(now.getTime() + deadlineOffsetDays * 24 * 60 * 60 * 1000)
            : null;
          const status = determineCampaignStatus(collectedAmount, targetAmount, deadline, now);
          expect(status).toBe('completed');
        }
      ),
      { numRuns: 200 }
    );
  });

  it('when collected < target and deadline is in the past, status is "expired"', () => {
    // Generate past deadlines as offsets in milliseconds before "now"
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000 }), // targetAmount
        fc.integer({ min: 0, max: 99_999_999 }),   // collectedAmount (will be constrained below target)
        fc.integer({ min: 1, max: 365 * 4 }),      // days in the past (1 to ~4 years)
        (targetAmount, rawCollected, daysInPast) => {
          const collectedAmount = Math.min(rawCollected, targetAmount - 1);
          const deadline = new Date(now.getTime() - daysInPast * 24 * 60 * 60 * 1000);
          const status = determineCampaignStatus(collectedAmount, targetAmount, deadline, now);
          expect(status).toBe('expired');
        }
      ),
      { numRuns: 200 }
    );
  });

  it('when collected < target and deadline is null, status is "active"', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000 }), // targetAmount
        fc.integer({ min: 0, max: 99_999_999 }),   // collectedAmount
        (targetAmount, rawCollected) => {
          const collectedAmount = Math.min(rawCollected, targetAmount - 1);
          const status = determineCampaignStatus(collectedAmount, targetAmount, null, now);
          expect(status).toBe('active');
        }
      ),
      { numRuns: 200 }
    );
  });

  it('when collected < target and deadline is in the future, status is "active"', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000 }), // targetAmount
        fc.integer({ min: 0, max: 99_999_999 }),   // collectedAmount
        fc.integer({ min: 1, max: 365 * 4 }),      // days in the future (1 to ~4 years)
        (targetAmount, rawCollected, daysInFuture) => {
          const collectedAmount = Math.min(rawCollected, targetAmount - 1);
          const deadline = new Date(now.getTime() + daysInFuture * 24 * 60 * 60 * 1000);
          const status = determineCampaignStatus(collectedAmount, targetAmount, deadline, now);
          expect(status).toBe('active');
        }
      ),
      { numRuns: 200 }
    );
  });

  it('generates random (collectedAmount, targetAmount, deadline) tuples and verifies status consistency', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),  // collectedAmount
        fc.integer({ min: 1, max: 100_000_000 }),  // targetAmount (> 0)
        fc.option(fc.integer({ min: -365 * 4, max: 365 * 4 })), // deadline offset in days or null
        (collectedAmount, targetAmount, deadlineOffsetDays) => {
          const deadline = deadlineOffsetDays !== null
            ? new Date(now.getTime() + deadlineOffsetDays * 24 * 60 * 60 * 1000)
            : null;
          const status = determineCampaignStatus(collectedAmount, targetAmount, deadline, now);

          if (collectedAmount >= targetAmount) {
            expect(status).toBe('completed');
          } else if (deadline && deadline < now) {
            expect(status).toBe('expired');
          } else {
            expect(status).toBe('active');
          }
        }
      ),
      { numRuns: 500 }
    );
  });
});
