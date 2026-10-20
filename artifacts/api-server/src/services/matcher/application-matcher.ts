import { normalizeCompany, rolesMatch } from "./normalizer";

export const TERMINAL_STATUSES = new Set(["ACCEPTED", "REJECTED", "WITHDRAWN"]);

export interface MatcherApplication {
  id: string;
  companyName: string;
  role?: string | null;
  status: string;
  isSample?: boolean;
  lastEmailAt?: Date | string | null;
  appliedDate?: string | null;
  createdAt?: Date | string | null;
}

export interface MatcherEmailInput {
  threadId?: string | null;
  receivedAt: Date | string;
  fromAddress?: string | null;
  contentFingerprint?: string | null;
  aiResult: {
    is_job_related: boolean;
    email_type: string;
    company?: string | null;
    role?: string | null;
    suggested_status?: string | null;
    stage_detail?: string | null;
    next_at?: string | null;
    next_at_has_time?: boolean;
    next_type?: string | null;
    action_required?: boolean;
    action_note?: string | null;
    rejection_reason?: string | null;
    summary?: string | null;
  };
}

export interface MatchDecision {
  action: "create" | "update" | "review" | "timeline_only";
  applicationId?: string;
  matchMethod: string;
  reviewReason?: string;
  candidateIds?: string[];
}

export interface MatcherContext {
  email: MatcherEmailInput;
  applications: MatcherApplication[];
  threadToAppIds: Map<string, string[]>;
  appliedFingerprints: Map<string, string>; // fingerprint -> applicationId
}

export function matchExtractedEmail(ctx: MatcherContext): MatchDecision {
  const { email, threadToAppIds, appliedFingerprints } = ctx;
  const applications = (ctx.applications || []).filter((a) => !a.isSample);
  const emailReceivedTime = new Date(email.receivedAt).getTime();

  // 1. Duplicate content: if content_fingerprint equals an already applied email
  if (email.contentFingerprint && appliedFingerprints.has(email.contentFingerprint)) {
    const appliedAppId = appliedFingerprints.get(email.contentFingerprint);
    return {
      action: "review",
      reviewReason: "duplicate_content",
      applicationId: appliedAppId,
      candidateIds: appliedAppId ? [appliedAppId] : [],
      matchMethod: "duplicate",
    };
  }

  let candidate: MatcherApplication | null = null;
  let matchMethod = "none";

  // 2. Thread match: if thread_id maps to applications
  if (email.threadId && threadToAppIds.has(email.threadId)) {
    const mappedIds = Array.from(new Set(threadToAppIds.get(email.threadId) || []));
    if (mappedIds.length === 1) {
      const found = applications.find((a) => a.id === mappedIds[0]);
      if (found) {
        candidate = found;
        matchMethod = "thread";
      }
    } else if (mappedIds.length > 1) {
      return {
        action: "review",
        reviewReason: "thread_conflict",
        candidateIds: mappedIds,
        matchMethod: "thread",
      };
    }
  }

  // 3. Missing data check (only if no thread match)
  if (!candidate) {
    if (!email.aiResult.company || !email.aiResult.company.trim()) {
      return {
        action: "review",
        reviewReason: "missing_company",
        matchMethod: "none",
      };
    }
    if (!email.aiResult.suggested_status || !email.aiResult.suggested_status.trim()) {
      return {
        action: "review",
        reviewReason: "no_status",
        matchMethod: "none",
      };
    }

    // 4. Company + role match
    const normEmailCompany = normalizeCompany(email.aiResult.company);
    const companyMatches = applications.filter(
      (app) => normalizeCompany(app.companyName) === normEmailCompany,
    );

    if (companyMatches.length > 0) {
      const emailHasRole = Boolean(email.aiResult.role && email.aiResult.role.trim());

      if (emailHasRole) {
        const roleMatches = companyMatches.filter((app) =>
          rolesMatch(app.role, email.aiResult.role),
        );

        if (roleMatches.length === 1) {
          const matchedApp = roleMatches[0];
          const isTerminal = TERMINAL_STATUSES.has((matchedApp.status || "").toUpperCase());
          const isConfirmation = email.aiResult.email_type === "CONFIRMATION";
          const allCompanyTerminal = companyMatches.every((app) =>
            TERMINAL_STATUSES.has((app.status || "").toUpperCase()),
          );

          if (isTerminal && isConfirmation && allCompanyTerminal) {
            return {
              action: "review",
              reviewReason: "possible_reapplication",
              candidateIds: [matchedApp.id],
              matchMethod: "company_role",
            };
          }

          candidate = matchedApp;
          matchMethod = "company_role";
        } else if (roleMatches.length > 1) {
          return {
            action: "review",
            reviewReason: "ambiguous_match",
            candidateIds: roleMatches.map((a) => a.id),
            matchMethod: "company_role",
          };
        } else {
          // One or more applications for same company exist, but none for this role -> create
          return {
            action: "create",
            matchMethod: "create",
          };
        }
      } else {
        // Email has no role
        const openCompanyApps = companyMatches.filter(
          (app) => !TERMINAL_STATUSES.has((app.status || "").toUpperCase()),
        );

        if (openCompanyApps.length === 1) {
          candidate = openCompanyApps[0];
          matchMethod = "single_open";
        } else if (openCompanyApps.length > 1) {
          return {
            action: "review",
            reviewReason: "ambiguous_match",
            candidateIds: openCompanyApps.map((a) => a.id),
            matchMethod: "single_open",
          };
        } else {
          // Zero non-terminal, but some terminal ones exist
          return {
            action: "review",
            reviewReason: "terminal_only_match",
            candidateIds: companyMatches.map((a) => a.id),
            matchMethod: "terminal_only",
          };
        }
      }
    } else {
      // No application for company at all -> create
      return {
        action: "create",
        matchMethod: "create",
      };
    }
  }

  // 5. No match at all with company and status -> create
  if (!candidate) {
    return {
      action: "create",
      matchMethod: "create",
    };
  }

  // 6. Stale check for matched application
  if (candidate.lastEmailAt) {
    const lastTime = new Date(candidate.lastEmailAt).getTime();
    if (!Number.isNaN(lastTime) && emailReceivedTime <= lastTime) {
      return {
        action: "timeline_only",
        applicationId: candidate.id,
        matchMethod,
      };
    }
  }

  // 7. Terminal check for matched application
  if (TERMINAL_STATUSES.has((candidate.status || "").toUpperCase())) {
    return {
      action: "review",
      reviewReason: "terminal_state",
      applicationId: candidate.id,
      candidateIds: [candidate.id],
      matchMethod,
    };
  }

  // 8. Otherwise update
  return {
    action: "update",
    applicationId: candidate.id,
    matchMethod,
  };
}
