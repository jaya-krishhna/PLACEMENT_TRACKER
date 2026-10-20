import React, { useState } from "react";
import {
  useGetReviewQueue,
  useResolveReviewItem,
  type ReviewQueueItem,
  type CandidateApplication,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  Calendar,
  CheckCircle,
  ExternalLink,
  HelpCircle,
  Link2,
  Mail,
  PlusCircle,
  Trash2,
  User,
  XCircle,
} from "lucide-react";

export function formatReviewReason(reason: string): string {
  switch (reason) {
    case "duplicate_content":
      return "Looks identical to an email already applied";
    case "ambiguous_match":
      return "More than one possible matching application";
    case "possible_reapplication":
      return "Possible reapplication for a previously closed role";
    case "terminal_state":
      return "Application is already in a closed/final state";
    case "terminal_only_match":
      return "Only closed applications exist for this company";
    case "thread_conflict":
      return "Email thread links to multiple different applications";
    case "missing_company":
      return "Could not identify the company name from the email";
    case "no_status":
      return "Could not determine an application status from the email";
    case "undone":
      return "Previously undone application event";
    default:
      return reason.replace(/_/g, " ");
  }
}

export function ReviewQueuePage() {
  const queryClient = useQueryClient();
  const { data: reviewItems = [], isLoading, error } = useGetReviewQueue();
  const resolveMutation = useResolveReviewItem();
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [selectedCandidates, setSelectedCandidates] = useState<Record<string, string>>({});

  const handleResolve = async (
    emailEventId: string,
    action: "link" | "create" | "dismiss",
    applicationId?: string,
  ) => {
    try {
      setResolvingId(emailEventId);
      await resolveMutation.mutateAsync({
        emailEventId,
        data: {
          action,
          applicationId,
        },
      });
      // Invalidate relevant queries
      void queryClient.invalidateQueries({ queryKey: ["/api/review"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/gmail/status"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/applications"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/dashboard/summary"] });
    } catch (err: any) {
      alert(err?.message || "Failed to resolve review item");
    } finally {
      setResolvingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-sm text-muted-foreground animate-pulse">Loading review queue...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-destructive">
        <p className="font-semibold">Failed to load review queue</p>
        <p className="mt-1 text-sm text-destructive/80">{(error as any)?.message || "Unknown error"}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Review Queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Emails that need your guidance to link to an existing job application or create a new one.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-500 border border-amber-500/20">
            {reviewItems.length} {reviewItems.length === 1 ? "email needs review" : "emails need review"}
          </span>
        </div>
      </div>

      {reviewItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-card p-12 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
            <CheckCircle size={24} />
          </div>
          <h3 className="mt-4 text-base font-semibold text-foreground">All caught up!</h3>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            No emails currently require manual review. New job emails will be automatically processed.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {reviewItems.map((item: ReviewQueueItem) => {
            const isBusy = resolvingId === item.id;
            const chosenCandidate =
              selectedCandidates[item.id] ||
              (item.candidateApplications && item.candidateApplications.length > 0
                ? item.candidateApplications[0].id
                : undefined);

            return (
              <div
                key={item.id}
                className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4 transition-all"
                data-testid={`review-card-${item.id}`}
              >
                {/* Header: Reason badge & Date */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-500 border border-amber-500/20">
                      <AlertTriangle size={13} />
                      {formatReviewReason(item.reviewReason)}
                    </span>
                    {item.suggestedStatus && (
                      <span className="rounded-md bg-secondary px-2 py-0.5 text-[11px] font-semibold text-foreground/80">
                        Suggested: {item.suggestedStatus}
                      </span>
                    )}
                  </div>
                  {item.receivedAt && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar size={13} />
                      {new Date(item.receivedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>

                {/* Email Info */}
                <div>
                  <h3 className="text-base font-semibold text-foreground">
                    {item.subject || "(No Subject)"}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {item.from && (
                      <span className="flex items-center gap-1">
                        <Mail size={13} />
                        {item.from}
                      </span>
                    )}
                    {item.company && (
                      <span className="flex items-center gap-1 font-medium text-foreground/80">
                        <Building2 size={13} />
                        {item.company}
                      </span>
                    )}
                    {item.role && (
                      <span className="flex items-center gap-1">
                        <User size={13} />
                        {item.role}
                      </span>
                    )}
                  </div>
                  {item.summary && (
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground/90 bg-secondary/40 p-2.5 rounded-lg border border-border/40">
                      {item.summary}
                    </p>
                  )}
                </div>

                {/* Candidate Applications */}
                {item.candidateApplications && item.candidateApplications.length > 0 && (
                  <div className="space-y-2 rounded-xl border border-border/70 bg-secondary/20 p-3.5">
                    <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <Link2 size={13} className="text-primary" />
                      Matching Applications
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {item.candidateApplications.map((cand: CandidateApplication) => (
                        <label
                          key={cand.id}
                          className={`flex cursor-pointer items-start gap-3 rounded-lg border p-2.5 transition-all ${
                            chosenCandidate === cand.id
                              ? "border-primary bg-primary/5 text-foreground"
                              : "border-border/60 hover:bg-secondary/40 text-muted-foreground"
                          }`}
                        >
                          <input
                            type="radio"
                            name={`candidate-${item.id}`}
                            value={cand.id}
                            checked={chosenCandidate === cand.id}
                            onChange={() =>
                              setSelectedCandidates((prev) => ({
                                ...prev,
                                [item.id]: cand.id,
                              }))
                            }
                            className="mt-0.5 accent-primary"
                          />
                          <div className="min-w-0 flex-1 text-xs">
                            <div className="font-semibold text-foreground truncate">
                              {cand.companyName}
                            </div>
                            <div className="truncate text-muted-foreground">
                              {cand.role || "Role not specified"}
                            </div>
                            <div className="mt-1 flex items-center gap-2">
                              <span className="rounded bg-secondary px-1.5 py-0.2 text-[10px] font-medium text-foreground/80">
                                {cand.status}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                Applied: {cand.appliedDate}
                              </span>
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-border/60">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleResolve(item.id, "dismiss")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-all disabled:opacity-50"
                  >
                    <Trash2 size={13} />
                    Dismiss
                  </button>

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleResolve(item.id, "create")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary transition-all disabled:opacity-50"
                  >
                    <PlusCircle size={13} />
                    Create new application
                  </button>

                  {item.candidateApplications && item.candidateApplications.length > 0 && chosenCandidate && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleResolve(item.id, "link", chosenCandidate)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-all shadow-sm disabled:opacity-50"
                    >
                      <Link2 size={13} />
                      Link to selected application
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ReviewQueuePage;

