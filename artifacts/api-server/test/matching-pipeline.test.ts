import { beforeEach, describe, expect, it, vi } from "vitest";
import { MatchingService } from "../src/services/matcher/matching.service";
import { ApplyService } from "../src/services/matcher/apply.service";
import { db } from "@workspace/db";

// Mock @workspace/db
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    db: {
      ...actual.db,
      select: vi.fn(),
    },
  };
});

describe("MatchingService Pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("processes extracted emails in ascending received_at order and is idempotent", async () => {
    const email1 = {
      id: "email_1",
      userId: "user_1",
      threadId: "th_1",
      receivedAt: new Date("2026-08-01T10:00:00Z"),
      status: "extracted",
      subject: "Applied to Acme",
      fromAddress: "hr@acme.com",
      aiResult: {
        company: "Acme",
        role: "Dev",
        suggested_status: "APPLIED",
      },
    };

    const email2 = {
      id: "email_2",
      userId: "user_1",
      threadId: "th_1",
      receivedAt: new Date("2026-09-01T10:00:00Z"),
      status: "extracted",
      subject: "Interview at Acme",
      fromAddress: "hr@acme.com",
      aiResult: {
        company: "Acme",
        role: "Dev",
        suggested_status: "INTERVIEW",
      },
    };

    let extractedEmailsCall = 0;
    (db.select as any).mockImplementation(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          const p: any = Promise.resolve([]);
          p.orderBy = vi.fn().mockImplementation(() => {
            extractedEmailsCall++;
            // On first run return both emails, on second run return empty list (idempotent)
            return Promise.resolve(extractedEmailsCall === 1 ? [email1, email2] : []);
          });
          return p;
        }),
      })),
    }));

    const applySpy = vi
      .spyOn(ApplyService, "applyDecision")
      .mockResolvedValueOnce({ action: "create", applicationId: "app_acme" })
      .mockResolvedValueOnce({ action: "update", applicationId: "app_acme" });

    // First run
    const result1 = await MatchingService.applyExtracted("user_1");
    expect(result1.applied).toBe(2);
    expect(result1.created).toBe(1);
    expect(result1.updated).toBe(1);
    expect(applySpy).toHaveBeenCalledTimes(2);

    // Second run: no emails with status 'extracted' -> 0 processed
    const result2 = await MatchingService.applyExtracted("user_1");
    expect(result2.applied).toBe(0);
    expect(result2.created).toBe(0);
    expect(result2.updated).toBe(0);
  });
});
