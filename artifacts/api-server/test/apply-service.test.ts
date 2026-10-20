import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApplyService,
  formatDateInTimezone,
  mapRejectionRound,
} from "../src/services/matcher/apply.service";
import { isGenericContact } from "../src/services/matcher/normalizer";
import { db } from "@workspace/db";

// Mock the db transaction
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    db: {
      ...actual.db,
      transaction: vi.fn(),
    },
  };
});

describe("ApplyService Helpers & Field Logic", () => {
  describe("formatDateInTimezone", () => {
    it("converts UTC timestamps to date string in specified timezone", () => {
      // 2026-10-15T20:00:00Z in UTC is 2026-10-16 in Asia/Kolkata (UTC+5:30)
      const istDate = formatDateInTimezone("2026-10-15T20:00:00Z", "Asia/Kolkata");
      expect(istDate).toBe("2026-10-16");

      const utcDate = formatDateInTimezone("2026-10-15T20:00:00Z", "UTC");
      expect(utcDate).toBe("2026-10-15");
    });
  });

  describe("mapRejectionRound", () => {
    it("maps previous status and stageDetail to valid fixed rejection rounds", () => {
      expect(mapRejectionRound("APPLIED")).toBe("Resume shortlisting");
      expect(mapRejectionRound("SCREENING")).toBe("Resume shortlisting");
      expect(mapRejectionRound("TEST", "Coding assessment round 1")).toBe("Coding round");
      expect(mapRejectionRound("TEST", "Online aptitude test")).toBe("Aptitude/online test");
      expect(mapRejectionRound("INTERVIEW", "Technical system design")).toBe("Technical interview");
      expect(mapRejectionRound("INTERVIEW", "HR behavioral round")).toBe("HR interview");
      expect(mapRejectionRound("INTERVIEW", "Culture fit conversation")).toBe("HR interview");
      expect(mapRejectionRound(null)).toBeNull();
    });
  });

  describe("isGenericContact", () => {
    it("identifies generic sender emails and names", () => {
      expect(isGenericContact("Talent Acquisition", "jobs@company.com")).toBe(true);
      expect(isGenericContact("HR Team", "contact@company.com")).toBe(true);
      expect(isGenericContact("Jane Doe", "no-reply@company.com")).toBe(true);
      expect(isGenericContact("Recruiting Team", "noreply@company.com")).toBe(true);
      expect(isGenericContact("Jane Smith", "jane.smith@company.com")).toBe(false);
    });
  });

  describe("applyDecision transactional execution", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("creates a new application with proper field snapshots and defaults", async () => {
      let insertedAppValues: any = null;
      let insertedEventValues: any = null;
      let updatedEmailValues: any = null;

      const mockTx: any = {
        insert: vi.fn((table: any) => ({
          values: vi.fn((vals: any) => {
            if (table.name === "placement_applications" || !insertedAppValues) {
              insertedAppValues = vals;
              return {
                returning: vi.fn().mockResolvedValue([
                  {
                    id: "new_app_123",
                    ...vals,
                  },
                ]),
              };
            }
            insertedEventValues = vals;
            return {
              returning: vi.fn().mockResolvedValue([vals]),
            };
          }),
        })),
        update: vi.fn(() => ({
          set: vi.fn((vals: any) => {
            updatedEmailValues = vals;
            return {
              where: vi.fn().mockResolvedValue([]),
            };
          }),
        })),
      };

      db.transaction.mockImplementation(async (callback: any) => {
        return await callback(mockTx);
      });

      const emailEvent: any = {
        id: "email_event_1",
        receivedAt: new Date("2026-10-15T10:00:00Z"),
        fromAddress: "recruiter@acme.com",
        subject: "Welcome to Acme",
        aiResult: {
          company: "Acme Corp",
          role: "Software Engineer",
          suggested_status: "APPLIED",
          stage_detail: "Initial application",
          action_required: true,
          action_note: "Submit transcripts",
          summary: "Application confirmation email",
        },
      };

      const result = await ApplyService.applyDecision({
        userId: "user_1",
        emailEvent,
        decision: { action: "create", matchMethod: "create" },
        appliedBy: "auto",
      });

      expect(result.action).toBe("create");
      expect(result.applicationId).toBe("new_app_123");

      // Verify created application values
      expect(insertedAppValues.companyName).toBe("Acme Corp");
      expect(insertedAppValues.role).toBe("Software Engineer");
      expect(insertedAppValues.status).toBe("APPLIED");
      expect(insertedAppValues.mode).toBe("Unknown");
      expect(insertedAppValues.source).toBe("email");
      expect(insertedAppValues.actionRequired).toBe(true);
      expect(insertedAppValues.actionNote).toBe("Submit transcripts");
      expect(insertedAppValues.notes).toBeNull();
      expect(insertedAppValues.isSample).toBe(false);

      // Verify application_events record
      expect(insertedEventValues.kind).toBe("created");
      expect(insertedEventValues.toStatus).toBe("APPLIED");
      expect(insertedEventValues.fromStatus).toBeNull();
      expect(insertedEventValues.summary).toBe("Application confirmation email");
      expect(insertedEventValues.after).toBeDefined();

      // Verify email_events update
      expect(updatedEmailValues.status).toBe("applied");
      expect(updatedEmailValues.applicationId).toBe("new_app_123");
    });

    it("updates existing application and records before/after diffs only for changed fields", async () => {
      const existingApp: any = {
        id: "app_456",
        userId: "user_1",
        companyName: "Acme Corp",
        role: "Software Engineer",
        status: "APPLIED",
        stageDetail: "Applied online",
        appliedDate: "2026-10-01",
        source: "email",
        lastEmailAt: new Date("2026-10-01T10:00:00Z"),
        actionRequired: false,
        actionNote: null,
        nextAt: null,
        nextDate: null,
        nextAtHasTime: false,
        nextType: null,
      };

      let updatedAppFields: any = null;
      let insertedEventValues: any = null;

      const mockTx: any = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([existingApp]),
          })),
        })),
        insert: vi.fn((table: any) => ({
          values: vi.fn((vals: any) => {
            insertedEventValues = vals;
            return {
              returning: vi.fn().mockResolvedValue([vals]),
            };
          }),
        })),
        update: vi.fn(() => ({
          set: vi.fn((vals: any) => {
            if (!updatedAppFields) {
              updatedAppFields = vals;
            }
            return {
              where: vi.fn().mockResolvedValue([]),
            };
          }),
        })),
      };

      db.transaction.mockImplementation(async (callback: any) => {
        return await callback(mockTx);
      });

      const emailEvent: any = {
        id: "email_event_2",
        receivedAt: new Date("2026-10-18T10:00:00Z"),
        fromAddress: "hr@acme.com",
        subject: "Invitation to Technical Interview",
        aiResult: {
          company: "Acme Corp",
          role: "Software Engineer",
          suggested_status: "INTERVIEW",
          stage_detail: "Technical Screen",
          next_at: "2026-10-22T14:30:00Z",
          next_at_has_time: true,
          next_type: "Technical Interview",
          action_required: true,
          action_note: "Confirm time slot",
          summary: "Invited to interview on Oct 22",
        },
      };

      const result = await ApplyService.applyDecision({
        userId: "user_1",
        emailEvent,
        decision: { action: "update", applicationId: "app_456", matchMethod: "company_role" },
        appliedBy: "auto",
      });

      expect(result.action).toBe("update");
      expect(result.applicationId).toBe("app_456");

      // Verify app updates
      expect(updatedAppFields.status).toBe("INTERVIEW");
      expect(updatedAppFields.stageDetail).toBe("Technical Screen");
      expect(updatedAppFields.actionRequired).toBe(true);
      expect(updatedAppFields.actionNote).toBe("Confirm time slot");

      // Verify diff snapshot in application_events
      expect(insertedEventValues.before.status).toBe("APPLIED");
      expect(insertedEventValues.after.status).toBe("INTERVIEW");
      expect(insertedEventValues.kind).toBe("updated");
    });
  });
});
