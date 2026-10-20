// Vitest tests for event-derivation service
import { describe, it, expect } from 'vitest';
import { deriveUpcomingEvent, getDateStringInTimezone } from '../src/services/calendar/event-derivation';
import type { PlacementApplication } from '@workspace/db';

// Helper to create minimal application objects
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
    nextDate: '2026-12-01',
    source: 'manual',
    actionRequired: false,
    actionNote: null,
    stageDetail: null,
    summary: null,
    // timestamps required by Zod schema
    updatedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  } as any;
}

describe('deriveUpcomingEvent', () => {
  it('excludes sample applications', () => {
    const e = deriveUpcomingEvent(app({ isSample: true }));
    expect(e).toBeNull();
  });

  it('excludes terminal statuses', () => {
    const e = deriveUpcomingEvent(app({ status: 'ACCEPTED' }));
    expect(e).toBeNull();
  });

  it('creates timed event when nextAt has time', () => {
    const d = new Date('2026-12-01T10:30:00Z');
    const ev = deriveUpcomingEvent(app({ nextAt: d, nextAtHasTime: true }));
    expect(ev).not.toBeNull();
    if (ev) {
      expect(ev.allDay).toBe(false);
      expect(ev.start).toBe(d.toISOString());
    }
  });

  it('creates all‑day event when nextAt has no time', () => {
    const d = new Date('2026-12-01T00:00:00Z');
    const ev = deriveUpcomingEvent(app({ nextAt: d, nextAtHasTime: false }));
    expect(ev).not.toBeNull();
    if (ev) {
      expect(ev.allDay).toBe(true);
      // date string in default timezone (Asia/Kolkata) should be 2026-12-01
      expect(ev.dateStr).toBe('2026-12-01');
    }
  });

  it('creates all‑day event from manual nextDate', () => {
    const ev = deriveUpcomingEvent(app({ nextAt: null, nextDate: '2026-12-15' }));
    expect(ev).not.toBeNull();
    if (ev) {
      expect(ev.allDay).toBe(true);
      expect(ev.dateStr).toBe('2026-12-15');
    }
  });

  it('maps status to correct kind', () => {
    const interview = deriveUpcomingEvent(app({ status: 'INTERVIEW', nextDate: '2026-12-01' }));
    const test = deriveUpcomingEvent(app({ status: 'TEST', nextDate: '2026-12-01' }));
    const screening = deriveUpcomingEvent(app({ status: 'SCREENING', nextDate: '2026-12-01' }));
    const other = deriveUpcomingEvent(app({ status: 'APPLIED', nextDate: '2026-12-01' }));
    expect(interview?.kind).toBe('interview');
    expect(test?.kind).toBe('assessment');
    expect(screening?.kind).toBe('screening');
    expect(other?.kind).toBe('deadline');
  });
});
