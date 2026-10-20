import { describe, it, expect } from "vitest";
import { EmailExtractionService } from "../src/services/email-extraction.service";
import { FakeProvider } from "../src/ai/fake-provider";

describe("EmailExtractionService", () => {
  it("successfully extracts and appends _meta on valid output", async () => {
    const fake = new FakeProvider({ model: "test-model-alpha" });
    const service = new EmailExtractionService(fake);

    const result = await service.extract({
      sender: "jobs@acme.com",
      subject: "Application Received",
      receivedAt: "2026-11-01T10:00:00Z",
      body: "Thanks for applying to Acme.",
    });

    expect(result.is_job_related).toBe(true);
    expect(result.company).toBe("Acme Corp");
    expect(result._meta).toBeDefined();
    expect(result._meta.provider).toBe("fake");
    expect(result._meta.model).toBe("test-model-alpha");
    expect(result._meta.prompt_version).toBe("v1");
    expect(result._meta.extracted_at).toBeDefined();
  });

  it("retries once on invalid schema output, then succeeds if second attempt is valid", async () => {
    let callCount = 0;
    const fake = new FakeProvider({
      model: "test-model-alpha",
      response: (opts) => {
        callCount++;
        if (callCount === 1) {
          // Return invalid confidence > 1
          return {
            is_job_related: true,
            email_type: "CONFIRMATION",
            company: "Acme Corp",
            role: "Engineer",
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
            summary: "Summary text",
            confidence: 2.0, // Invalid!
          };
        }
        // Second call: valid
        return {
          is_job_related: true,
          email_type: "CONFIRMATION",
          company: "Acme Corp",
          role: "Engineer",
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
          summary: "Summary text",
          confidence: 0.9,
        };
      },
    });

    const service = new EmailExtractionService(fake);
    const result = await service.extract({
      sender: "jobs@acme.com",
      subject: "Application Received",
      receivedAt: "2026-11-01T10:00:00Z",
      body: "Thanks for applying to Acme.",
    });

    expect(callCount).toBe(2);
    expect(result.confidence).toBe(0.9);
  });

  it("retries once on invalid schema output, then fails if second attempt also invalid", async () => {
    let callCount = 0;
    const fake = new FakeProvider({
      model: "test-model-alpha",
      response: () => {
        callCount++;
        return {
          is_job_related: true,
          email_type: "INVALID_TYPE", // Invalid enum!
          company: "Acme",
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
          confidence: 0.8,
        };
      },
    });

    const service = new EmailExtractionService(fake);

    await expect(
      service.extract({
        sender: "jobs@acme.com",
        subject: "Application Received",
        receivedAt: "2026-11-01T10:00:00Z",
        body: "Thanks for applying to Acme.",
      }),
    ).rejects.toThrow();

    expect(callCount).toBe(2);
  });
});
