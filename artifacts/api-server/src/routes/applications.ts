import { Router, type IRouter } from "express";
import {
  and,
  desc,
  eq,
  gte,
  isNotNull,
  lte,
  notInArray,
} from "drizzle-orm";
import {
  CreateApplicationBody,
  CreateApplicationResponse,
  DeleteApplicationParams,
  DeleteApplicationResponse,
  DeleteSampleApplicationsResponse,
  ExportApplicationsResponse,
  GetApplicationParams,
  GetApplicationResponse,
  GetApplicationTimelineParams,
  GetApplicationTimelineResponse,
  ListApplicationsResponse,
  UndoApplicationEventParams,
  UndoApplicationEventResponse,
  UpdateApplicationBody,
  UpdateApplicationParams,
  UpdateApplicationResponse,
} from "@workspace/api-zod";
import {
  db,
  placementApplicationsTable,
  applicationEventsTable,
} from "@workspace/db";
import { getSessionUser } from "../lib/placement-session";
import { UndoService, UndoError } from "../services/matcher/undo.service";

const router: IRouter = Router();
const applicationTable = placementApplicationsTable;

function dateOnly(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function cleanText(value: string | null | undefined): string | null | undefined {
  if (value == null) return value;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function isSafeWebUrl(value: string | null | undefined): boolean {
  if (value == null || value.trim() === "") return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

const csvColumns: Array<[keyof typeof applicationTable.$inferSelect, string]> = [
  ["companyName", "Company"],
  ["role", "Role"],
  ["packageLpa", "Package (LPA)"],
  ["location", "Location"],
  ["appliedDate", "Applied date"],
  ["mode", "Application mode"],
  ["status", "Status"],
  ["nextDate", "Next date / deadline"],
  ["contactName", "Contact person"],
  ["contactEmailOrPhone", "Contact email or phone"],
  ["jobLink", "Job posting link"],
  ["notes", "Notes"],
  ["stageDetail", "Stage detail"],
  ["rejectionRound", "Rejected at round"],
  ["rejectionDate", "Rejection date"],
  ["rejectionReason", "Rejection reason / feedback"],
];

router.get("/applications", async (req, res): Promise<void> => {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  const rows = await db
    .select()
    .from(applicationTable)
    .where(eq(applicationTable.userId, user.id))
    .orderBy(desc(applicationTable.createdAt));

  res.json(ListApplicationsResponse.parse(rows));
});

router.post("/applications", async (req, res): Promise<void> => {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  const parsed = CreateApplicationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the application details and try again." });
    return;
  }

  const companyName = parsed.data.companyName.trim();
  const jobLink = cleanText(parsed.data.jobLink);
  if (!companyName || !isSafeWebUrl(jobLink)) {
    res.status(400).json({
      error: !companyName
        ? "Company name is required."
        : "Job posting links must use http or https.",
    });
    return;
  }

  const [application] = await db
    .insert(applicationTable)
    .values({
      userId: user.id,
      companyName,
      role: cleanText(parsed.data.role),
      packageLpa: parsed.data.packageLpa ?? null,
      location: cleanText(parsed.data.location),
      appliedDate: dateOnly(parsed.data.appliedDate) || new Date().toISOString().slice(0, 10),
      mode: parsed.data.mode,
      status: parsed.data.status,
      nextDate: dateOnly(parsed.data.nextDate),
      contactName: cleanText(parsed.data.contactName),
      contactEmailOrPhone: cleanText(parsed.data.contactEmailOrPhone),
      jobLink,
      notes: cleanText(parsed.data.notes),
      stageDetail: cleanText(parsed.data.stageDetail),
      source: parsed.data.source || "manual",
      lastEmailAt: parsed.data.lastEmailAt ? new Date(parsed.data.lastEmailAt) : null,
      nextAt: parsed.data.nextAt ? new Date(parsed.data.nextAt) : null,
      nextType: cleanText(parsed.data.nextType),
      actionRequired: parsed.data.actionRequired ?? false,
      actionNote: cleanText(parsed.data.actionNote),
      rejectionRound: parsed.data.rejectionRound ?? null,
      rejectionDate: dateOnly(parsed.data.rejectionDate),
      rejectionReason: cleanText(parsed.data.rejectionReason),
    })
    .returning();

  res.status(201).json(CreateApplicationResponse.parse(application));
});

router.get("/applications/export", async (req, res): Promise<void> => {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  const rows = await db
    .select()
    .from(applicationTable)
    .where(eq(applicationTable.userId, user.id))
    .orderBy(desc(applicationTable.createdAt));
  const lines = [
    csvColumns.map(([, label]) => csvCell(label)).join(","),
    ...rows.map((row) =>
      csvColumns.map(([key]) => csvCell(row[key])).join(","),
    ),
  ];
  const csv = `\uFEFF${lines.join("\r\n")}`;
  // CSV values are quoted and formula-leading content is neutralized above.
  ExportApplicationsResponse.parse(csv);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="placement-applications.csv"',
  );
  res.send(csv);
});

router.delete("/applications/samples", async (req, res): Promise<void> => {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  await db
    .delete(applicationTable)
    .where(
      and(
        eq(applicationTable.userId, user.id),
        eq(applicationTable.isSample, true),
      ),
    );
  res.json(DeleteSampleApplicationsResponse.parse({ success: true }));
});

router.get("/applications/:id", async (req, res): Promise<void> => {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  const params = GetApplicationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid application id." });
    return;
  }
  const [application] = await db
    .select()
    .from(applicationTable)
    .where(
      and(
        eq(applicationTable.id, params.data.id),
        eq(applicationTable.userId, user.id),
      ),
    )
    .limit(1);

  if (!application) {
    res.status(404).json({ error: "Application not found." });
    return;
  }
  res.json(GetApplicationResponse.parse(application));
});

