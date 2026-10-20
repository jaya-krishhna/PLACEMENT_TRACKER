import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  AuthResponse,
  GetCurrentUserResponse,
  LoginBody,
  LoginResponse,
  LogoutResponse,
  RegisterBody,
  RegisterResponse,
} from "@workspace/api-zod";
import {
  db,
  placementApplicationsTable,
  placementSessionsTable,
  placementUsersTable,
} from "@workspace/db";
import {
  clearSessionCookie,
  createSession,
  getSessionUser,
  hashPassword,
  hashSessionToken,
  SESSION_COOKIE,
  setSessionCookie,
  verifyPassword,
} from "../lib/placement-session";

const router: IRouter = Router();

function dateOffset(offset: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email and a password of at least 8 characters." });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();

  const [existingUser] = await db
    .select({ id: placementUsersTable.id })
    .from(placementUsersTable)
    .where(eq(placementUsersTable.email, email))
    .limit(1);

  if (existingUser) {
    res.status(409).json({ error: "An account with that email already exists." });
    return;
  }

  try {
    const user = await db.transaction(async (tx) => {
      const [createdUser] = await tx
        .insert(placementUsersTable)
        .values({ email, passwordHash: hashPassword(parsed.data.password) })
        .returning({
          id: placementUsersTable.id,
          email: placementUsersTable.email,
          createdAt: placementUsersTable.createdAt,
        });

      await tx.insert(placementApplicationsTable).values([
        {
          userId: createdUser.id,
          companyName: "Northstar Labs",
          role: "Frontend Engineer",
          packageLpa: 18,
          location: "Bengaluru",
          appliedDate: dateOffset(-3),
          mode: "Referral",
          status: "INTERVIEW",
          nextDate: dateOffset(2),
          contactName: "Riya Mehta",
          contactEmailOrPhone: "riya@example.com",
          jobLink: "https://example.com/jobs/frontend-engineer",
          notes: "Review React performance patterns and prepare project walkthrough.",
          isSample: true,
        },
        {
          userId: createdUser.id,
          companyName: "TerraNova Analytics",
          role: "Data Analyst",
          packageLpa: 14.5,
          location: "Hyderabad",
          appliedDate: dateOffset(-8),
          mode: "On-campus",
          status: "TEST",
          nextDate: dateOffset(5),
          contactName: null,
          contactEmailOrPhone: null,
          jobLink: "https://example.com/jobs/data-analyst",
          notes: "Online assessment: SQL, probability, and case study.",
          isSample: true,
        },
        {
          userId: createdUser.id,
          companyName: "Meridian Systems",
          role: "Software Engineer",
          packageLpa: 20,
          location: "Pune",
          appliedDate: dateOffset(-12),
          mode: "Job portal",
          status: "REJECTED",
          rejectionRound: "Technical interview",
          rejectionDate: dateOffset(-5),
          rejectionReason: "Good fundamentals; strengthen system design examples.",
          notes: "Practice explaining trade-offs with concise diagrams.",
          isSample: true,
        },
      ]);

      return createdUser;
    });

    const session = await createSession(user.id);
    setSessionCookie(res, session.token);
    res.status(201).json(
      RegisterResponse.parse({
        user: {
          id: user.id,
          email: user.email,
          createdAt: user.createdAt,
        },
      }),
    );
  } catch (error: any) {
    const isConflict =
      error?.code === "23505" ||
      error?.cause?.code === "23505" ||
      String(error?.message || "").includes("unique constraint") ||
      String(error?.message || "").includes("23505") ||
      String(error?.message || "").includes("placement_users_email_unique");
    if (isConflict) {
      res.status(409).json({ error: "An account with that email already exists." });
      return;
    }
    throw error;
  }
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email and password." });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(placementUsersTable)
    .where(eq(placementUsersTable.email, email))
    .limit(1);

  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    res.status(401).json({ error: "Email or password is incorrect." });
    return;
  }

  const session = await createSession(user.id);
  setSessionCookie(res, session.token);
  res.json(
    LoginResponse.parse({
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
      },
    }),
  );
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  res.json(GetCurrentUserResponse.parse(user));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token === "string" && token.length >= 40 && token.length <= 100) {
    await db
      .delete(placementSessionsTable)
      .where(eq(placementSessionsTable.tokenHash, hashSessionToken(token)));
  }
  clearSessionCookie(res);
  res.json(LogoutResponse.parse({ success: true }));
});

export default router;
