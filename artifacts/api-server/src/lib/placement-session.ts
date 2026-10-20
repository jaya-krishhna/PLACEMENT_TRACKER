import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import {
  db,
  placementSessionsTable,
  placementUsersTable,
} from "@workspace/db";

export const SESSION_COOKIE = "placement_session";
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type PublicUser = {
  id: string;
  email: string;
  createdAt: Date;
};

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}.${digest.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, digestHex] = stored.split(".");
  if (!saltHex || !digestHex || !/^[a-f0-9]+$/i.test(saltHex + digestHex)) {
    return false;
  }

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(digestHex, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);
  await db.insert(placementSessionsTable).values({
    userId,
    tokenHash: hashSessionToken(token),
    expiresAt,
  });
  return { token, expiresAt };
}

export async function getSessionUser(
  req: Request,
): Promise<PublicUser | null> {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string" || token.length < 40 || token.length > 100) {
    return null;
  }

  const [sessionUser] = await db
    .select({
      id: placementUsersTable.id,
      email: placementUsersTable.email,
      createdAt: placementUsersTable.createdAt,
    })
    .from(placementSessionsTable)
    .innerJoin(
      placementUsersTable,
      eq(placementSessionsTable.userId, placementUsersTable.id),
    )
    .where(
      and(
        eq(placementSessionsTable.tokenHash, hashSessionToken(token)),
        gt(placementSessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return sessionUser ?? null;
}

export function setSessionCookie(
  res: Response,
  token: string,
): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api",
    maxAge: SESSION_MAX_AGE_MS,
  });
}

export function clearSessionCookie(
  res: Response,
): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api",
  });
}