router.patch("/applications/:id", async (req, res): Promise<void> => {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  const params = UpdateApplicationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid application id." });
    return;
  }
  const parsed = UpdateApplicationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the application details and try again." });
    return;
  }

  const companyName =
    parsed.data.companyName === undefined
      ? undefined
      : parsed.data.companyName.trim();
  const jobLink = cleanText(parsed.data.jobLink);
  if (
    companyName === "" ||
    !isSafeWebUrl(jobLink)
  ) {
    res.status(400).json({
      error:
        companyName === ""
          ? "Company name is required."
          : "Job posting links must use http or https.",
    });
    return;
  }

  const {
    appliedDate,
    nextDate,
    rejectionDate,
    ...remaining
  } = parsed.data;
  const changes = {
    ...remaining,
    ...(companyName !== undefined ? { companyName } : {}),
    ...(remaining.role !== undefined
      ? { role: cleanText(remaining.role) }
      : {}),
    ...(remaining.location !== undefined
      ? { location: cleanText(remaining.location) }
      : {}),
    ...(remaining.contactName !== undefined
      ? { contactName: cleanText(remaining.contactName) }
      : {}),
    ...(remaining.contactEmailOrPhone !== undefined
      ? { contactEmailOrPhone: cleanText(remaining.contactEmailOrPhone) }
      : {}),
    ...(remaining.jobLink !== undefined ? { jobLink } : {}),
    ...(remaining.notes !== undefined
      ? { notes: cleanText(remaining.notes) }
      : {}),
    ...(remaining.rejectionReason !== undefined
      ? { rejectionReason: cleanText(remaining.rejectionReason) }
      : {}),
    ...(remaining.stageDetail !== undefined
      ? { stageDetail: cleanText(remaining.stageDetail) }
      : {}),
    ...(remaining.nextType !== undefined
      ? { nextType: cleanText(remaining.nextType) }
      : {}),
    ...(remaining.actionNote !== undefined
      ? { actionNote: cleanText(remaining.actionNote) }
      : {}),
    ...(remaining.actionRequired !== undefined
      ? { actionRequired: remaining.actionRequired }
      : {}),
    ...(remaining.source !== undefined
      ? { source: remaining.source }
      : {}),
    ...(remaining.lastEmailAt !== undefined
      ? { lastEmailAt: remaining.lastEmailAt ? new Date(remaining.lastEmailAt) : null }
      : {}),
    ...(remaining.nextAt !== undefined
      ? { nextAt: remaining.nextAt ? new Date(remaining.nextAt) : null }
      : {}),
    ...(appliedDate !== undefined && dateOnly(appliedDate) !== null
      ? { appliedDate: dateOnly(appliedDate)! }
      : {}),
    ...(nextDate !== undefined
      ? {
          nextDate: dateOnly(nextDate),
          ...(remaining.nextAt === undefined
            ? { nextAt: null, nextAtHasTime: false }
            : {}),
        }
      : {}),
    ...(remaining.nextAtHasTime !== undefined
      ? { nextAtHasTime: remaining.nextAtHasTime }
      : {}),
    ...(rejectionDate !== undefined
      ? { rejectionDate: dateOnly(rejectionDate) }
      : {}),
    ...(remaining.status && remaining.status !== "REJECTED"
      ? {
          rejectionRound: null,
          rejectionDate: null,
          rejectionReason: null,
        }
      : {}),
    updatedAt: new Date(),
  };

  const [application] = await db
    .update(applicationTable)
    .set(changes)
    .where(
      and(
        eq(applicationTable.id, params.data.id),
        eq(applicationTable.userId, user.id),
      ),
    )
    .returning();

  if (!application) {
    res.status(404).json({ error: "Application not found." });
    return;
  }
  res.json(UpdateApplicationResponse.parse(application));
});

router.get("/applications/:id/timeline", async (req, res): Promise<void> => {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  const params = GetApplicationTimelineParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid application id." });
    return;
  }
  const [app] = await db
    .select({ id: applicationTable.id })
    .from(applicationTable)
    .where(
      and(
        eq(applicationTable.id, params.data.id),
        eq(applicationTable.userId, user.id),
      ),
    );
  if (!app) {
    res.status(404).json({ error: "Application not found." });
    return;
  }

  const events = await db
    .select()
    .from(applicationEventsTable)
    .where(
      and(
        eq(applicationEventsTable.applicationId, params.data.id),
        eq(applicationEventsTable.userId, user.id),
      ),
    )
    .orderBy(
      desc(applicationEventsTable.occurredAt),
      desc(applicationEventsTable.createdAt),
    );

  res.json(GetApplicationTimelineResponse.parse(events));
});

router.post("/applications/:id/events/:eventId/undo", async (req, res): Promise<void> => {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  const params = UndoApplicationEventParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid parameters." });
    return;
  }

  try {
    const result = await UndoService.undoEvent({
      userId: user.id,
      applicationId: params.data.id,
      eventId: params.data.eventId,
    });
    res.json(UndoApplicationEventResponse.parse({ success: true }));
  } catch (err: any) {
    if (err instanceof UndoError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: "Failed to undo application event." });
  }
});

router.delete("/applications/:id", async (req, res): Promise<void> => {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  const params = DeleteApplicationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid application id." });
    return;
  }

  const [deleted] = await db
    .delete(applicationTable)
    .where(
      and(
        eq(applicationTable.id, params.data.id),
        eq(applicationTable.userId, user.id),
      ),
    )
    .returning({ id: applicationTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Application not found." });
    return;
  }
  res.json(DeleteApplicationResponse.parse({ success: true }));
});

export default router;
