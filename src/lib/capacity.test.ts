import { describe, it, expect } from 'vitest';
import { Assignment } from '@/generated/prisma/client';
import { judgeCapacity, OwnSubjectConflictError, type RequestedCapacity } from './capacity';
import { NotAuthorizedError } from './campaign-lifecycle-errors';
import { domainErrorToHttp } from './domain-errors';

type Kind = 'campaign' | 'trip';

/**
 * The assignment each request is about: the matching one for ADMIN and
 * VERIFIER, ADMIN for the two Fundraiser requests (the only assignment that
 * could change their answer).
 */
const ASSIGNMENT_FOR: Record<RequestedCapacity, Assignment> = {
  ADMIN: Assignment.ADMIN,
  VERIFIER: Assignment.VERIFIER,
  FUNDRAISER: Assignment.ADMIN,
  FUNDRAISER_OR_ADMIN: Assignment.ADMIN,
};

type Expected = { capacity: string } | { refused: 'NOT_AUTHORIZED' | 'OWN_CAMPAIGN_CONFLICT' | 'OWN_TRIP_CONFLICT' };

/** Subject kind × requested Capacity × owner × assignment held (CONTEXT.md, Capacity). */
const TABLE: Array<[Kind, RequestedCapacity, boolean, boolean, Expected]> = [
  // kind       requested              owner  holds  expected
  ['campaign', 'ADMIN', false, true, { capacity: 'ADMIN' }],
  ['campaign', 'ADMIN', true, true, { refused: 'OWN_CAMPAIGN_CONFLICT' }],
  ['campaign', 'ADMIN', false, false, { refused: 'NOT_AUTHORIZED' }],
  ['campaign', 'ADMIN', true, false, { refused: 'NOT_AUTHORIZED' }],
  ['campaign', 'VERIFIER', false, true, { capacity: 'VERIFIER' }],
  ['campaign', 'VERIFIER', true, true, { refused: 'OWN_CAMPAIGN_CONFLICT' }],
  ['campaign', 'VERIFIER', false, false, { refused: 'NOT_AUTHORIZED' }],
  ['campaign', 'VERIFIER', true, false, { refused: 'NOT_AUTHORIZED' }],
  ['campaign', 'FUNDRAISER', true, true, { capacity: 'FUNDRAISER' }],
  ['campaign', 'FUNDRAISER', true, false, { capacity: 'FUNDRAISER' }],
  ['campaign', 'FUNDRAISER', false, true, { refused: 'NOT_AUTHORIZED' }],
  ['campaign', 'FUNDRAISER', false, false, { refused: 'NOT_AUTHORIZED' }],
  ['campaign', 'FUNDRAISER_OR_ADMIN', true, true, { capacity: 'FUNDRAISER' }],
  ['campaign', 'FUNDRAISER_OR_ADMIN', true, false, { capacity: 'FUNDRAISER' }],
  ['campaign', 'FUNDRAISER_OR_ADMIN', false, true, { capacity: 'ADMIN' }],
  ['campaign', 'FUNDRAISER_OR_ADMIN', false, false, { refused: 'NOT_AUTHORIZED' }],
  ['trip', 'ADMIN', false, true, { capacity: 'ADMIN' }],
  ['trip', 'ADMIN', true, true, { refused: 'OWN_TRIP_CONFLICT' }],
  ['trip', 'ADMIN', false, false, { refused: 'NOT_AUTHORIZED' }],
  ['trip', 'ADMIN', true, false, { refused: 'NOT_AUTHORIZED' }],
  ['trip', 'VERIFIER', false, true, { capacity: 'VERIFIER' }],
  ['trip', 'VERIFIER', true, true, { refused: 'OWN_TRIP_CONFLICT' }],
  ['trip', 'VERIFIER', false, false, { refused: 'NOT_AUTHORIZED' }],
  ['trip', 'VERIFIER', true, false, { refused: 'NOT_AUTHORIZED' }],
  ['trip', 'FUNDRAISER', true, true, { capacity: 'FUNDRAISER' }],
  ['trip', 'FUNDRAISER', true, false, { capacity: 'FUNDRAISER' }],
  ['trip', 'FUNDRAISER', false, true, { refused: 'NOT_AUTHORIZED' }],
  ['trip', 'FUNDRAISER', false, false, { refused: 'NOT_AUTHORIZED' }],
  ['trip', 'FUNDRAISER_OR_ADMIN', true, true, { capacity: 'FUNDRAISER' }],
  ['trip', 'FUNDRAISER_OR_ADMIN', true, false, { capacity: 'FUNDRAISER' }],
  ['trip', 'FUNDRAISER_OR_ADMIN', false, true, { capacity: 'ADMIN' }],
  ['trip', 'FUNDRAISER_OR_ADMIN', false, false, { refused: 'NOT_AUTHORIZED' }],
];

