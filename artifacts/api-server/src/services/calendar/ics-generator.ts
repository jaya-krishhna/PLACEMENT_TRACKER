import type { DerivedCalendarEvent } from "./event-derivation";

/**
 * Escapes characters according to RFC 5545 section 3.3.11:
 * \ -> \\
 * ; -> \;
 * , -> \,
 * \n or \r\n -> \n
 */
export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Folds lines longer than 75 octets by inserting CRLF + space per RFC 5545 section 3.1.
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(line);

  if (bytes.length <= 75) {
    return line;
  }

  let result = "";
  let currentLineBytes = 0;
  let currentChunk = "";

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const charBytes = encoder.encode(char).length;

    // First line can take up to 75 octets; continuation lines can take up to 74 octets (+ 1 leading space)
    const maxLimit = result === "" ? 75 : 74;

    if (currentLineBytes + charBytes > maxLimit) {
      result += (result === "" ? "" : "\r\n ") + currentChunk;
      currentChunk = char;
      currentLineBytes = charBytes;
    } else {
      currentChunk += char;
      currentLineBytes += charBytes;
    }
  }

  if (currentChunk.length > 0) {
    result += (result === "" ? "" : "\r\n ") + currentChunk;
  }

  return result;
}

/**
 * Formats a Date to UTC format: YYYYMMDDTHHMMSSZ
 */
export function formatUtcDateTime(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  const s = String(date.getUTCSeconds()).padStart(2, "0");
  return `${y}${m}${d}T${h}${min}${s}Z`;
}

/**
 * Formats a date string (YYYY-MM-DD) to VALUE=DATE format: YYYYMMDD
 */
export function formatDateOnly(dateStr: string): string {
  return dateStr.slice(0, 10).replace(/-/g, "");
}

/**
 * Given a YYYY-MM-DD date string, returns the next day in YYYYMMDD format (exclusive end date)
 */
export function formatNextDateOnly(dateStr: string): string {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const ny = next.getUTCFullYear();
  const nm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const nd = String(next.getUTCDate()).padStart(2, "0");
  return `${ny}${nm}${nd}`;
}

/**
 * Builds a single VEVENT block for an event.
 */
export function buildVEvent(event: DerivedCalendarEvent, dtstamp: Date = new Date()): string[] {
  const lines: string[] = [];

  lines.push("BEGIN:VEVENT");
  lines.push(`UID:app-${event.applicationId}@placement-tracker`);
  lines.push(`DTSTAMP:${formatUtcDateTime(dtstamp)}`);

  const summary = `${event.company} - ${event.title}`;
  lines.push(`SUMMARY:${escapeIcsText(summary)}`);

  // Build description
  const descParts: string[] = [];
  if (event.role) descParts.push(`Role: ${event.role}`);
  if (event.status) descParts.push(`Status: ${event.status}`);
  if (event.stageDetail) descParts.push(`Stage: ${event.stageDetail}`);
  if (event.actionNote) descParts.push(`Action note: ${event.actionNote}`);
  descParts.push("Tracked in Placement Tracker");

  lines.push(`DESCRIPTION:${escapeIcsText(descParts.join("\n"))}`);

  if (event.allDay) {
    const startDate = formatDateOnly(event.dateStr);
    const endDate = formatNextDateOnly(event.dateStr);
    lines.push(`DTSTART;VALUE=DATE:${startDate}`);
    lines.push(`DTEND;VALUE=DATE:${endDate}`);

    // Alarm: 9 AM-equivalent day before (15 hours before midnight start of event day)
    lines.push("BEGIN:VALARM");
    lines.push("ACTION:DISPLAY");
    lines.push(`DESCRIPTION:${escapeIcsText(`Reminder: ${summary}`)}`);
    lines.push("TRIGGER:-PT15H");
    lines.push("END:VALARM");
  } else {
    lines.push(`DTSTART:${formatUtcDateTime(event.startDate)}`);
    lines.push(`DTEND:${formatUtcDateTime(event.endDate)}`);

    // Alarm 1: 24 hours before
    lines.push("BEGIN:VALARM");
    lines.push("ACTION:DISPLAY");
    lines.push(`DESCRIPTION:${escapeIcsText(`Reminder: ${summary} tomorrow`)}`);
    lines.push("TRIGGER:-P1D");
    lines.push("END:VALARM");

    // Alarm 2: 2 hours before
    lines.push("BEGIN:VALARM");
    lines.push("ACTION:DISPLAY");
    lines.push(`DESCRIPTION:${escapeIcsText(`Reminder: ${summary} in 2 hours`)}`);
    lines.push("TRIGGER:-PT2H");
    lines.push("END:VALARM");
  }

  lines.push("END:VEVENT");
  return lines;
}

/**
 * Generates full RFC 5545 VCALENDAR text for an array of events.
 */
export function generateIcs(
  events: DerivedCalendarEvent[],
  dtstamp: Date = new Date(),
): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Placement Tracker//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const event of events) {
    lines.push(...buildVEvent(event, dtstamp));
  }

  lines.push("END:VCALENDAR");

  // Apply line folding to each line and join with CRLF
  return lines.map((line) => foldIcsLine(line)).join("\r\n") + "\r\n";
}

/**
 * Generates full RFC 5545 VCALENDAR text for a single event.
 */
export function generateSingleIcs(
  event: DerivedCalendarEvent,
  dtstamp: Date = new Date(),
): string {
  return generateIcs([event], dtstamp);
}
