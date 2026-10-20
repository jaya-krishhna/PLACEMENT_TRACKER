import { Router, type IRouter } from "express";
import {
  and,
  asc,
  count,
  eq,
  gte,
  isNotNull,
  lte,
  notInArray,
} from "drizzle-orm";
import { GetDashboardSummaryResponse } from "@workspace/api-zod";
import { db, placementApplicationsTable } from "@workspace/db";
import { getSessionUser } from "../lib/placement-session";

const router: IRouter = Router();
const appTable = placementApplicationsTable;
const statuses = [
  "APPLIED",
  "SCREENING",
  "TEST",
  "INTERVIEW",
  "ACCEPTED",
  "REJECTED",
  "WITHDRAWN",
] as const;

function dateOffset(offset: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  const [totalRows, statusRows, rejectionRows, upcomingDeadlines] =
    await Promise.all([
      db
        .select({ value: count() })
        .from(appTable)
        .where(eq(appTable.userId, user.id)),
      db
        .select({ status: appTable.status, value: count() })
        .from(appTable)
        .where(eq(appTable.userId, user.id))
        .groupBy(appTable.status),
      db
        .select({ round: appTable.rejectionRound, value: count() })
        .from(appTable)
        .where(
          and(
            eq(appTable.userId, user.id),
            eq(appTable.status, "REJECTED"),
            isNotNull(appTable.rejectionRound),
          ),
        )
        .groupBy(appTable.rejectionRound),
      db
        .select()
        .from(appTable)
        .where(
          and(
            eq(appTable.userId, user.id),
            gte(appTable.nextDate, dateOffset(0)),
            lte(appTable.nextDate, dateOffset(7)),
            notInArray(appTable.status, ["REJECTED", "WITHDRAWN"]),
          ),
        )
        .orderBy(asc(appTable.nextDate))
        .limit(8),
    ]);

  const counts = Object.fromEntries(statuses.map((status) => [status, 0])) as
    Record<(typeof statuses)[number], number>;
  for (const row of statusRows) {
    if (statuses.includes(row.status as (typeof statuses)[number])) {
      counts[row.status as (typeof statuses)[number]] = row.value;
    }
  }

  const rejectionRounds = rejectionRows
    .filter(
      (row): row is typeof row & { round: NonNullable<typeof row.round> } =>
        row.round !== null,
    )
    .map((row) => ({ round: row.round, count: row.value }))
    .sort((left, right) => right.count - left.count);

  res.json(
    GetDashboardSummaryResponse.parse({
      total: totalRows[0]?.value ?? 0,
      counts,
      rejectionRounds,
      upcomingDeadlines,
    }),
  );
});

export default router;
