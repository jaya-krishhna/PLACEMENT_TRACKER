import { describe, it, expect } from "vitest";
import { ExtractionSchema } from "../src/services/email-extraction.service";

describe("ExtractionSchema", () => {
  const validBase = {
    is_job_related: true,
    email_type: "INTERVIEW",
    company: "Google",
    role: "SWE",
    suggested_status: "INTERVIEW",
    stage_detail: "Round 1 Coding",
    next_at: "2026-11-05T14:30:00+05:30",
    next_at_has_time: true,
    next_type: "Interview",
    action_required: true,
    action_note: "Confirm slot on calendar link",
    rejection_reason: null,
    location: "Bangalore",
    package_lpa: 25.5,
    job_link: "https://careers.google.com/jobs/123",
    contact_name: "John Doe",
    contact_email_or_phone: "john@google.com",
    summary: "Invitation to interview for SWE position.",
    confidence: 0.95,
  };

  it("accepts valid extraction data", () => {
    const parsed = ExtractionSchema.safeParse(validBase);
    expect(parsed.success).toBe(true);
  });

  it("accepts null for optional fields and valid next_at UTC Z", () => {
    const parsed = ExtractionSchema.safeParse({
      ...validBase,
      company: null,
      role: null,
      stage_detail: null,
      next_at: "2026-11-05T09:00:00Z",
      location: null,
      package_lpa: null,
      job_link: null,
      contact_name: null,
      contact_email_or_phone: null,
      action_note: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid email_type enum", () => {
    const parsed = ExtractionSchema.safeParse({
      ...validBase,
      email_type: "SPAM_PROMOTION",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects invalid suggested_status enum (e.g. OFFER)", () => {
    const parsed = ExtractionSchema.safeParse({
      ...validBase,
      suggested_status: "OFFER",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects out-of-range confidence (> 1 or < 0)", () => {
    expect(
      ExtractionSchema.safeParse({ ...validBase, confidence: 1.5 }).success,
    ).toBe(false);
    expect(
      ExtractionSchema.safeParse({ ...validBase, confidence: -0.1 }).success,
    ).toBe(false);
  });

  it("rejects malformed next_at datetime string", () => {
    expect(
      ExtractionSchema.safeParse({
        ...validBase,
        next_at: "Tomorrow at 3pm",
      }).success,
    ).toBe(false);
    expect(
      ExtractionSchema.safeParse({
        ...validBase,
        next_at: "2026-11-05", // Missing time/offset
      }).success,
    ).toBe(false);
  });

  it("rejects summary exceeding 300 characters", () => {
    const longSummary = "a".repeat(301);
    expect(
      ExtractionSchema.safeParse({
        ...validBase,
        summary: longSummary,
      }).success,
    ).toBe(false);
  });
});
