import { createHash } from "node:crypto";

/**
 * Normalizes company name for robust matching:
 * - lowercase, trim
 * - strips leading "the "
 * - strips punctuation
 * - strips common legal/business suffixes (inc, llc, ltd, pvt, private, limited, corp, technologies)
 */
export function normalizeCompany(name?: string | null): string {
  if (!name) return "";

  let norm = name.toLowerCase().trim();

  // Strip leading "the "
  if (norm.startsWith("the ")) {
    norm = norm.slice(4).trim();
  }

  // Remove punctuation (commas, periods, dashes, quotes, etc.)
  norm = norm.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, " ").replace(/\s+/g, " ").trim();

  // Strip suffixes when at word boundaries at end of string
  const suffixRegex = /\b(inc|llc|ltd|pvt|private|limited|corp|corporation|technologies|technology)\b/g;
  norm = norm.replace(suffixRegex, "").replace(/\s+/g, " ").trim();

  return norm;
}

/**
 * Normalizes role string into a sorted set of distinct lowercase tokens.
 * e.g. "Software Engineer, Intern" -> ["engineer", "intern", "software"]
 * "Intern - Software Engineer" -> ["engineer", "intern", "software"]
 */
export function getRoleTokens(role?: string | null): string[] {
  if (!role) return [];
  const cleaned = role
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return [];

  const tokens = cleaned
    .split(" ")
    .filter((t) => t.length > 0)
    .sort();

  // Return unique sorted tokens
  return Array.from(new Set(tokens));
}

export function rolesMatch(roleA?: string | null, roleB?: string | null): boolean {
  if (!roleA && !roleB) return true;
  if (!roleA || !roleB) return false;

  const tokensA = getRoleTokens(roleA);
  const tokensB = getRoleTokens(roleB);

  if (tokensA.length === 0 || tokensB.length === 0) return false;
  if (tokensA.length !== tokensB.length) return false;

  return tokensA.every((token, idx) => token === tokensB[idx]);
}

/**
 * Determines whether a contact name or email is generic (and should not overwrite existing).
 */
export function isGenericContact(name?: string | null, emailOrPhone?: string | null): boolean {
  if (emailOrPhone) {
    const lowerEmail = emailOrPhone.toLowerCase();
    if (
      lowerEmail.includes("no-reply") ||
      lowerEmail.includes("noreply") ||
      lowerEmail.includes("donotreply")
    ) {
      return true;
    }
  }

  if (name) {
    const lowerName = name.toLowerCase().trim();
    const genericPhrases = [
      "recruiting team",
      "talent acquisition",
      "hr team",
      "careers",
      "hiring team",
      "campus hiring",
      "people team",
      "talent team",
      "recruiter",
    ];
    if (genericPhrases.some((phrase) => lowerName.includes(phrase))) {
      return true;
    }
  }

  return false;
}

/**
 * Computes sha256 fingerprint for duplicate email detection.
 * sha256 of (from_address, subject, company key, role key, suggested_status, normalized stage_detail, next_at)
 */
export function computeContentFingerprint(params: {
  fromAddress?: string | null;
  subject?: string | null;
  company?: string | null;
  role?: string | null;
  suggestedStatus?: string | null;
  stageDetail?: string | null;
  nextAt?: string | null;
}): string {
  const normFrom = (params.fromAddress || "").toLowerCase().trim();
  const normSubject = (params.subject || "").toLowerCase().trim();
  const normCompany = normalizeCompany(params.company);
  const normRole = getRoleTokens(params.role).join(" ");
  const normStatus = (params.suggestedStatus || "").toUpperCase().trim();
  const normStage = (params.stageDetail || "").toLowerCase().trim();
  const normNextAt = (params.nextAt || "").trim();

  const payload = [
    normFrom,
    normSubject,
    normCompany,
    normRole,
    normStatus,
    normStage,
    normNextAt,
  ].join("|");

  return createHash("sha256").update(payload, "utf8").digest("hex");
}

