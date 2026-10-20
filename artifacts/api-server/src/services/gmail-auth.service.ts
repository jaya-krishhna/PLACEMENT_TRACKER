import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { eq, and } from "drizzle-orm";
import { db, connectedAccountsTable } from "@workspace/db";
import { encryptToken, decryptToken } from "../lib/encryption";
import { GmailClient } from "../lib/gmail-client";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export interface GmailEnvConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: string;
  appBaseUrl: string;
}

export class GmailAuthService {
  /**
   * Validates required environment variables and returns config.
   * Fails fast with clear error message if any is missing.
   */
  static getEnvConfig(): GmailEnvConfig {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
    const appBaseUrl = process.env.APP_BASE_URL;

    const missing: string[] = [];
    if (!clientId) missing.push("GOOGLE_CLIENT_ID");
    if (!clientSecret) missing.push("GOOGLE_CLIENT_SECRET");
    if (!redirectUri) missing.push("GOOGLE_REDIRECT_URI");
    if (!encryptionKey) missing.push("TOKEN_ENCRYPTION_KEY");
    if (!appBaseUrl) missing.push("APP_BASE_URL");

    if (
      missing.length > 0 ||
      !clientId ||
      !clientSecret ||
      !redirectUri ||
      !encryptionKey ||
      !appBaseUrl
    ) {
      throw new Error(
        `Gmail integration configuration error: Missing required environment variable(s): ${missing.join(", ")}. Please configure them in your .env file.`,
      );
    }

    const trimmedRedirect = redirectUri.trim();
    if (trimmedRedirect.endsWith("/")) {
      throw new Error(
        "GOOGLE_REDIRECT_URI must match exactly without trailing slash (e.g. http://localhost:8080/api/gmail/callback).",
      );
    }

    return {
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      redirectUri: trimmedRedirect,
      encryptionKey: encryptionKey.trim(),
      appBaseUrl: appBaseUrl.trim().replace(/\/$/, ""),
    };
  }

  static createOAuth2Client(): OAuth2Client {
    const config = this.getEnvConfig();
    return new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
  }

  /**
   * Generates a signed, session-bound state token containing the userId and timestamp.
   */
  static generateState(userId: string): string {
    const config = this.getEnvConfig();
    const nonce = randomBytes(16).toString("hex");
    const timestamp = Date.now().toString();
    const payload = `${userId}:${nonce}:${timestamp}`;
    const signature = createHmac("sha256", config.encryptionKey)
      .update(payload)
      .digest("hex");
    return `${Buffer.from(payload).toString("base64url")}.${signature}`;
  }

  /**
   * Validates state token and confirms it belongs to the given user and has not expired.
   */
  static validateState(state: string, expectedUserId: string): boolean {
    try {
      const config = this.getEnvConfig();
      const [payloadB64, signature] = state.split(".");
      if (!payloadB64 || !signature) return false;

      const payload = Buffer.from(payloadB64, "base64url").toString("utf8");
      const [userId, , timestampStr] = payload.split(":");
      if (!userId || userId !== expectedUserId) return false;

      const timestamp = Number(timestampStr);
      if (Number.isNaN(timestamp) || Date.now() - timestamp > 15 * 60 * 1000) {
        // Expired (15 minute validity)
        return false;
      }

      const expectedSig = createHmac("sha256", config.encryptionKey)
        .update(payload)
        .digest("hex");

      const sigBuf = Buffer.from(signature, "hex");
      const expBuf = Buffer.from(expectedSig, "hex");
      return sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
    } catch {
      return false;
    }
  }

  /**
   * Generates the Google OAuth authorization URL.
   * HARD CONSTRAINTS:
   * - scope: https://www.googleapis.com/auth/gmail.readonly ONLY.
   * - access_type=offline, prompt=consent
   */
  static getAuthorizationUrl(userId: string): string {
    const oauth2Client = this.createOAuth2Client();
    const state = this.generateState(userId);

    return oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [GMAIL_READONLY_SCOPE],
      state,
    });
  }

  /**
   * Exchanges authorization code for tokens, encrypts refresh token,
   * reads Google email, and saves connected account to DB.
   */
  static async handleAuthCallback(userId: string, code: string): Promise<string> {
    const oauth2Client = this.createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const googleEmail = await GmailClient.getProfileEmail(oauth2Client);

    let encryptedRefreshToken: string | undefined;
    if (tokens.refresh_token) {
      encryptedRefreshToken = encryptToken(tokens.refresh_token);
    } else {
      // Re-use existing token if Google didn't reissue (should not happen with prompt=consent)
      const [existing] = await db
        .select()
        .from(connectedAccountsTable)
        .where(
          and(
            eq(connectedAccountsTable.userId, userId),
            eq(connectedAccountsTable.provider, "google"),
          ),
        )
        .limit(1);
      encryptedRefreshToken = existing?.encryptedRefreshToken ?? undefined;
    }

    if (!encryptedRefreshToken) {
      throw new Error(
        "Google did not provide a refresh token. Please reconnect with offline access consent.",
      );
    }

    // Upsert connected account record
    const [existing] = await db
      .select({ id: connectedAccountsTable.id })
      .from(connectedAccountsTable)
      .where(
        and(
          eq(connectedAccountsTable.userId, userId),
          eq(connectedAccountsTable.provider, "google"),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(connectedAccountsTable)
        .set({
          googleEmail,
          encryptedRefreshToken,
          status: "active",
        })
        .where(eq(connectedAccountsTable.id, existing.id));
    } else {
      await db.insert(connectedAccountsTable).values({
        userId,
        provider: "google",
        googleEmail,
        encryptedRefreshToken,
        status: "active",
      });
    }

    return googleEmail;
  }

  /**
   * Returns an authorized OAuth2Client for the given user, automatically handling token decryption.
   * If refresh fails with invalid_grant, updates account status to 'needs_reconnect'.
   */
  static async getAuthorizedClient(userId: string): Promise<OAuth2Client> {
    const [account] = await db
      .select()
      .from(connectedAccountsTable)
      .where(
        and(
          eq(connectedAccountsTable.userId, userId),
          eq(connectedAccountsTable.provider, "google"),
        ),
      )
      .limit(1);

    if (!account || !account.encryptedRefreshToken) {
      throw new Error("No connected Gmail account found for user");
    }

    let refreshToken: string;
    try {
      refreshToken = decryptToken(account.encryptedRefreshToken);
    } catch {
      await db
        .update(connectedAccountsTable)
        .set({ status: "needs_reconnect" })
        .where(eq(connectedAccountsTable.id, account.id));
      throw new Error("Invalid token encryption or key. Please reconnect your account.");
    }

    const oauth2Client = this.createOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    // Verify token validity or refresh proactively
    try {
      await oauth2Client.getAccessToken();
    } catch (err: any) {
      const msg = String(err?.message || "").toLowerCase();
      if (
        msg.includes("invalid_grant") ||
        msg.includes("token has been expired or revoked") ||
        err?.response?.data?.error === "invalid_grant"
      ) {
        await db
          .update(connectedAccountsTable)
          .set({ status: "needs_reconnect" })
          .where(eq(connectedAccountsTable.id, account.id));
        throw new Error(
          "Gmail connection expired or was revoked. Please reconnect your account.",
        );
      }
      throw err;
    }

    return oauth2Client;
  }
}
