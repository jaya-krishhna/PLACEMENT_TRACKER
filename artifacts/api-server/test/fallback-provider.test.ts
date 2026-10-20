import { describe, it, expect, vi } from "vitest";
import { FallbackProvider } from "../src/ai/fallback-provider";
import { FakeProvider } from "../src/ai/fake-provider";
import { RateLimitError, ServerError, SchemaValidationError } from "../src/ai/types";
import { ExtractionSchema } from "../src/services/email-extraction.service";

describe("FallbackProvider", () => {
  const dummyOpts = {
    system: "sys",
    user: "usr",
    schema: ExtractionSchema,
  };

  it("works with only a primary configured and returns primary result", async () => {
    const primary = new FakeProvider({ model: "primary-model" });
    const fallbackChain = new FallbackProvider(primary, null);

    const result = await fallbackChain.extract(dummyOpts);
    expect(result.company).toBe("Acme Corp");
    expect(fallbackChain.lastResultMeta?.model).toBe("primary-model");
  });

  it("switches to the fallback on primary 429 rate limit", async () => {
    const primary = new FakeProvider({
      model: "primary-model",
      response: () => {
        throw new RateLimitError("Rate limit exceeded", 5000);
      },
    });

    const fallback = new FakeProvider({
      model: "fallback-model",
      response: () => ({
        is_job_related: true,
        email_type: "ASSESSMENT",
        company: "Fallback Tech",
        role: "Developer",
        suggested_status: "TEST",
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
        summary: "Coding test invitation.",
        confidence: 0.9,
      }),
    });

    const fallbackChain = new FallbackProvider(primary, fallback);
    const result = await fallbackChain.extract(dummyOpts);

    expect(result.company).toBe("Fallback Tech");
    expect(fallbackChain.lastResultMeta?.model).toBe("fallback-model");
  });

  it("switches to fallback on primary 5xx server error", async () => {
    const primary = new FakeProvider({
      model: "primary-model",
      response: () => {
        throw new ServerError("Internal 500", 500);
      },
    });

    const fallback = new FakeProvider({
      model: "fallback-model",
    });

    const fallbackChain = new FallbackProvider(primary, fallback);
    const result = await fallbackChain.extract(dummyOpts);

    expect(result.company).toBe("Acme Corp");
    expect(fallbackChain.lastResultMeta?.model).toBe("fallback-model");
  });

  it("escalates to fallback after two validation failures from primary", async () => {
    let primaryAttempts = 0;
    const primary = new FakeProvider({
      model: "primary-model",
      response: () => {
        primaryAttempts++;
        // Output with invalid confidence to trigger SchemaValidationError
        return {
          is_job_related: true,
          email_type: "CONFIRMATION",
          company: "Bad Data Corp",
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
          summary: "Summary",
          confidence: 99.0, // Invalid!
        };
      },
    });

    const fallback = new FakeProvider({
      model: "fallback-model",
      response: () => ({
        is_job_related: true,
        email_type: "CONFIRMATION",
        company: "Escalated Corp",
        role: null,
        suggested_status: "APPLIED",
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
        summary: "Escalated successfully",
        confidence: 0.9,
      }),
    });

    const fallbackChain = new FallbackProvider(primary, fallback);
    const result = await fallbackChain.extract(dummyOpts);

    expect(primaryAttempts).toBe(2);
    expect(result.company).toBe("Escalated Corp");
    expect(fallbackChain.lastResultMeta?.model).toBe("fallback-model");
  });

  it("honors cooldown and skips primary on subsequent requests while cooling down", async () => {
    let primaryCalls = 0;
    const primary = new FakeProvider({
      model: "primary-model",
      response: () => {
        primaryCalls++;
        throw new RateLimitError("429 Too Many Requests", 60_000); // 60s cooldown
      },
    });

    const fallback = new FakeProvider({
      model: "fallback-model",
    });

    const fallbackChain = new FallbackProvider(primary, fallback);

    // Call 1: primary is called, fails with 429, sets cooldown, falls back
    await fallbackChain.extract(dummyOpts);
    expect(primaryCalls).toBe(1);
    expect(fallbackChain.lastResultMeta?.model).toBe("fallback-model");

    // Call 2: primary is in cooldown, routes DIRECTLY to fallback without calling primary!
    await fallbackChain.extract(dummyOpts);
    expect(primaryCalls).toBe(1); // Still 1!
    expect(fallbackChain.lastResultMeta?.model).toBe("fallback-model");
  });
});
