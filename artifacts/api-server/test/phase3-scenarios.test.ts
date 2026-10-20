import { describe, expect, it } from "vitest";
import {
  matchExtractedEmail,
  type MatcherApplication,
  type MatcherEmailInput,
  type MatcherContext,
} from "../src/services/matcher/application-matcher";
import { computeContentFingerprint } from "../src/services/matcher/normalizer";

describe("Phase 3 End-to-End Fixture Scenarios", () => {
  it("Scenario 1: Salesforce APPLIED (Aug) then REJECTED (Oct) in different threads matches same app", () => {
    // 1. Aug email arrives -> creates application
    const augEmail: MatcherEmailInput = {
      threadId: "salesforce_thread_aug",
      receivedAt: "2026-08-15T10:00:00Z",
      fromAddress: "recruiting@salesforce.com",
      contentFingerprint: "fp_sf_aug",
      aiResult: {
        is_job_related: true,
        email_type: "CONFIRMATION",
        company: "Salesforce",
        role: "Software Engineer",
        suggested_status: "APPLIED",
        stage_detail: "Application received",
      },
    };

    const firstDecision = matchExtractedEmail({
      email: augEmail,
      applications: [],
      threadToAppIds: new Map(),
      appliedFingerprints: new Map(),
    });

    expect(firstDecision.action).toBe("create");
    expect(firstDecision.matchMethod).toBe("create");

    // Simulated created application
    const sfApp: MatcherApplication = {
      id: "sf_app_1",
      companyName: "Salesforce",
      role: "Software Engineer",
      status: "APPLIED",
      lastEmailAt: "2026-08-15T10:00:00Z",
      appliedDate: "2026-08-15",
      isSample: false,
    };

    // 2. Oct email arrives in DIFFERENT thread from same company/role -> updates app to REJECTED
    const octEmail: MatcherEmailInput = {
      threadId: "salesforce_thread_oct_different",
      receivedAt: "2026-10-10T10:00:00Z",
      fromAddress: "recruiting@salesforce.com",
      contentFingerprint: "fp_sf_oct",
      aiResult: {
        is_job_related: true,
        email_type: "REJECTION",
        company: "Salesforce, Inc.",
        role: "Software Engineer",
        suggested_status: "REJECTED",
        stage_detail: "Not moving forward",
        rejection_reason: "High volume of qualified applicants",
      },
    };

    const secondDecision = matchExtractedEmail({
      email: octEmail,
      applications: [sfApp],
      threadToAppIds: new Map([["salesforce_thread_aug", ["sf_app_1"]]]),
      appliedFingerprints: new Map([["fp_sf_aug", "sf_app_1"]]),
    });

    // Successfully matches via company_role and triggers update
    expect(secondDecision.action).toBe("update");
    expect(secondDecision.matchMethod).toBe("company_role");
    expect(secondDecision.applicationId).toBe("sf_app_1");
  });

  it("Scenario 2: Stripe REJECTED-only email creates one REJECTED application directly", () => {
    const stripeRejectionEmail: MatcherEmailInput = {
      threadId: "stripe_thread_1",
      receivedAt: "2026-10-12T14:00:00Z",
      fromAddress: "recruiting@stripe.com",
      contentFingerprint: "fp_stripe_rej",
      aiResult: {
        is_job_related: true,
        email_type: "REJECTION",
        company: "Stripe",
        role: "Backend Engineer",
        suggested_status: "REJECTED",
        stage_detail: "Application declined",
        rejection_reason: "Position filled",
      },
    };

    const decision = matchExtractedEmail({
      email: stripeRejectionEmail,
      applications: [],
      threadToAppIds: new Map(),
      appliedFingerprints: new Map(),
    });

    expect(decision.action).toBe("create");
    expect(decision.matchMethod).toBe("create");
  });

  it("Scenario 3: Two identical emails produce one applied and one needs_review 'duplicate_content'", () => {
    const emailData = {
      fromAddress: "hr@uber.com",
      subject: "Thank you for applying to Uber",
      company: "Uber",
      role: "Software Engineer Intern",
      suggestedStatus: "APPLIED",
      stageDetail: "Application submitted",
      nextAt: null,
    };

    const fp = computeContentFingerprint(emailData);

    const email1: MatcherEmailInput = {
      threadId: "uber_thread_1",
      receivedAt: "2026-10-01T10:00:00Z",
      fromAddress: emailData.fromAddress,
      contentFingerprint: fp,
      aiResult: {
        is_job_related: true,
        email_type: "CONFIRMATION",
        company: emailData.company,
        role: emailData.role,
        suggested_status: emailData.suggestedStatus,
        stage_detail: emailData.stageDetail,
      },
    };

    // First email has not been applied yet
    const decision1 = matchExtractedEmail({
      email: email1,
      applications: [],
      threadToAppIds: new Map(),
      appliedFingerprints: new Map(),
    });
    expect(decision1.action).toBe("create");

    // Second email arrives with identical fingerprint (already applied to app_uber_1)
    const email2: MatcherEmailInput = {
      ...email1,
      threadId: "uber_thread_2",
      receivedAt: "2026-10-01T10:05:00Z",
    };

    const decision2 = matchExtractedEmail({
      email: email2,
      applications: [
        {
          id: "app_uber_1",
          companyName: "Uber",
          role: "Software Engineer Intern",
          status: "APPLIED",
          appliedDate: "2026-10-01",
        },
      ],
      threadToAppIds: new Map([["uber_thread_1", ["app_uber_1"]]]),
      appliedFingerprints: new Map([[fp, "app_uber_1"]]),
    });

    expect(decision2.action).toBe("review");
    expect(decision2.reviewReason).toBe("duplicate_content");
    expect(decision2.applicationId).toBe("app_uber_1");
  });

  it("Scenario 4: An interview email with no role at a company with two open applications lands in review", () => {
    const openApp1: MatcherApplication = {
      id: "app_google_swe",
      companyName: "Google",
      role: "Software Engineer",
      status: "SCREENING",
      appliedDate: "2026-09-01",
    };

    const openApp2: MatcherApplication = {
      id: "app_google_pm",
      companyName: "Google",
      role: "Associate Product Manager",
      status: "TEST",
      appliedDate: "2026-09-10",
    };

    const interviewEmailNoRole: MatcherEmailInput = {
      threadId: "new_thread_google",
      receivedAt: "2026-10-15T09:00:00Z",
      fromAddress: "recruiting@google.com",
      contentFingerprint: "fp_google_interview",
      aiResult: {
        is_job_related: true,
        email_type: "INVITATION",
        company: "Google",
        role: null, // No role in email!
        suggested_status: "INTERVIEW",
        stage_detail: "Next round interview scheduling",
      },
    };

    const decision = matchExtractedEmail({
      email: interviewEmailNoRole,
      applications: [openApp1, openApp2],
      threadToAppIds: new Map(),
      appliedFingerprints: new Map(),
    });

    expect(decision.action).toBe("review");
    expect(decision.reviewReason).toBe("ambiguous_match");
    expect(decision.candidateIds).toEqual(["app_google_swe", "app_google_pm"]);
  });
});

