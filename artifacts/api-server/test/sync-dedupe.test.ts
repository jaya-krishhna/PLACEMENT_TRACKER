import { describe, it, expect, vi } from "vitest";
import { SyncService } from "../src/services/sync.service";
import { GmailClient } from "../src/lib/gmail-client";
import { GmailAuthService } from "../src/services/gmail-auth.service";
import { SenderService } from "../src/services/sender.service";
import { db, emailEventsTable } from "@workspace/db";

describe("Sync Deduplication by gmail_message_id", () => {
  const userId = "11111111-1111-1111-1111-111111111111";

  it("should stop paginating and not duplicate messages already in email_events", async () => {
    // Mock connected account and existing events
    vi.spyOn(db, "select").mockImplementation(((fields: any) => ({
      from: (table: any) => ({
        where: () => {
          if (table === emailEventsTable) {
            // User already has message 'msg-2' and 'msg-3'
            return Promise.resolve([
              { gmailMessageId: "msg-2" },
              { gmailMessageId: "msg-3" },
            ]);
          }
          const accs = [
            {
              id: "acc-1",
              userId,
              provider: "google",
              status: "active",
              labelId: "Label_Work",
              labelName: "Work",
            },
          ];
          const queryObj = {
            limit: () => Promise.resolve(accs),
            then: (resolve: any, reject: any) => Promise.resolve(accs).then(resolve, reject),
          };
          return queryObj;
        },
      }),
    })) as any);

    // Mock OAuth client
    vi.spyOn(GmailAuthService, "getAuthorizedClient").mockResolvedValue({} as any);

    // Mock labels list
    vi.spyOn(GmailClient, "listLabels").mockResolvedValue([
      { id: "Label_Work", name: "Work", type: "user" },
    ]);

    // Mock listMessageIds: newest-first returns msg-1, msg-2, msg-3
    vi.spyOn(GmailClient, "listMessageIds").mockResolvedValue({
      messageIds: ["msg-1", "msg-2", "msg-3"],
    });

    const getMetadataSpy = vi
      .spyOn(GmailClient, "getMessageMetadata")
      .mockResolvedValue({
        id: "msg-1",
        threadId: "thread-1",
        from: "Acme Careers <jobs@acme.com>",
        subject: "Interview Invitation",
        internalDate: new Date().toISOString(),
      });

    vi.spyOn(SenderService, "resolveStatus").mockResolvedValue({
      status: "approved",
    });

    vi.spyOn(db, "insert").mockImplementation((() => ({
      values: () => ({
        onConflictDoNothing: () => Promise.resolve({ rowCount: 1 }),
        returning: () => Promise.resolve([{ id: "new-rule" }]),
      }),
    })) as any);

    vi.spyOn(db, "update").mockImplementation((() => ({
      set: () => ({
        where: () => Promise.resolve({ rowCount: 1 }),
      }),
    })) as any);

    const result = await SyncService.syncMetadata(userId);

    // Only 'msg-1' should be fetched and processed because msg-2 was already known
    expect(result.newMessages).toBe(1);
    expect(result.queued).toBe(1);
    expect(getMetadataSpy).toHaveBeenCalledTimes(1);
    expect(getMetadataSpy).toHaveBeenCalledWith(expect.anything(), "msg-1");

    vi.restoreAllMocks();
  });
});
