import { beforeEach, describe, expect, it, vi } from "vitest";
import { UndoService, UndoError } from "../src/services/matcher/undo.service";
import { db } from "@workspace/db";

// Mock @workspace/db
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

describe("UndoService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes created application and re-queues email event to needs_review", async () => {
    const app = {
      id: "app_1",
      userId: "user_1",
      companyName: "Acme Corp",
      status: "APPLIED",
      updatedAt: new Date("2026-10-15T10:00:00Z"),
    };

    const createdEvent = {
      id: "event_1",
      applicationId: "app_1",
      userId: "user_1",
      emailEventId: "email_event_1",
      kind: "created",
      appliedBy: "auto",
      undoneAt: null,
      createdAt: new Date("2026-10-15T10:00:00Z"),
      after: {
        companyName: "Acme Corp",
        status: "APPLIED",
      },
    };

    let deletedAppId: string | null = null;
    let updatedEmailEvent: any = null;
    let updatedEventRow: any = null;
    let selectCall = 0;

    const mockTx: any = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => {
            selectCall++;
            if (selectCall === 1) {
              return Promise.resolve([app]);
            }
            return {
              orderBy: vi.fn().mockResolvedValue([createdEvent]),
            };
          }),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((vals: any) => {
          if (!updatedEmailEvent) {
            updatedEmailEvent = vals;
          } else {
            updatedEventRow = vals;
          }
          return {
            where: vi.fn().mockResolvedValue([]),
          };
        }),
      })),
      delete: vi.fn(() => ({
        where: vi.fn(() => {
          deletedAppId = "app_1";
          return Promise.resolve([]);
        }),
      })),
    };

    (db.transaction as any).mockImplementation(async (callback: any) => {
      return await callback(mockTx);
    });

    const result = await UndoService.undoEvent({
      userId: "user_1",
      applicationId: "app_1",
      eventId: "event_1",
    });

    expect(result.message).toContain("Application deleted");
    expect(deletedAppId).toBe("app_1");
    expect(updatedEmailEvent.status).toBe("needs_review");
    expect(updatedEmailEvent.reviewReason).toBe("undone");
    expect(updatedEmailEvent.applicationId).toBeNull();
  });

  it("reverts updated application fields and re-queues email event", async () => {
    const app = {
      id: "app_1",
      userId: "user_1",
      companyName: "Acme Corp",
      status: "INTERVIEW",
      stageDetail: "Technical Screen",
      updatedAt: new Date("2026-10-18T10:00:00Z"),
    };

    const updatedEvent = {
      id: "event_2",
      applicationId: "app_1",
      userId: "user_1",
      emailEventId: "email_event_2",
      kind: "updated",
      appliedBy: "auto",
      undoneAt: null,
      createdAt: new Date("2026-10-18T10:00:00Z"),
      before: {
        status: "APPLIED",
        stageDetail: "Initial",
      },
      after: {
        status: "INTERVIEW",
        stageDetail: "Technical Screen",
      },
    };

    let restoredAppFields: any = null;
    let updatedEmailEvent: any = null;
    let selectCall = 0;

    const mockTx: any = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => {
            selectCall++;
            if (selectCall === 1) {
              return Promise.resolve([app]);
            }
            return {
              orderBy: vi.fn().mockResolvedValue([updatedEvent]),
            };
          }),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((vals: any) => {
          if (!restoredAppFields) {
            restoredAppFields = vals;
          } else {
            updatedEmailEvent = vals;
          }
          return {
            where: vi.fn().mockResolvedValue([]),
          };
        }),
      })),
    };

    (db.transaction as any).mockImplementation(async (callback: any) => {
      return await callback(mockTx);
    });

    const result = await UndoService.undoEvent({
      userId: "user_1",
      applicationId: "app_1",
      eventId: "event_2",
    });

    expect(result.message).toContain("Application changes reverted");
    expect(restoredAppFields.status).toBe("APPLIED");
    expect(restoredAppFields.stageDetail).toBe("Initial");
  });

  it("refuses undo when application was manually modified after the event", async () => {
    const app = {
      id: "app_1",
      userId: "user_1",
      companyName: "Acme Corp",
      status: "ACCEPTED", // changed manually from INTERVIEW
      updatedAt: new Date("2026-10-20T10:00:00Z"),
    };

    const updatedEvent = {
      id: "event_2",
      applicationId: "app_1",
      userId: "user_1",
      emailEventId: "email_event_2",
      kind: "updated",
      appliedBy: "auto",
      undoneAt: null,
      createdAt: new Date("2026-10-18T10:00:00Z"),
      before: {
        status: "APPLIED",
      },
      after: {
        status: "INTERVIEW",
      },
    };

    let selectCall = 0;
    const mockTx: any = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => {
            selectCall++;
            if (selectCall === 1) {
              return Promise.resolve([app]);
            }
            return {
              orderBy: vi.fn().mockResolvedValue([updatedEvent]),
            };
          }),
        })),
      })),
    };

    (db.transaction as any).mockImplementation(async (callback: any) => {
      return await callback(mockTx);
    });

    await expect(
      UndoService.undoEvent({
        userId: "user_1",
        applicationId: "app_1",
        eventId: "event_2",
      }),
    ).rejects.toThrow(UndoError);
  });
});
