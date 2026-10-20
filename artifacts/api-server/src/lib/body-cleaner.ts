/**
 * Body cleaner utility:
 * - HTML to plain text conversion
 * - Quoted reply history stripping
 * - Signature and tracking link removal
 * - Truncation to AI_MAX_BODY_CHARS
 */

export function htmlToText(html: string): string {
  if (!html) return "";

  let text = html;

  // Remove <style> and <script> tags and contents
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");

  // Convert block/line elements to newlines
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n");

  // Strip all other HTML tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)));

  return text;
}

export function stripQuotedReplies(text: string): string {
  if (!text) return "";

  // 1. Cut at "On ... wrote:" or "At ... wrote:"
  const onWroteRegex = /\n\s*(?:On|At)\s+[^\n]{5,150}?\s+wrote:\s*[\s\S]*$/i;
  let cleaned = text.replace(onWroteRegex, "");

  // 2. Cut at "-----Original Message-----" or "--- Original Message ---"
  const origMsgRegex = /\n\s*-{2,}\s*Original Message\s*-{2,}[\s\S]*$/i;
  cleaned = cleaned.replace(origMsgRegex, "");

  // 3. Cut at Outlook style headers "From: ... Sent: ... Subject: ..."
  const outlookHeaderRegex = /\n\s*From:\s+[^\n]+\n\s*Sent:\s+[^\n]+\n\s*To:\s+[^\n]+[\s\S]*$/i;
  cleaned = cleaned.replace(outlookHeaderRegex, "");

  // 4. Strip inline quote lines starting with >
  const lines = cleaned.split("\n");
  const nonQuotedLines: string[] = [];
  for (const line of lines) {
    if (!line.trim().startsWith(">")) {
      nonQuotedLines.push(line);
    }
  }

  return nonQuotedLines.join("\n");
}

export function stripSignatures(text: string): string {
  if (!text) return "";

  let cleaned = text;

  // Standard signature delimiter "-- \n" or "--\n"
  const sigDashRegex = /\n--\s*\n[\s\S]*$/;
  cleaned = cleaned.replace(sigDashRegex, "");

  // Common mobile device signatures
  cleaned = cleaned.replace(/\n\s*Sent from my (?:iPhone|iPad|Android|Galaxy|mobile device)[\s\S]*$/i, "");
  cleaned = cleaned.replace(/\n\s*Sent from Mail for Windows[\s\S]*$/i, "");

  return cleaned;
}

export function stripTrackingLinks(text: string): string {
  if (!text) return "";

  // Simplify URLs with massive tracking queries (e.g. utm_source, tracking tokens > 100 chars)
  return text.replace(/https?:\/\/[^\s<>'"]+/g, (url) => {
    try {
      const parsed = new URL(url);
      const trackingParams = [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "trk",
        "trkEmail",
        "midToken",
        "tracking_id",
      ];
      for (const param of trackingParams) {
        parsed.searchParams.delete(param);
      }
      return parsed.toString();
    } catch {
      return url;
    }
  });
}

export function cleanEmailBody(
  rawTextOrHtml: string,
  isHtml = false,
  maxChars?: number,
): string {
  if (!rawTextOrHtml) return "";

  let content = isHtml ? htmlToText(rawTextOrHtml) : rawTextOrHtml;

  content = stripQuotedReplies(content);
  content = stripSignatures(content);
  content = stripTrackingLinks(content);

  // Normalize whitespace: collapse 3+ newlines to 2, collapse trailing whitespace
  content = content
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();

  // Truncate to AI_MAX_BODY_CHARS
  const limit =
    maxChars ?? (Number(process.env.AI_MAX_BODY_CHARS) || 6000);
  if (content.length > limit) {
    content = content.slice(0, limit);
  }

  return content;
}
