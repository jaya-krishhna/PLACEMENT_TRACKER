import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  senderRulesTable,
  emailEventsTable,
  type SenderRule,
} from "@workspace/db";

export type SenderStatus = "pending" | "approved" | "excluded";

export function parseFromHeader(from: string): { address: string; domain: string } {
  let address = "";
  const match = from.match(/<([^>]+)>/);
  if (match) {
    address = match[1].trim();
  } else {
    const tokens = from.trim().split(/\s+/);
    const withAt = tokens.find((t) => t.includes("@"));
    address = (withAt || from).replace(/[<>()"']/g, "").trim();
  }

  address = address.toLowerCase();
  const atIdx = address.lastIndexOf("@");
  const domain = atIdx !== -1 ? address.slice(atIdx + 1).toLowerCase() : "";

  return { address, domain };
}

export class SenderService {
  /**
   * Resolves the status for an incoming message given sender address and domain.
   *
   * PRECEDENCE RULES:
   * 1. An address rule overrides a domain rule.
   * 2. Exclude beats approve at the same level.
   * 3. Subdomains match a domain rule (e.g. jobs.company.com matches company.com).
   * 4. No rule means pending, and upsert a pending "detected" rule.
   */
  static async resolveStatus(
    userId: string,
    address: string,
    domain: string,
  ): Promise<{ status: SenderStatus; rule?: SenderRule }> {
    const cleanAddress = address.trim().toLowerCase();
    const cleanDomain = domain.trim().toLowerCase();

    // 1. Check address rules first
    const addressRules = await db
      .select()
      .from(senderRulesTable)
      .where(
        and(
          eq(senderRulesTable.userId, userId),
          eq(senderRulesTable.kind, "address"),
          eq(senderRulesTable.value, cleanAddress),
        ),
      );

    if (addressRules.length > 0) {
      const hasExclude = addressRules.some((r) => r.status === "excluded");
      if (hasExclude) {
        const rule = addressRules.find((r) => r.status === "excluded")!;
        return { status: "excluded", rule };
      }
      const hasApprove = addressRules.some((r) => r.status === "approved");
      if (hasApprove) {
        const rule = addressRules.find((r) => r.status === "approved")!;
        return { status: "approved", rule };
      }
      return { status: "pending", rule: addressRules[0] };
    }

    // 2. Check domain rules (including subdomain matches)
    const allDomainRules = await db
      .select()
      .from(senderRulesTable)
      .where(
        and(
          eq(senderRulesTable.userId, userId),
          eq(senderRulesTable.kind, "domain"),
        ),
      );

    const matchingDomainRules = allDomainRules.filter((r) => {
      const ruleVal = r.value.toLowerCase();
      return cleanDomain === ruleVal || cleanDomain.endsWith(`.${ruleVal}`);
    });

    if (matchingDomainRules.length > 0) {
      const hasExclude = matchingDomainRules.some((r) => r.status === "excluded");
      if (hasExclude) {
        const rule = matchingDomainRules.find((r) => r.status === "excluded")!;
        return { status: "excluded", rule };
      }
      const hasApprove = matchingDomainRules.some((r) => r.status === "approved");
      if (hasApprove) {
        const rule = matchingDomainRules.find((r) => r.status === "approved")!;
        return { status: "approved", rule };
      }
      return { status: "pending", rule: matchingDomainRules[0] };
    }

    // 3. No rule exists -> status is pending, and upsert a pending detected rule
    const [upserted] = await db
      .insert(senderRulesTable)
      .values({
        userId,
        kind: "address",
        value: cleanAddress,
        status: "pending",
        source: "detected",
        messageCount: 0,
      })
      .onConflictDoUpdate({
        target: [senderRulesTable.userId, senderRulesTable.kind, senderRulesTable.value],
        set: { updatedAt: new Date() },
      })
      .returning();

    return { status: "pending", rule: upserted };
  }

  /**
   * When a sender rule changes status, updates that user's matching email_events:
   * - approved turns pending_sender into queued
   * - excluded turns pending_sender or queued into ignored
   */
  static async onRuleStatusChanged(
    userId: string,
    rule: SenderRule,
    newStatus: SenderStatus,
  ): Promise<void> {
    const isAddress = rule.kind === "address";
    const targetValue = rule.value.toLowerCase();

    if (newStatus === "approved") {
      // Approved turns pending_sender into queued
      if (isAddress) {
        await db
          .update(emailEventsTable)
          .set({ status: "queued" })
          .where(
            and(
              eq(emailEventsTable.userId, userId),
              eq(emailEventsTable.status, "pending_sender"),
              eq(emailEventsTable.fromAddress, targetValue),
            ),
          );
      } else {
        // Domain rule matches exact domain or subdomain
        await db
          .update(emailEventsTable)
          .set({ status: "queued" })
          .where(
            and(
              eq(emailEventsTable.userId, userId),
              eq(emailEventsTable.status, "pending_sender"),
              sql`(${emailEventsTable.fromDomain} = ${targetValue} OR ${emailEventsTable.fromDomain} LIKE ${'%.' + targetValue})`,
            ),
          );
      }
    } else if (newStatus === "excluded") {
      // Excluded turns pending_sender or queued into ignored
      if (isAddress) {
        await db
          .update(emailEventsTable)
          .set({ status: "ignored" })
          .where(
            and(
              eq(emailEventsTable.userId, userId),
              inArray(emailEventsTable.status, ["pending_sender", "queued"]),
              eq(emailEventsTable.fromAddress, targetValue),
            ),
          );
      } else {
        await db
          .update(emailEventsTable)
          .set({ status: "ignored" })
          .where(
            and(
              eq(emailEventsTable.userId, userId),
              inArray(emailEventsTable.status, ["pending_sender", "queued"]),
              sql`(${emailEventsTable.fromDomain} = ${targetValue} OR ${emailEventsTable.fromDomain} LIKE ${'%.' + targetValue})`,
            ),
          );
      }
    }
  }
}

