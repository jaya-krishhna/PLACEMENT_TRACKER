import { describe, it, expect, vi } from "vitest";
import { parseFromHeader, SenderService } from "../src/services/sender.service";
import { db } from "@workspace/db";

describe("SenderService: From parsing", () => {
  it("should parse 'Name <addr>' correctly", () => {
    const res = parseFromHeader("Recruiting Team <recruiting@stripe.com>");
    expect(res).toEqual({
      address: "recruiting@stripe.com",
      domain: "stripe.com",
    });
  });

  it("should parse bare addresses correctly", () => {
    const res = parseFromHeader("careers@google.com");
    expect(res).toEqual({
      address: "careers@google.com",
      domain: "google.com",
    });
  });

  it("should handle quoted names and complex display strings", () => {
    const res = parseFromHeader('"Doe, Jane (HR)" <jane.doe@sub.company.org>');
    expect(res).toEqual({
      address: "jane.doe@sub.company.org",
      domain: "sub.company.org",
    });
  });

  it("should lowercase addresses and domains", () => {
    const res = parseFromHeader("Talent Acquisition <Jobs@ACME-CORP.COM>");
    expect(res).toEqual({
      address: "jobs@acme-corp.com",
      domain: "acme-corp.com",
    });
  });
});

describe("SenderService: Rule precedence", () => {
  const userId = "00000000-0000-0000-0000-000000000001";

  it("address rule overrides domain rule (address excluded, domain approved)", async () => {
    // Mock db.select
    const selectSpy = vi.spyOn(db, "select").mockImplementation(((query: any) => ({
      from: () => ({
        where: () => {
          // If checking address rules:
          return Promise.resolve([
            {
              id: "rule-1",
              userId,
              kind: "address",
              value: "recruiter@bigtech.com",
              status: "excluded",
              source: "manual",
              messageCount: 0,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]);
        },
      }),
    })) as any);

    const result = await SenderService.resolveStatus(
      userId,
      "recruiter@bigtech.com",
      "bigtech.com",
    );
    expect(result.status).toBe("excluded");
    expect(result.rule?.id).toBe("rule-1");

    selectSpy.mockRestore();
  });

  it("address rule overrides domain rule (address approved, domain excluded)", async () => {
    const selectSpy = vi.spyOn(db, "select").mockImplementation(((query: any) => ({
      from: () => ({
        where: () => {
          return Promise.resolve([
            {
              id: "rule-2",
              userId,
              kind: "address",
              value: "special@spamdomain.com",
              status: "approved",
              source: "manual",
              messageCount: 0,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]);
        },
      }),
    })) as any);

    const result = await SenderService.resolveStatus(
      userId,
      "special@spamdomain.com",
      "spamdomain.com",
    );
    expect(result.status).toBe("approved");

    selectSpy.mockRestore();
  });

  it("exclude beats approve at the same level", async () => {
    const selectSpy = vi.spyOn(db, "select").mockImplementation(((query: any) => ({
      from: () => ({
        where: () => {
          return Promise.resolve([
            {
              id: "rule-approved",
              userId,
              kind: "address",
              value: "candidate@hr.com",
              status: "approved",
              source: "manual",
              messageCount: 0,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            {
              id: "rule-excluded",
              userId,
              kind: "address",
              value: "candidate@hr.com",
              status: "excluded",
              source: "manual",
              messageCount: 0,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]);
        },
      }),
    })) as any);

    const result = await SenderService.resolveStatus(
      userId,
      "candidate@hr.com",
      "hr.com",
    );
    expect(result.status).toBe("excluded");

    selectSpy.mockRestore();
  });

  it("subdomains match a domain rule", async () => {
    let callCount = 0;
    const selectSpy = vi.spyOn(db, "select").mockImplementation(((query: any) => ({
      from: () => ({
        where: () => {
          callCount++;
          if (callCount === 1) {
            // Address rule lookup: no match
            return Promise.resolve([]);
          }
          // Domain rule lookup: matches company.com
          return Promise.resolve([
            {
              id: "domain-rule-1",
              userId,
              kind: "domain",
              value: "company.com",
              status: "approved",
              source: "manual",
              messageCount: 0,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]);
        },
      }),
    })) as any);

    const result = await SenderService.resolveStatus(
      userId,
      "jobs@mail.careers.company.com",
      "mail.careers.company.com",
    );
    expect(result.status).toBe("approved");
    expect(result.rule?.id).toBe("domain-rule-1");

    selectSpy.mockRestore();
  });
});

