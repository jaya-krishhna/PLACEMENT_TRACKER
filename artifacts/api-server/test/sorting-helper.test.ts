// Vitest tests for sorting-helper service
import { describe, it, expect } from 'vitest';
import { sortByRecentlyUpdated } from '../src/services/calendar/sorting-helper';
import type { PlacementApplication } from '@workspace/db';

function makeApp(id: string, updated: string | Date, lastEmail: string | Date | null = null): PlacementApplication {
  return {
    id,
    userId: 'u1',
    companyName: 'C',
    role: 'R',
    status: 'APPLIED',
    isSample: false,
    nextAt: null,
    nextAtHasTime: null,
    nextDate: null,
    source: 'manual',
    actionRequired: false,
    actionNote: null,
    stageDetail: null,
    summary: null,
    updatedAt: new Date(updated),
    lastEmailAt: lastEmail ? new Date(lastEmail) : null,
    createdAt: new Date('2026-01-01'),
  } as any;
}

describe('sortByRecentlyUpdated', () => {
  it('orders by max(updatedAt, lastEmailAt) descending, then createdAt', () => {
    const a = makeApp('a', '2026-12-02T10:00:00Z', null);
    const b = makeApp('b', '2026-12-01T12:00:00Z', '2026-12-02T09:00:00Z'); // lastEmail is newer than a.updated
    const c = makeApp('c', '2026-12-01T12:00:00Z', null);
    const sorted = sortByRecentlyUpdated([a, b, c]);
    // b should be first because its effective timestamp is 2026-12-02T09:00:00Z (newer than a's 2026-12-02T10:00:00Z? Actually a's is later, so a first)
    expect(sorted[0].id).toBe('a'); // a has later updatedAt
    expect(sorted[1].id).toBe('b'); // b effective is 2026-12-02T09:00:00Z
    // c and b have same updatedAt, fallback to createdAt (both same) -> order stable, but c should come after b because b appears earlier in input
    expect(sorted[2].id).toBe('c');
  });
});

