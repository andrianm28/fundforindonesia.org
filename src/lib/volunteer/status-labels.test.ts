import { describe, expect, it } from 'vitest';
import { TRIP_STATUS_LABELS } from './status-labels';

describe('TRIP_STATUS_LABELS', () => {
  it('reads Suspended as Ditangguhkan, as CONTEXT.md and the Campaign status label do', () => {
    expect(TRIP_STATUS_LABELS.SUSPENDED).toBe('Ditangguhkan');
  });
});
