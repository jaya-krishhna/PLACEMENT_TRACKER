// Vitest tests for reminder-engine service
import { describe, it, expect } from 'vitest';
import { computeReminders } from '../src/services/calendar/reminder-engine';
import type { PlacementApplication } from '@workspace/db';

// Helper to create an application with a given nextAt / nextDate
function app(overrides: Partial<PlacementApplication> = {}): PlacementApplication {
  return {
    id: 'app-1',
    userId: 'u1',
    companyName: 'Acme',
    role: 'Engineer',
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
    updatedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  } as any;
}

// In Asia/Kolkata (UTC+5:30):
// 2026-12-02 09:00 IST is 2026-12-02 03:30 UTC
// 2026-12-01 10:00 IST is 2026-12-01 04:30 UTC

describe('computeReminders', () => {
  it('fires day_before reminder 24h before timed event', () => {
    // Event at 2026-12-02T10:00:00Z
    // 24h before is 2026-12-01T10:00:00Z
    // Set now to 2026-12-01T12:00:00Z (within 24h of event, but more than 2h before event)
    const eventTime = new Date('2026-12-02T10:00:00Z');
    const now = new Date('2026-12-01T12:00:00Z');
    const ev = app({ nextAt: eventTime, nextAtHasTime: true });
    const result = computeReminders({ applications: [ev], now });
    expect(result.items.some((r) => r.kind === 'day_before')).toBeTruthy();
  });

  it('fires two_hours reminder 2h before timed event', () => {
    const eventTime = new Date('2026-12-01T10:00:00Z');
    // Set now to 1 hour before event (2026-12-01T09:00:00Z)
    const now = new Date('2026-12-01T09:00:00Z');
    const ev = app({ nextAt: eventTime, nextAtHasTime: true });
    const result = computeReminders({ applications: [ev], now });
    expect(result.items.some((r) => r.kind === 'two_hours')).toBeTruthy();
  });

  it('fires morning_of reminder at 08:00 for all‑day event on the same day', () => {
    // 2026-12-01 in Asia/Kolkata: 08:00 IST is 02:30 UTC
    const now = new Date('2026-12-01T03:00:00Z');
    const ev = app({ nextDate: '2026-12-01' });
    const result = computeReminders({ applications: [ev], now });
    expect(result.items.some((r) => r.kind === 'morning_of')).toBeTruthy();
  });

  it('only most urgent reminder per event (two_hours beats day_before)', () => {
    const eventTime = new Date('2026-12-01T10:00:00Z');
    const now = new Date('2026-12-01T09:00:00Z');
    const ev = app({ nextAt: eventTime, nextAtHasTime: true });
    const result = computeReminders({ applications: [ev], now });
    const kinds = result.items.filter((r) => r.applicationId === ev.id).map((r) => r.kind);
    expect(kinds).toEqual(['two_hours']);
  });

  it('does not include dismissed reminders', () => {
    const eventTime = new Date('2026-12-02T10:00:00Z');
    const now = new Date('2026-12-01T12:00:00Z');
    const ev = app({ nextAt: eventTime, nextAtHasTime: true });
    // First compute without dismissals to get key
    const initial = computeReminders({ applications: [ev], now });
    const key = initial.items[0]?.key;
    expect(key).toBeDefined();

    const dismissed = computeReminders({
      applications: [ev],
      now,
      dismissedKeys: new Set([key]),
    });
    expect(dismissed.items.some((r) => r.key === key)).toBeFalsy();
  });

  it('creates daily digest reminder', () => {
    // Event on 2026-12-01
    // Now at 09:00 IST (03:30 UTC) on 2026-12-01
    const now = new Date('2026-12-01T03:30:00Z');
    const ev = app({ nextDate: '2026-12-01' });
    const result = computeReminders({ applications: [ev], now });
    expect(result.items.some((r) => r.kind === 'digest')).toBeTruthy();
  });
});
