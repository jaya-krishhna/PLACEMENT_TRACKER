// Vitest tests for ics-generator service
import { describe, it, expect } from 'vitest';
import { generateIcs, generateSingleIcs } from '../src/services/calendar/ics-generator';
import { deriveUpcomingEvent } from '../src/services/calendar/event-derivation';
import type { PlacementApplication } from '@workspace/db';

function app(overrides: Partial<PlacementApplication> = {}): PlacementApplication {
  return {
    id: 'app-1',
    userId: 'u1',
    companyName: 'Acme, Inc.', // includes comma to test escaping
    role: 'Engineer; Lead', // includes semicolon
    status: 'INTERVIEW',
    isSample: false,
    nextAt: null,
    nextAtHasTime: null,
    nextDate: '2026-12-15',
    source: 'manual',
    actionRequired: false,
    actionNote: null,
    stageDetail: null,
    summary: 'Interview for senior role',
    updatedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  } as any;
}

describe('ics-generator', () => {
  it('generates a valid VCALENDAR with escaped text', () => {
    const event = deriveUpcomingEvent(app())!;
    expect(event).not.toBeNull();
    const ev = generateSingleIcs(event);
    // Basic required VCALENDAR tokens
    expect(ev).toContain('BEGIN:VCALENDAR');
    expect(ev).toContain('END:VCALENDAR');
    // UID should be present and stable for same app id
    const uidMatch = ev.match(/UID:([^\r\n]+)/);
    expect(uidMatch).not.toBeNull();
    const uid = uidMatch![1];
    expect(uid).toMatch(/^app-app-1@/);
    // Escaped characters
    expect(ev).toContain('Acme\\, Inc.'); // comma escaped
    expect(ev).toContain('Engineer\\; Lead'); // semicolon escaped
  });

  it('produces all‑day event with correct DTEND (next day)', () => {
    const date = '2026-12-15';
    const event = deriveUpcomingEvent(app({ nextDate: date }))!;
    const ev = generateSingleIcs(event);
    // All‑day events use DATE format (no time) and DTEND = next day
    expect(ev).toContain(`DTSTART;VALUE=DATE:${date.replace(/-/g, '')}`);
    const nextDay = '2026-12-16';
    expect(ev).toContain(`DTEND;VALUE=DATE:${nextDay.replace(/-/g, '')}`);
  });

  it('adds VALARM for timed events and single VALARM for all‑day', () => {
    const timedEvent = deriveUpcomingEvent(app({ nextAt: new Date('2026-12-01T10:00:00Z'), nextAtHasTime: true }))!;
    const alldayEvent = deriveUpcomingEvent(app({ nextDate: '2026-12-01' }))!;
    const timed = generateSingleIcs(timedEvent);
    const allday = generateSingleIcs(alldayEvent);
    // Timed should contain two VALARM sections
    const alarmCountTimed = (timed.match(/BEGIN:VALARM/g) || []).length;
    const alarmCountAllDay = (allday.match(/BEGIN:VALARM/g) || []).length;
    expect(alarmCountTimed).toBe(2);
    expect(alarmCountAllDay).toBe(1);
  });
});
