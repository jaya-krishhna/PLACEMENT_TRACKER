import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProcessingService } from "../src/services/processing.service";
import { GmailAuthService } from "../src/services/gmail-auth.service";
import { GmailClient } from "../src/lib/gmail-client";
import { ProviderFactory } from "../src/ai/provider-factory";
import { FakeProvider } from "../src/ai/fake-provider";
import { RateLimitError } from "../src/ai/types";
import { db, emailEventsTable } from "@workspace/db";

describe("ProcessingService", () => {
  const userId = "22222222-2222-2222-2222-222222222222";

  beforeEach(() => {
    vi.restoreAllMocks();
    ProviderFactory.reset();
  });

  it("processes queued emails ordered by receivedAt, extracts them, and never writes body text to DB", async () => {
    const fakeEvents = [
      {
        id: "event-1",
        userId,
        gmailMessageId: "msg-1",
        receivedAt: new Date("2026-11-01T08:00:00Z"),
        status: "queued",
        retryCount: 0,
        fromAddress: "jobs@google.com",
        subject: "Interview invite",
        createdAt: new Date("2026-11-01T08:05:00Z"),
      },
      {
        id: "event-2",
        userId,
        gmailMessageId: "msg-2",
        receivedAt: new Date("2026-11-01T09:00:00Z"),
        status: "queued",
        retryCount: 0,
        fromAddress: "news@newsletter.com",
        subject: "Weekly Digest",
        createdAt: new Date("2026-11-01T09:05:00Z"),
      },
    ];

    // Mock DB select
    vi.spyOn(db, "select").mockImplementation(((fields: any) => ({
      from: () => ({
        where: () => {
          const res = [{ count: 0 }];
          return {
            orderBy: () => ({
              limit: () => Promise.resolve(fakeEvents),
            }),
            then: (resolve: any, reject: any) => Promise.resolve(res).then(resolve, reject),
          };
        },
      }),
    })) as any);

    // Track DB updates
    const updates: any[] = [];
    vi.spyOn(db, "update").mockImplementation((() => ({
      set: (values: any) => {
        updates.push(values);
        return {
          where: () => Promise.resolve([{ id: "event-1" }]),
        };
      },
    })) as any);

    // Mock Gmail client
    vi.spyOn(GmailAuthService, "getAuthorizedClient").mockResolvedValue({} as any);
    const secretBodyText = "TOP SECRET SENSITIVE EMAIL BODY CONTENT WITH CONFIDENTIAL DATA";
    vi.spyOn(GmailClient, "getMessageBody").mockResolvedValue(secretBodyText);

    // Mock AI provider: msg-1 is job-related, msg-2 is not
    const fakeProvider = new FakeProvider({
      model: "test-fake-model",
      response: (opts) => {
        if (opts.user.includes("google.com")) {
          return {
            is_job_related: true,
            email_type: "INTERVIEW",
            company: "Google",
            role: "Software Engineer",
            suggested_status: "INTERVIEW",
            stage_detail: "Onsite Round",
            next_at: "2026-11-05T10:00:00Z",
            next_at_has_time: true,
            next_type: "Interview",
            action_required: true,
            action_note: "Confirm slot",
            rejection_reason: null,
            location: "Bangalore",
            package_lpa: null,
            job_link: null,
            contact_name: null,
            contact_email_or_phone: null,
            summary: "Interview scheduled.",
            confidence: 0.98,
          };
        }
        return {
          is_job_related: false,
          email_type: "OTHER",
          company: null,
          role: null,
          suggested_status: null,
          stage_detail: null,
          next_at: null,
          next_at_has_time: false,
          next_type: null,
          action_required: false,
          action_note: null,
          rejection_reason: null,
          location: null,
          package_lpa: null,
          job_link: null,
          contact_name: null,
          contact_email_or_phone: null,
          summary: "Weekly newsletter.",
          confidence: 0.99,
        };
      },
    });
    vi.spyOn(ProviderFactory, "getProvider").mockReturnValue(fakeProvider);

    const result = await ProcessingService.processQueued(userId);

    expect(result.extracted).toBe(1);
    expect(result.ignored).toBe(1);
    expect(result.failed).toBe(0);

    // Verify HARD CONSTRAINT: Email body text was NEVER written to the database!
    for (const update of updates) {
      const updateStr = JSON.stringify(update);
      expect(updateStr).not.toContain(secretBodyText);
      expect(update).not.toHaveProperty("body");
      expect(update).not.toHaveProperty("bodyText");
    }
  });

  it("resumes and leaves remaining rows queued after a simulated 429 rate limit", async () => {
    const fakeEvents = [
      {
        id: "event-rate-limit",
        userId,
        gmailMessageId: "msg-rl",
        receivedAt: new Date("2026-11-01T08:00:00Z"),
        status: "queued",
        retryCount: 0,
        fromAddress: "recruiter@uber.com",
        subject: "Uber OA",
        createdAt: new Date("2026-11-01T08:05:00Z"),
      },
    ];

    vi.spyOn(db, "select").mockImplementation((() => ({
      from: () => ({
        where: () => {
          const res = [{ count: 1 }];
          return {
            orderBy: () => ({
              limit: () => Promise.resolve(fakeEvents),
            }),
            then: (resolve: any, reject: any) => Promise.resolve(res).then(resolve, reject),
          };
        },
      }),
    })) as any);

    const updateCalls: any[] = [];
    vi.spyOn(db, "update").mockImplementation((() => ({
      set: (values: any) => {
        updateCalls.push(values);
        return {
          where: () => Promise.resolve([{ id: "event-rate-limit" }]),
        };
      },
    })) as any);

    vi.spyOn(GmailAuthService, "getAuthorizedClient").mockResolvedValue({} as any);
    vi.spyOn(GmailClient, "getMessageBody").mockResolvedValue("Uber Online Assessment details");

    const rateLimitProvider = new FakeProvider({
      model: "rate-limited-model",
      response: () => {
        throw new RateLimitError("Gemini quota exceeded", 30_000);
      },
    });
    vi.spyOn(ProviderFactory, "getProvider").mockReturnValue(rateLimitProvider);

    const result = await ProcessingService.processQueued(userId);

    expect(result.rateLimited).toBe(true);

    // Event should be restored to queued status
    const resetToQueued = updateCalls.some((call) => call.status === "queued");
    expect(resetToQueued).toBe(true);
  });
});