function judge(kind: Kind, requested: RequestedCapacity, owner: boolean, holds: boolean) {
  return () =>
    judgeCapacity(
      { kind, ownerId: owner ? 'user-1' : 'someone-else' },
      { userId: 'user-1', assignments: holds ? [ASSIGNMENT_FOR[requested]] : [] },
      requested,
    );
}

describe('judgeCapacity', () => {
  it.each(TABLE)('%s, requested %s, owner=%s, holds=%s: %o', (kind, requested, owner, holds, expected) => {
    const attempt = judge(kind, requested, owner, holds);
    if ('capacity' in expected) {
      expect(attempt()).toBe(expected.capacity);
      return;
    }
    const errorClass = expected.refused === 'NOT_AUTHORIZED' ? NotAuthorizedError : OwnSubjectConflictError;
    expect(attempt).toThrow(errorClass);
    expect(attempt).toThrow(expect.objectContaining({ code: expected.refused }));
  });

  it('checks the assignment before ownership: an owner without it is not authorized, not in conflict', () => {
    expect(judge('campaign', 'ADMIN', true, false)).toThrow(NotAuthorizedError);
  });

  it('refuses with the caller’s own message when it gives one', () => {
    const subject = { kind: 'campaign' as const, ownerId: 'owner-1' };
    const actor = { userId: 'user-1', assignments: [] };
    expect(() => judgeCapacity(subject, actor, 'FUNDRAISER', 'Hanya Fundraiser.')).toThrow('Hanya Fundraiser.');
  });

  it.each([
    ['campaign', 'FUNDRAISER', 'Hanya Fundraiser Campaign ini yang dapat melakukan tindakan ini.'],
    ['trip', 'FUNDRAISER', 'Hanya Fundraiser Volunteer Trip ini yang dapat melakukan tindakan ini.'],
    ['campaign', 'FUNDRAISER_OR_ADMIN', 'Anda tidak berwenang melakukan tindakan ini pada Campaign ini.'],
    ['campaign', 'ADMIN', 'Anda tidak berwenang melakukan tindakan ini pada Campaign ini.'],
    ['trip', 'VERIFIER', 'Anda tidak berwenang melakukan tindakan ini pada Volunteer Trip ini.'],
  ] as const)('refuses %s × %s, given no message, with the default “%s”', (kind, requested, message) => {
    const actor = { userId: 'user-1', assignments: [] };
    expect(() => judgeCapacity({ kind, ownerId: 'owner-1' }, actor, requested)).toThrow(message);
  });

  it('answers a Fundraiser-only refusal as 403 NOT_AUTHORIZED', () => {
    const actor = { userId: 'user-1', assignments: [] };
    try {
      judgeCapacity({ kind: 'trip', ownerId: 'owner-1' }, actor, 'FUNDRAISER');
      expect.unreachable();
    } catch (error) {
      expect(domainErrorToHttp(error)).toEqual({
        status: 403,
        body: {
          error: 'Hanya Fundraiser Volunteer Trip ini yang dapat melakukan tindakan ini.',
          code: 'NOT_AUTHORIZED',
        },
      });
    }
  });
});

describe('OwnSubjectConflictError', () => {
  it.each([
    ['campaign', 'ADMIN', 'OWN_CAMPAIGN_CONFLICT', 'Anda tidak dapat bertindak sebagai Admin atas Campaign milik Anda sendiri. Tindakan ini harus dilakukan Admin lain.'],
    ['campaign', 'VERIFIER', 'OWN_CAMPAIGN_CONFLICT', 'Anda tidak dapat bertindak sebagai Verifier atas Campaign milik Anda sendiri. Tindakan ini harus dilakukan Verifier lain.'],
    ['trip', 'ADMIN', 'OWN_TRIP_CONFLICT', 'Anda tidak dapat bertindak sebagai Admin atas Volunteer Trip milik Anda sendiri. Tindakan ini harus dilakukan Admin lain.'],
    ['trip', 'VERIFIER', 'OWN_TRIP_CONFLICT', 'Anda tidak dapat bertindak sebagai Verifier atas Volunteer Trip milik Anda sendiri. Tindakan ini harus dilakukan Verifier lain.'],
  ] as const)('on a %s as %s: code %s, 403, one template', (kind, capacity, code, message) => {
    const error = new OwnSubjectConflictError(kind, capacity);
    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
    expect(domainErrorToHttp(error)).toEqual({ status: 403, body: { error: message, code } });
  });
});
