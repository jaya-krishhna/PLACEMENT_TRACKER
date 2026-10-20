import { describe, expect, it } from "vitest";
import {
  matchExtractedEmail,
  type MatcherApplication,
  type MatcherEmailInput,
  type MatcherContext,
} from "../src/services/matcher/application-matcher";
import {
  normalizeCompany,
  rolesMatch,
  getRoleTokens,
  computeContentFingerprint,
} from "../src/services/matcher/normalizer";

describe("Application Matcher Pure Functions", () => {
  describe("normalizeCompany", () => {
    it("lowercases, strips legal suffixes and punctuation", () => {
      expect(normalizeCompany("Stripe, Inc.")).toBe("stripe");
      expect(normalizeCompany("Stripe Inc")).toBe("stripe");
      expect(normalizeCompany("The Stripe LLC")).toBe("stripe");
      expect(normalizeCompany("Google Technologies Ltd.")).toBe("google");
      expect(normalizeCompany("Acme Pvt. Limited")).toBe("acme");
      expect(normalizeCompany("Acme Corporation")).toBe("acme");
      expect(normalizeCompany("Uber")).toBe("uber");
    });
  });

  describe("rolesMatch", () => {
    it("matches roles via token sets regardless of word order and punctuation", () => {
      expect(
        rolesMatch("Software Engineer, Intern", "Intern - Software Engineer"),
      ).toBe(true);
      expect(
        rolesMatch("Backend Developer", "Developer Backend"),
      ).toBe(true);
      expect(rolesMatch("Software Engineer", "Product Manager")).toBe(false);
      expect(rolesMatch(null, null)).toBe(true);
      expect(rolesMatch("Software Engineer", null)).toBe(false);
    });
  });

  describe("computeContentFingerprint", () => {
    it("generates deterministic sha256 fingerprint", () => {
      const fp1 = computeContentFingerprint({
        fromAddress: "jobs@stripe.com",
        subject: "Application received",
        company: "Stripe, Inc.",
        role: "Software Engineer, Intern",
        suggestedStatus: "APPLIED",
        stageDetail: "Online application submitted",
        nextAt: null,
      });

      const fp2 = computeContentFingerprint({
        fromAddress: "JOBS@STRIPE.COM ",
        subject: "application received",
        company: "The Stripe LLC",
        role: "Intern - Software Engineer",
        suggestedStatus: "applied",
        stageDetail: "Online application submitted",
        nextAt: null,
      });

      expect(fp1).toBe(fp2);
    });
  });

  describe("matchExtractedEmail Rule Evaluation Order", () => {
    const baseEmail: MatcherEmailInput = {
      threadId: "th_1",
      receivedAt: "2026-10-15T10:00:00Z",
      fromAddress: "recruiter@stripe.com",
      contentFingerprint: "fp_unique_1",
      aiResult: {
        is_job_related: true,
        email_type: "UPDATE",
        company: "Stripe",
        role: "Software Engineer",
        suggested_status: "INTERVIEW",
        stageDetail: "Technical screen scheduled",
      },
    };

    const existingApp: MatcherApplication = {
      id: "app_1",
      companyName: "Stripe",
      role: "Software Engineer",
      status: "SCREENING",
      lastEmailAt: "2026-10-10T10:00:00Z",
      appliedDate: "2026-10-01",
      isSample: false,
    };

    it("1. Duplicate content: lands in review even if thread matches", () => {
      const ctx: MatcherContext = {
        email: {
          ...baseEmail,
          contentFingerprint: "fp_duplicate_1",
        },
        applications: [existingApp],
        threadToAppIds: new Map([["th_1", ["app_1"]]]),
        appliedFingerprints: new Map([["fp_duplicate_1", "app_1"]]),
      };

      const decision = matchExtractedEmail(ctx);
      expect(decision.action).toBe("review");
      expect(decision.reviewReason).toBe("duplicate_content");
      expect(decision.applicationId).toBe("app_1");
    });

    it("2. Thread match: exactly 1 matching app -> candidate chosen", () => {
      const ctx: MatcherContext = {
        email: baseEmail,
        applications: [existingApp],
        threadToAppIds: new Map([["th_1", ["app_1"]]]),
        appliedFingerprints: new Map(),
      };

      const decision = matchExtractedEmail(ctx);
      expect(decision.action).toBe("update");
      expect(decision.matchMethod).toBe("thread");
      expect(decision.applicationId).toBe("app_1");
    });

    it("2. Thread match conflict: thread maps to multiple apps -> review thread_conflict", () => {
      const app2: MatcherApplication = {
        ...existingApp,
        id: "app_2",
        role: "Data Scientist",
      };
      const ctx: MatcherContext = {
        email: baseEmail,
        applications: [existingApp, app2],
        threadToAppIds: new Map([["th_1", ["app_1", "app_2"]]]),
        appliedFingerprints: new Map(),
      };

      const decision = matchExtractedEmail(ctx);
      expect(decision.action).toBe("review");
      expect(decision.reviewReason).toBe("thread_conflict");
      expect(decision.candidateIds).toEqual(["app_1", "app_2"]);
    });

    it("3. Missing company: returns review missing_company when no thread match", () => {
      const ctx: MatcherContext = {
        email: {
          ...baseEmail,
          threadId: null,
          aiResult: {
            ...baseEmail.aiResult,
            company: null,
          },
        },
        applications: [existingApp],
        threadToAppIds: new Map(),
        appliedFingerprints: new Map(),
      };

      const decision = matchExtractedEmail(ctx);
      expect(decision.action).toBe("review");
      expect(decision.reviewReason).toBe("missing_company");
    });

    it("3. Missing status: returns review no_status when suggested_status is null", () => {
      const ctx: MatcherContext = {
        email: {
          ...baseEmail,
          threadId: null,
          aiResult: {
            ...baseEmail.aiResult,
            suggested_status: null,
          },
        },
        applications: [existingApp],
        threadToAppIds: new Map(),
        appliedFingerprints: new Map(),
      };

      const decision = matchExtractedEmail(ctx);
      expect(decision.action).toBe("review");
      expect(decision.reviewReason).toBe("no_status");
    });

    it("4. Company + role match: matches by company normalization and role token set", () => {
      const ctx: MatcherContext = {
        email: {
          ...baseEmail,
          threadId: "unknown_thread",
          aiResult: {
            ...baseEmail.aiResult,
            company: "Stripe, Inc.",
            role: "Software Engineer",
          },
        },
        applications: [existingApp],
        threadToAppIds: new Map(),
        appliedFingerprints: new Map(),
      };

      const decision = matchExtractedEmail(ctx);
      expect(decision.action).toBe("update");
      expect(decision.matchMethod).toBe("company_role");
      expect(decision.applicationId).toBe("app_1");
    });

    it("4. Company + role ambiguous match: multiple matching apps for same role", () => {
      const app2: MatcherApplication = {
        ...existingApp,
        id: "app_2",
      };
      const ctx: MatcherContext = {
        email: {
          ...baseEmail,
          threadId: null,
        },
        applications: [existingApp, app2],
        threadToAppIds: new Map(),
        appliedFingerprints: new Map(),
      };

      const decision = matchExtractedEmail(ctx);
      expect(decision.action).toBe("review");
      expect(decision.reviewReason).toBe("ambiguous_match");
      expect(decision.candidateIds).toEqual(["app_1", "app_2"]);
    });

    it("4. Single open match: email has no role, exactly one open app for company", () => {
      const ctx: MatcherContext = {
        email: {
          ...baseEmail,
          threadId: null,
          aiResult: {
            ...baseEmail.aiResult,
            role: null,
          },
        },
        applications: [existingApp],
        threadToAppIds: new Map(),
        appliedFingerprints: new Map(),
      };

      const decision = matchExtractedEmail(ctx);
      expect(decision.action).toBe("update");
      expect(decision.matchMethod).toBe("single_open");
      expect(decision.applicationId).toBe("app_1");
    });

    it("4. Several open apps: email has no role, multiple open apps -> review ambiguous_match", () => {
      const app2: MatcherApplication = {
        ...existingApp,
        id: "app_2",
        role: "Data Analyst",
      };
      const ctx: MatcherContext = {
        email: {
          ...baseEmail,
          threadId: null,
          aiResult: {
            ...baseEmail.aiResult,
            role: null,
          },
        },
        applications: [existingApp, app2],
        threadToAppIds: new Map(),
        appliedFingerprints: new Map(),
      };

      const decision = matchExtractedEmail(ctx);
      expect(decision.action).toBe("review");
      expect(decision.reviewReason).toBe("ambiguous_match");
      expect(decision.candidateIds).toEqual(["app_1", "app_2"]);
    });

    it("4. Terminal only match: email has no role, all company apps are terminal -> terminal_only_match", () => {
      const terminalApp: MatcherApplication = {
        ...existingApp,
        status: "REJECTED",
      };
      const ctx: MatcherContext = {
        email: {
          ...baseEmail,
          threadId: null,
          aiResult: {
            ...baseEmail.aiResult,
            role: null,
          },
        },
        applications: [terminalApp],
        threadToAppIds: new Map(),
        appliedFingerprints: new Map(),
      };

      const decision = matchExtractedEmail(ctx);
      expect(decision.action).toBe("review");
      expect(decision.reviewReason).toBe("terminal_only_match");
      expect(decision.candidateIds).toEqual(["app_1"]);
    });

    it("4. Possible re-application: all company apps terminal and email is CONFIRMATION for same role", () => {
      const terminalApp: MatcherApplication = {
        ...existingApp,
        status: "REJECTED",
      };
      const ctx: MatcherContext = {
        email: {
          ...baseEmail,
          threadId: null,
          aiResult: {
            ...baseEmail.aiResult,
            email_type: "CONFIRMATION",
            suggested_status: "APPLIED",
          },
        },
        applications: [terminalApp],
        threadToAppIds: new Map(),
        appliedFingerprints: new Map(),
      };

      const decision = matchExtractedEmail(ctx);
      expect(decision.action).toBe("review");
      expect(decision.reviewReason).toBe("possible_reapplication");
      expect(decision.candidateIds).toEqual(["app_1"]);
    });

    it("5. No match at all creates: first email with company and status creates", () => {
      const ctx: MatcherContext = {
        email: {
          ...baseEmail,
          threadId: null,
          aiResult: {
            ...baseEmail.aiResult,
            company: "Salesforce",
            role: "Solutions Engineer",
            suggested_status: "REJECTED",
          },
        },
        applications: [existingApp],
        threadToAppIds: new Map(),
        appliedFingerprints: new Map(),
      };

      const decision = matchExtractedEmail(ctx);
      expect(decision.action).toBe("create");
      expect(decision.matchMethod).toBe("create");
    });

    it("6. Stale check: email receivedAt <= lastEmailAt returns timeline_only", () => {
      const ctx: MatcherContext = {
        email: {
          ...baseEmail,
          receivedAt: "2026-10-05T10:00:00Z", // older than lastEmailAt (Oct 10)
        },
        applications: [existingApp],
        threadToAppIds: new Map([["th_1", ["app_1"]]]),
        appliedFingerprints: new Map(),
      };

      const decision = matchExtractedEmail(ctx);
      expect(decision.action).toBe("timeline_only");
      expect(decision.applicationId).toBe("app_1");
    });

    it("7. Terminal check: matched app is in terminal state -> review terminal_state", () => {
      const terminalApp: MatcherApplication = {
        ...existingApp,
        status: "ACCEPTED",
        lastEmailAt: "2026-10-10T10:00:00Z",
      };
      const ctx: MatcherContext = {
        email: {
          ...baseEmail,
          receivedAt: "2026-10-15T10:00:00Z",
          aiResult: {
            ...baseEmail.aiResult,
            email_type: "UPDATE",
          },
        },
        applications: [terminalApp],
        threadToAppIds: new Map([["th_1", ["app_1"]]]),
        appliedFingerprints: new Map(),
      };

      const decision = matchExtractedEmail(ctx);
      expect(decision.action).toBe("review");
      expect(decision.reviewReason).toBe("terminal_state");
      expect(decision.applicationId).toBe("app_1");
    });

    it("Sample applications are never matched", () => {
      const sampleApp: MatcherApplication = {
        ...existingApp,
        id: "sample_app_1",
        isSample: true,
      };
      const ctx: MatcherContext = {
        email: {
          ...baseEmail,
          threadId: null,
        },
        applications: [sampleApp],
        threadToAppIds: new Map(),
        appliedFingerprints: new Map(),
      };

      const decision = matchExtractedEmail(ctx);
      expect(decision.action).toBe("create");
      expect(decision.matchMethod).toBe("create");
    });
  });
});

