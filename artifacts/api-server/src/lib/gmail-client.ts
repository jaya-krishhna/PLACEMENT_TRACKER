import { google, type gmail_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { cleanEmailBody } from "./body-cleaner";

export interface GmailUserLabel {
  id: string;
  name: string;
  type?: string;
}

export interface ListMessageIdsResult {
  messageIds: string[];
  nextPageToken?: string;
}

export interface MessageMetadata {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  internalDate: string; // ISO date string or timestamp
}

export class GmailClient {
  /**
   * Retrieves user-created Gmail labels only (type === 'user').
   */
  static async listLabels(auth: OAuth2Client): Promise<GmailUserLabel[]> {
    const gmail = google.gmail({ version: "v1", auth });
    const res = await gmail.users.labels.list({ userId: "me" });
    const labels = res.data.labels || [];

    // Filter to user labels only as required
    return labels
      .filter((l) => l.type === "user" && l.id && l.name)
      .map((l) => ({
        id: l.id!,
        name: l.name!,
        type: l.type || "user",
      }));
  }

  /**
   * Lists message IDs by labelId only.
   * HARD CONSTRAINT: Do NOT use the "q" parameter anywhere.
   */
  static async listMessageIds(
    auth: OAuth2Client,
    labelId: string,
    pageToken?: string,
  ): Promise<ListMessageIdsResult> {
    const gmail = google.gmail({ version: "v1", auth });
    const res = await gmail.users.messages.list({
      userId: "me",
      labelIds: [labelId],
      pageToken,
      maxResults: 50,
      includeSpamTrash: false,
    });

    const messages = res.data.messages || [];
    const messageIds = messages.map((m) => m.id!).filter(Boolean);

    return {
      messageIds,
      nextPageToken: res.data.nextPageToken || undefined,
    };
  }

  /**
   * Fetches metadata only (format=metadata, headers From, Subject, Date).
   * HARD CONSTRAINT: Never fetch or store email bodies.
   */
  static async getMessageMetadata(
    auth: OAuth2Client,
    id: string,
  ): Promise<MessageMetadata> {
    const gmail = google.gmail({ version: "v1", auth });
    const res = await gmail.users.messages.get({
      userId: "me",
      id,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Date"],
    });

    const data = res.data;
    const headers = data.payload?.headers || [];

    let from = "";
    let subject = "";
    let dateHeader = "";

    for (const h of headers) {
      const name = h.name?.toLowerCase();
      if (name === "from") from = h.value || "";
      else if (name === "subject") subject = h.value || "";
      else if (name === "date") dateHeader = h.value || "";
    }

    // Determine internalDate as ISO string
    let isoDate: string;
    if (data.internalDate && !Number.isNaN(Number(data.internalDate))) {
      isoDate = new Date(Number(data.internalDate)).toISOString();
    } else if (dateHeader && !Number.isNaN(Date.parse(dateHeader))) {
      isoDate = new Date(dateHeader).toISOString();
    } else {
      isoDate = new Date().toISOString();
    }

    return {
      id: data.id || id,
      threadId: data.threadId || "",
      from,
      subject,
      internalDate: isoDate,
    };
  }

  /**
   * Fetches user email address from Gmail profile.
   */
  static async getProfileEmail(auth: OAuth2Client): Promise<string> {
    const gmail = google.gmail({ version: "v1", auth });
    const res = await gmail.users.getProfile({ userId: "me" });
    if (!res.data.emailAddress) {
      throw new Error("Unable to read Google email address from profile");
    }
    return res.data.emailAddress;
  }

  /**
   * Fetches full email body for processing.
   * Prefer text/plain; fall back to HTML converted to plain text.
   * Strips quoted reply history, signatures, tracking links, and truncates to AI_MAX_BODY_CHARS.
   * HARD CONSTRAINT: Fetched only at processing time, never stored in DB or logged.
   */
  static async getMessageBody(auth: OAuth2Client, id: string): Promise<string> {
    const gmail = google.gmail({ version: "v1", auth });
    const res = await gmail.users.messages.get({
      userId: "me",
      id,
      format: "full",
    });

    const payload = res.data.payload;
    if (!payload) return "";

    const plainParts: string[] = [];
    const htmlParts: string[] = [];

    const walkParts = (part: gmail_v1.Schema$MessagePart) => {
      const mime = part.mimeType?.toLowerCase();
      if (mime === "text/plain" && part.body?.data) {
        const decoded = Buffer.from(part.body.data, "base64url").toString("utf-8");
        plainParts.push(decoded);
      } else if (mime === "text/html" && part.body?.data) {
        const decoded = Buffer.from(part.body.data, "base64url").toString("utf-8");
        htmlParts.push(decoded);
      }

      if (part.parts && Array.isArray(part.parts)) {
        for (const child of part.parts) {
          walkParts(child);
        }
      }
    };

    walkParts(payload);

    if (plainParts.length > 0) {
      return cleanEmailBody(plainParts.join("\n"), false);
    }
    if (htmlParts.length > 0) {
      return cleanEmailBody(htmlParts.join("\n"), true);
    }

    // Direct payload body if no parts
    if (payload.body?.data) {
      const decoded = Buffer.from(payload.body.data, "base64url").toString("utf-8");
      const isHtml = payload.mimeType?.toLowerCase() === "text/html";
      return cleanEmailBody(decoded, isHtml);
    }

    return "";
  }

  /**
   * Revokes OAuth token on Google's servers.
   */
  static async revokeCredentials(auth: OAuth2Client): Promise<void> {
    try {
      await auth.revokeCredentials();
    } catch {
      // Best-effort revocation; don't throw if already invalid/revoked
    }
  }
}

