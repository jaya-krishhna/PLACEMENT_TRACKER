import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Clock,
  Filter,
  HelpCircle,
  Inbox,
  Info,
  LoaderCircle,
  Mail,
  Plus,
  RefreshCw,
  Shield,
  Sparkles,
  Tag,
  Trash2,
  Users,
} from "lucide-react";
import {
  getGetGmailConnectUrlQueryKey,
  getGetGmailEventsQueryKey,
  getGetGmailLabelsQueryKey,
  getGetGmailSendersQueryKey,
  getGetGmailStatusQueryKey,
  useCreateGmailSender,
  useDisconnectGmail,
  useGetGmailConnectUrl,
  useGetGmailEvents,
  useGetGmailLabels,
  useGetGmailSenders,
  useGetGmailStatus,
  useProcessGmailEmails,
  useReprocessGmailEvent,
  useSyncGmail,
  useUpdateGmailLabel,
  useUpdateGmailSender,
  useApplyGmailEmails,
} from "@workspace/api-client-react";
import type { EmailEventItem, SenderRule } from "@workspace/api-client-react";

function formatRelativeTime(dateStr?: string | null) {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);

  if (diffSec < 45) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function GmailSettingsPage() {
  const qc = useQueryClient();
  const statusQuery = useGetGmailStatus();
  const labelsQuery = useGetGmailLabels({
    query: {
      enabled: Boolean(statusQuery.data?.connected),
      queryKey: getGetGmailLabelsQueryKey(),
    },
  });
  const [senderFilter, setSenderFilter] = useState<"pending" | "approved" | "excluded">("pending");
  const sendersQuery = useGetGmailSenders(
    { status: senderFilter },
    {
      query: {
        enabled: Boolean(statusQuery.data?.connected),
        queryKey: getGetGmailSendersQueryKey({ status: senderFilter }),
      },
    },
  );

  const connectQuery = useGetGmailConnectUrl({
    query: {
      enabled: false,
      queryKey: getGetGmailConnectUrlQueryKey(),
    },
  });
  const disconnectMutation = useDisconnectGmail();
  const updateLabelMutation = useUpdateGmailLabel();
  const updateSenderMutation = useUpdateGmailSender();
  const createSenderMutation = useCreateGmailSender();
  const syncMutation = useSyncGmail();
  const processMutation = useProcessGmailEmails();
  const reprocessMutation = useReprocessGmailEvent();
  const applyMutation = useApplyGmailEmails();

  // State
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [deleteEmailData, setDeleteEmailData] = useState(false);
  const [selectedLabelId, setSelectedLabelId] = useState("");
  const [showFilterInstructions, setShowFilterInstructions] = useState(false);
  const [newSenderKind, setNewSenderKind] = useState<"domain" | "address">("domain");
  const [newSenderValue, setNewSenderValue] = useState("");
  const [addSenderError, setAddSenderError] = useState<string | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [eventFilter, setEventFilter] = useState<string>("all");
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [processSummary, setProcessSummary] = useState<string | null>(null);
  const [rateLimitNotice, setRateLimitNotice] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<{
    applied: number;
    created: number;
    updated: number;
    historical: number;
    needsReview: number;
  } | null>(null);

  const eventsQuery = useGetGmailEvents(
    { status: eventFilter === "all" ? undefined : eventFilter, page: 1, limit: 50 },
    {
      query: {
        enabled: Boolean(statusQuery.data?.connected),
        queryKey: getGetGmailEventsQueryKey({
          status: eventFilter === "all" ? undefined : eventFilter,
          page: 1,
          limit: 50,
        }),
      },
    },
  );

  const lastFocusRef = useRef(0);

  // Throttled window focus refetch (once every 30 seconds)
  useEffect(() => {
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusRef.current > 30_000) {
        lastFocusRef.current = now;
        qc.invalidateQueries({ queryKey: getGetGmailStatusQueryKey() });
        if (statusQuery.data?.connected) {
          qc.invalidateQueries({ queryKey: getGetGmailSendersQueryKey() });
        }
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [qc, statusQuery.data?.connected]);

  // Sync selectedLabelId with status
  useEffect(() => {
    if (statusQuery.data?.label?.id) {
      setSelectedLabelId(statusQuery.data.label.id);
    }
  }, [statusQuery.data?.label?.id]);

  const status = statusQuery.data;
  const isConnected = Boolean(status?.connected);
  const needsReconnect = status?.accountStatus === "needs_reconnect";

  // Step completions
  const step1Done = isConnected && !needsReconnect;
  const step2Done = step1Done && Boolean(status?.label?.id);
  const step3Done =
    step1Done &&
    Boolean(
      (status?.senderCounts?.approved || 0) + (status?.senderCounts?.excluded || 0) > 0 ||
        status?.senderCounts?.pending === 0,
    );
  const step4Done = step2Done && Boolean(status?.lastSyncedAt);
  const step5Done =
    step4Done &&
    Boolean(
      (status?.emailEventCounts?.extracted || 0) > 0 ||
        (status?.emailEventCounts?.queued === 0 && (status?.emailEventCounts?.extracted || 0) > 0),
    );
  const step6Done =
    step5Done &&
    Boolean(
      (status?.emailEventCounts?.applied || 0) > 0 ||
        (status?.emailEventCounts?.extracted === 0 && (status?.emailEventCounts?.applied || 0) > 0),
    );

  const handleApplyEmails = async () => {
    try {
      const res = await applyMutation.mutateAsync();
      setApplyResult(res);
      void qc.invalidateQueries({ queryKey: getGetGmailStatusQueryKey() });
      void qc.invalidateQueries({ queryKey: getGetGmailEventsQueryKey() });
      void qc.invalidateQueries({ queryKey: ["/api/applications"] });
      void qc.invalidateQueries({ queryKey: ["/api/review"] });
      void qc.invalidateQueries({ queryKey: ["/api/dashboard/summary"] });
    } catch (err: any) {
      alert(`Unable to apply emails: ${err.message}`);
    }
  };

  // Handlers
  const handleConnect = async () => {
    try {
      const res = await connectQuery.refetch();
      if (res.data?.url) {
        window.location.href = res.data.url;
      }
    } catch (err: any) {
      alert(`Unable to start Google authorization: ${err.message}`);
    }
  };

  const handleDisconnect = () => {
    disconnectMutation.mutate(
      { params: { deleteEmailData } },
      {
        onSuccess: () => {
          setShowDisconnectModal(false);
          setDeleteEmailData(false);
          qc.invalidateQueries({ queryKey: getGetGmailStatusQueryKey() });
          qc.invalidateQueries({ queryKey: getGetGmailLabelsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetGmailSendersQueryKey() });
        },
      },
    );
  };

  const handleLabelChange = (newId: string) => {
    setSelectedLabelId(newId);
    if (!newId) return;
    updateLabelMutation.mutate(
      { data: { labelId: newId } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetGmailStatusQueryKey() });
        },
      },
    );
  };

  const handleSenderStatus = (rule: SenderRule, newStatus: "pending" | "approved" | "excluded") => {
    updateSenderMutation.mutate(
      { id: rule.id, data: { status: newStatus } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetGmailSendersQueryKey() });
          qc.invalidateQueries({ queryKey: getGetGmailStatusQueryKey() });
        },
      },
    );
  };

  const handleAddSender = (e: React.FormEvent) => {
    e.preventDefault();
    setAddSenderError(null);

    let val = newSenderValue.trim().toLowerCase();
    if (!val) {
      setAddSenderError(
        newSenderKind === "domain"
          ? "Please enter a domain name"
          : "Please enter an email address",
      );
      return;
    }

    if (newSenderKind === "domain") {
      if (val.startsWith("@")) {
        val = val.replace(/^@+/, "").trim();
      }
      if (!val || val.includes(" ") || !val.includes(".")) {
        setAddSenderError("Please enter a valid domain (e.g. example.com)");
        return;
      }
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(val)) {
        setAddSenderError("Please enter a valid email address (e.g. recruiter@example.com)");
        return;
      }
    }

    createSenderMutation.mutate(
      { data: { kind: newSenderKind, value: val } },
      {
        onSuccess: () => {
          setNewSenderValue("");
          setAddSenderError(null);
          qc.invalidateQueries({ queryKey: getGetGmailSendersQueryKey() });
          qc.invalidateQueries({ queryKey: getGetGmailStatusQueryKey() });
          sendersQuery.refetch();
        },
        onError: (err: any) => {
          const message =
            err?.response?.data?.message || err?.message || "Failed to add sender rule";
          setAddSenderError(message);
        },
      },
    );
  };

  const handleSyncNow = () => {
    setSyncFeedback(null);
    syncMutation.mutate(undefined, {
      onSuccess: (data: any) => {
        const newCount = data.newMessages ?? data.new ?? 0;
        setSyncFeedback(
          `Sync complete: ${newCount} new email(s) found (${data.queued ?? 0} queued, ${data.pendingSender ?? data.pending_sender ?? 0} pending sender review, ${data.ignored ?? 0} ignored).`,
        );
        qc.invalidateQueries({ queryKey: getGetGmailStatusQueryKey() });
        qc.invalidateQueries({ queryKey: getGetGmailSendersQueryKey() });
        qc.invalidateQueries({ queryKey: getGetGmailEventsQueryKey() });
      },
      onError: (err: any) => {
        setSyncFeedback(`Sync failed: ${err.message}`);
      },
    });
  };

  const handleProcessEmails = () => {
    setProcessSummary(null);
    setRateLimitNotice(null);
    processMutation.mutate(
      { data: { limit: 50 } },
      {
        onSuccess: (data: any) => {
          if (data.rateLimited) {
            setRateLimitNotice(
              "AI provider rate limit reached. The remaining emails stay safely queued and will resume on the next run.",
            );
          }
          setProcessSummary(
            `Processing complete: ${data.extracted} extracted, ${data.ignored} ignored, ${data.failed} failed, ${data.remaining} remaining.`,
          );
          qc.invalidateQueries({ queryKey: getGetGmailStatusQueryKey() });
          qc.invalidateQueries({ queryKey: getGetGmailEventsQueryKey() });
        },
        onError: (err: any) => {
          setProcessSummary(`Processing error: ${err?.message || "Failed to process emails"}`);
        },
      },
    );
  };

  const handleReprocess = (e: React.MouseEvent, eventId: string) => {
    e.stopPropagation();
    reprocessMutation.mutate(
      { id: eventId },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetGmailEventsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetGmailStatusQueryKey() });
        },
        onError: (err: any) => {
          alert(`Reprocess failed: ${err?.message || "Unknown error"}`);
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      {/* Needs Reconnect Warning Banner */}
      {needsReconnect && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-amber-200 sm:flex-row sm:items-center sm:justify-between"
          data-testid="banner-needs-reconnect"
        >
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/20 text-amber-400">
              <AlertTriangle size={20} />
            </span>
            <div>
              <p className="font-bold text-amber-300">Gmail connection expired or was revoked</p>
              <p className="text-xs text-amber-200/80">
                Google requires reconnecting your account to resume background sync and sender detection.
              </p>
            </div>
          </div>
          <button
            onClick={handleConnect}
            disabled={connectQuery.isFetching}
            className="btn bg-amber-500 text-stone-950 hover:bg-amber-400"
            data-testid="button-reconnect-gmail"
          >
            {connectQuery.isFetching ? <LoaderCircle size={15} className="animate-spin" /> : null}
            Reconnect Gmail
          </button>
        </div>
      )}

      {/* Header */}
      <div>
        <p className="mono text-[10px] uppercase tracking-[.19em] text-primary">Automation & Sync</p>
        <h1 className="display mt-2 text-3xl font-bold tracking-tight sm:text-4xl" data-testid="heading-gmail-settings">
          Gmail Integration
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Automatically detect recruiting correspondence, track interview stages, and keep your placement
          notebook up to date directly from your Gmail inbox.
        </p>
      </div>

      {/* Onboarding Checklist Container */}
      <div className="space-y-5">
        {/* ─── STEP 1: CONNECT GMAIL ─── */}
        <section
          className={`panel p-6 transition-all ${step1Done ? "border-primary/20" : "border-border"}`}
          data-testid="step-connect-gmail"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  step1Done
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-secondary text-muted-foreground"
                }`}
              >
                {step1Done ? <Check size={16} strokeWidth={2.6} /> : "1"}
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold">Connect your Google Account</h2>
                  {step1Done && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                      Connected
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Read-only access strictly limited to fetching metadata from your chosen label. We never read or
                  store email bodies.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-5 border-t border-border pt-4">
            {isConnected ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Mail size={18} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Signed in as</p>
                    <p className="font-semibold" data-testid="text-connected-email">
                      {status?.googleEmail || "Google Account"}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowDisconnectModal(true)}
                  className="btn btn-subtle text-xs text-destructive hover:bg-destructive/10"
                  data-testid="button-open-disconnect"
                >
                  <Trash2 size={14} /> Disconnect
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  onClick={handleConnect}
                  disabled={connectQuery.isFetching}
                  className="btn btn-primary"
                  data-testid="button-connect-gmail"
                >
                  {connectQuery.isFetching ? <LoaderCircle size={15} className="animate-spin" /> : null}
                  <Mail size={16} />
                  Connect Gmail
                </button>
                <span className="text-xs text-muted-foreground">OAuth 2.0 (read-only)</span>
              </div>
            )}
          </div>
        </section>



        {/* ─── STEP 2: CHOOSE LABEL ─── */}
        <section
          className={`panel p-6 transition-all ${
            !step1Done ? "opacity-60" : step2Done ? "border-primary/20" : "border-border"
          }`}
          data-testid="step-choose-label"
        >
          <div className="flex items-start gap-4">
            <span
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold ${
                step2Done
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-secondary text-muted-foreground"
              }`}
            >
              {step2Done ? <Check size={16} strokeWidth={2.6} /> : "2"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold">Choose a Gmail label to monitor</h2>
                {step2Done && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                    Label set
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Placement Tracker retrieves emails exclusively from this label. Emails outside this label are never
                scanned.
              </p>
            </div>
          </div>

          <div className="mt-5 border-t border-border pt-4">
            {!step1Done ? (
              <p className="text-xs text-muted-foreground">Complete Step 1 to select your Gmail label.</p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <label className="relative min-w-0 flex-1 sm:max-w-md">
                    <Tag
                      size={15}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                    <select
                      value={selectedLabelId}
                      onChange={(e) => handleLabelChange(e.target.value)}
                      disabled={updateLabelMutation.isPending || labelsQuery.isLoading}
                      className="field appearance-none pl-9 pr-8 text-sm"
                      data-testid="select-gmail-label"
                    >
                      <option value="">Select a label…</option>
                      {labelsQuery.data?.map((label) => (
                        <option key={label.id} value={label.id}>
                          {label.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={14}
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                  </label>
                  {updateLabelMutation.isPending && (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <LoaderCircle size={14} className="animate-spin" /> Saving label…
                    </span>
                  )}
                </div>

                {/* Collapsible Instruction Card for Creating Gmail Filter */}
                <div className="rounded-xl border border-border bg-card/60 p-4" data-testid="card-filter-instructions">
                  <button
                    type="button"
                    onClick={() => setShowFilterInstructions(!showFilterInstructions)}
                    className="flex w-full items-center justify-between text-left text-xs font-bold text-foreground hover:text-primary"
                    data-testid="toggle-filter-instructions"
                  >
                    <span className="flex items-center gap-2">
                      <HelpCircle size={15} className="text-primary" />
                      How to set up an automatic Gmail filter for this label
                    </span>
                    {showFilterInstructions ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>

                  {showFilterInstructions && (
                    <div className="mt-4 space-y-3 text-xs leading-5 text-muted-foreground">
                      <p>Follow these 3 quick steps inside Gmail to automatically route career emails:</p>
                      <ol className="list-decimal space-y-1.5 pl-4 text-foreground/90">
                        <li>
                          In Gmail, click the <strong>Settings gear ⚙️</strong> &gt; <strong>See all settings</strong>{" "}
                          &gt; <strong>Filters and Blocked Addresses</strong> &gt;{" "}
                          <strong>Create a new filter</strong>.
                        </li>
                        <li>
                          In the <strong>From</strong> field, specify job portals or company domains (e.g.{" "}
                          <code className="rounded bg-muted px-1.5 py-0.5 mono text-[11px]">
                            *@greenhouse.io OR *@lever.co OR *@ashbyhq.com OR *@myworkday.com
                          </code>
                          ).
                        </li>
                        <li>
                          Click <strong>Create filter</strong>, check{" "}
                          <strong>Apply the label: [Your Chosen Label]</strong>, and ensure you check the box below!
                        </li>
                      </ol>

                      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-foreground/90 space-y-1.5">
                        <p className="font-semibold text-primary">💡 Important Pro-tips:</p>
                        <ul className="list-disc pl-4 space-y-1">
                          <li>
                            <strong>Filter by domain rather than single address:</strong> Filter for{" "}
                            <code className="mono text-[11px]">@company.com</code> rather than specific recruiter
                            addresses so emails from multiple interviewers are captured.
                          </li>
                          <li>
                            <strong>Tick &quot;Also apply filter to matching conversations&quot;:</strong> This ensures
                            older application updates already in your inbox get labeled and synced immediately!
                          </li>
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>



        {/* ─── STEP 3: REVIEW SENDERS ─── */}
        <section
          className={`panel p-6 transition-all ${
            !step1Done ? "opacity-60" : step3Done ? "border-primary/20" : "border-border"
          }`}
          data-testid="step-review-senders"
        >
          <div className="flex items-start gap-4">
            <span
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold ${
                step3Done
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-secondary text-muted-foreground"
              }`}
            >
              {step3Done ? <Check size={16} strokeWidth={2.6} /> : "3"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold">Review & approve recruiting senders</h2>
                <span className="mono text-xs text-muted-foreground">
                  ({status?.senderCounts?.pending || 0} pending review)
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Approve legitimate employers and exclude newsletters or automated notifications.
              </p>
            </div>
          </div>

          <div className="mt-5 border-t border-border pt-4">
            {!step1Done ? (
              <p className="text-xs text-muted-foreground">Connect your account first to review senders.</p>
            ) : (
              <div className="space-y-4">
                {/* Manual Add Sender Form */}
                <div className="space-y-2">
                  <form
                    onSubmit={handleAddSender}
                    className="rounded-xl border border-border bg-card/50 p-3 space-y-2"
                    data-testid="form-add-sender"
                  >
                    <div className="flex items-center gap-2 w-full min-w-0">
                      <label className="text-xs font-semibold text-muted-foreground whitespace-nowrap shrink-0">
                        Add rule:
                      </label>
                      <select
                        value={newSenderKind}
                        onChange={(e) => {
                          setNewSenderKind(e.target.value as any);
                          if (addSenderError) setAddSenderError(null);
                        }}
                        className="field !w-36 !py-1.5 text-xs shrink-0"
                        data-testid="select-sender-kind"
                      >
                        <option value="domain">Domain</option>
                        <option value="address">Email Address</option>
                      </select>
                      <input
                        type="text"
                        value={newSenderValue}
                        onChange={(e) => {
                          setNewSenderValue(e.target.value);
                          if (addSenderError) setAddSenderError(null);
                        }}
                        placeholder={newSenderKind === "domain" ? "example.com" : "recruiter@example.com"}
                        className="field !w-auto flex-1 min-w-0 !py-1.5 text-xs"
                        data-testid="input-sender-value"
                      />
                      <button
                        type="submit"
                        disabled={createSenderMutation.isPending}
                        className="btn btn-primary !py-1.5 !px-3 text-xs whitespace-nowrap shrink-0"
                        data-testid="button-add-sender"
                      >
                        {createSenderMutation.isPending ? (
                          <LoaderCircle size={14} className="animate-spin" />
                        ) : (
                          <Plus size={14} />
                        )}
                        Add approved sender
                      </button>
                    </div>
                  </form>

                  {addSenderError && (
                    <p className="text-xs text-destructive px-1" role="alert" data-testid="error-add-sender">
                      {addSenderError}
                    </p>
                  )}

                  <p className="text-xs text-muted-foreground px-1" data-testid="text-sender-rules-helper">
                    Rules only apply to emails already in your selected Gmail label. To receive emails from a new sender, update your Gmail filter so it applies the label.
                  </p>
                </div>

                {/* Senders Filter Tabs */}
                <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
                  <div className="flex gap-1">
                    {(["pending", "approved", "excluded"] as const).map((tab) => {
                      const countVal = status?.senderCounts?.[tab] || 0;
                      return (
                        <button
                          key={tab}
                          onClick={() => setSenderFilter(tab)}
                          className={`btn !px-3 !py-1 text-xs capitalize ${
                            senderFilter === tab ? "btn-primary" : "btn-quiet"
                          }`}
                          data-testid={`tab-senders-${tab}`}
                        >
                          {tab} ({countVal})
                        </button>
                      );
                    })}
                  </div>
                  {sendersQuery.isFetching && <LoaderCircle size={14} className="animate-spin text-muted-foreground" />}
                </div>

                {/* Senders Table */}
                {sendersQuery.data?.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground" data-testid="empty-senders">
                    No {senderFilter} sender rules found.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full text-left text-xs" data-testid="table-senders">
                      <thead className="border-b border-border bg-muted/40 font-semibold text-muted-foreground">
                        <tr>
                          <th className="p-3">Type</th>
                          <th className="p-3">Sender / Domain</th>
                          <th className="p-3">Messages</th>
                          <th className="p-3">Source</th>
                          <th className="p-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {sendersQuery.data?.map((rule) => (
                          <tr key={rule.id} className="hover:bg-muted/20" data-testid={`sender-row-${rule.id}`}>
                            <td className="p-3">
                              <span className="rounded bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-secondary-foreground">
                                {rule.kind}
                              </span>
                            </td>
                            <td className="p-3 font-semibold text-foreground">
                              {rule.value}
                            </td>
                            <td className="p-3 text-muted-foreground">{rule.messageCount}</td>
                            <td className="p-3 text-[11px] text-muted-foreground capitalize">{rule.source}</td>
                            <td className="p-3 text-right">
                              <div className="inline-flex gap-1.5">
                                {rule.status !== "approved" && (
                                  <button
                                    onClick={() => handleSenderStatus(rule, "approved")}
                                    className="btn btn-subtle !px-2.5 !py-1 !text-[11px] text-[#38805e] dark:text-[#8bc9a5] hover:bg-[#38805e]/10"
                                    data-testid={`button-approve-${rule.id}`}
                                  >
                                    Approve
                                  </button>
                                )}
                                {rule.status !== "excluded" && (
                                  <button
                                    onClick={() => handleSenderStatus(rule, "excluded")}
                                    className="btn btn-subtle !px-2.5 !py-1 !text-[11px] text-[#a8403b] hover:bg-destructive/10"
                                    data-testid={`button-exclude-${rule.id}`}
                                  >
                                    Exclude
                                  </button>
                                )}
                                {rule.status !== "pending" && (
                                  <button
                                    onClick={() => handleSenderStatus(rule, "pending")}
                                    className="btn btn-quiet !px-2 !py-1 !text-[11px]"
                                    data-testid={`button-reset-${rule.id}`}
                                  >
                                    Reset
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>



        {/* ─── STEP 4: SYNC & STATUS ─── */}
        <section
          className={`panel p-6 transition-all ${
            !step2Done ? "opacity-60" : step4Done ? "border-primary/20" : "border-border"
          }`}
          data-testid="step-sync"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  step4Done
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-secondary text-muted-foreground"
                }`}
              >
                {step4Done ? <Check size={16} strokeWidth={2.6} /> : "4"}
              </span>
              <div>
                <h2 className="text-lg font-bold">Synchronize & Review Queue</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  The scheduler automatically scans every 10 minutes. You can also trigger an on-demand sync at any
                  time.
                </p>
              </div>
            </div>

            <button
              onClick={handleSyncNow}
              disabled={!step2Done || syncMutation.isPending}
              className="btn btn-primary !py-2 !px-4 text-xs shrink-0"
              data-testid="button-sync-now"
            >
              <RefreshCw size={14} className={syncMutation.isPending ? "animate-spin" : ""} />
              {syncMutation.isPending ? "Syncing…" : "Sync now"}
            </button>
          </div>

          <div className="mt-5 border-t border-border pt-4">
            {syncFeedback && (
              <div
                className={`mb-4 rounded-xl border p-3 text-xs ${
                  syncFeedback.startsWith("Sync complete")
                    ? "border-primary/20 bg-primary/10 text-primary"
                    : "border-destructive/20 bg-destructive/10 text-destructive"
                }`}
                data-testid="sync-feedback-banner"
              >
                {syncFeedback}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-border bg-card/60 p-4">
                <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Clock size={14} /> Last Synced
                </span>
                <p className="mt-2 text-base font-bold" data-testid="text-last-synced">
                  {formatRelativeTime(status?.lastSyncedAt)}
                </p>
              </div>

              <div className="rounded-xl border border-border bg-card/60 p-4">
                <span className="flex items-center gap-2 text-xs font-medium text-[#38805e] dark:text-[#8bc9a5]">
                  <Check size={14} /> Queued for Processing
                </span>
                <p className="display mt-2 text-2xl font-bold" data-testid="count-queued-emails">
                  {status?.emailEventCounts?.queued || 0}
                </p>
              </div>

              <div className="rounded-xl border border-border bg-card/60 p-4">
                <span className="flex items-center gap-2 text-xs font-medium text-[#a87835] dark:text-[#e2bd78]">
                  <Users size={14} /> Pending Sender Review
                </span>
                <p className="display mt-2 text-2xl font-bold" data-testid="count-pending-sender-emails">
                  {status?.emailEventCounts?.pending_sender || 0}
                </p>
              </div>

              <div className="rounded-xl border border-border bg-card/60 p-4">
                <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Shield size={14} /> Excluded / Ignored
                </span>
                <p className="display mt-2 text-2xl font-bold" data-testid="count-ignored-emails">
                  {status?.emailEventCounts?.ignored || 0}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ─── STEP 5: PROCESS EMAILS ─── */}
        <section
          className={`panel p-6 transition-all ${
            !step2Done ? "opacity-60" : step5Done ? "border-primary/20" : "border-border"
          }`}
          data-testid="step-process-emails"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  step5Done
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-secondary text-muted-foreground"
                }`}
              >
                {step5Done ? <Check size={16} strokeWidth={2.6} /> : "5"}
              </span>
              <div>
                <h2 className="text-lg font-bold">Process emails</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Extract job details, interview schedules, and application updates using AI.
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground/80 flex items-center gap-1.5" data-testid="privacy-note">
                  <Shield size={12} className="text-primary" />
                  Email text is sent to Google&apos;s Gemini API for processing.
                </p>
              </div>
            </div>

            <button
              onClick={handleProcessEmails}
              disabled={
                !step2Done ||
                processMutation.isPending ||
                ((status?.emailEventCounts?.queued || 0) === 0 && (status?.emailEventCounts?.failed || 0) === 0)
              }
              className="btn btn-primary !py-2 !px-4 text-xs shrink-0"
              data-testid="button-process-emails"
            >
              <Sparkles size={14} className={processMutation.isPending ? "animate-spin" : ""} />
              {processMutation.isPending ? "Processing with AI…" : "Process emails"}
            </button>
          </div>

          <div className="mt-5 border-t border-border pt-4 space-y-4">
            {/* Rate Limit Callout */}
            {rateLimitNotice && (
              <div
                role="alert"
                className="flex items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-200"
                data-testid="banner-rate-limit"
              >
                <AlertTriangle size={16} className="text-amber-400 shrink-0" />
                <span>{rateLimitNotice}</span>
              </div>
            )}

            {/* Processing Summary */}
            {processSummary && (
              <div
                className={`rounded-xl border p-3 text-xs ${
                  processSummary.startsWith("Processing complete")
                    ? "border-primary/20 bg-primary/10 text-primary"
                    : "border-destructive/20 bg-destructive/10 text-destructive"
                }`}
                data-testid="process-summary-banner"
              >
                {processSummary}
              </div>
            )}

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-border bg-card/60 p-3">
                <span className="text-[11px] font-medium text-muted-foreground">Extracted (Job-Related)</span>
                <p className="display mt-1 text-xl font-bold text-primary" data-testid="count-extracted-emails">
                  {status?.emailEventCounts?.extracted || 0}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card/60 p-3">
                <span className="text-[11px] font-medium text-muted-foreground">Queued for AI</span>
                <p className="display mt-1 text-xl font-bold" data-testid="count-queued-process-emails">
                  {status?.emailEventCounts?.queued || 0}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card/60 p-3">
                <span className="text-[11px] font-medium text-muted-foreground">Failed / Retries</span>
                <p className="display mt-1 text-xl font-bold text-destructive" data-testid="count-failed-emails">
                  {status?.emailEventCounts?.failed || 0}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card/60 p-3">
                <span className="text-[11px] font-medium text-muted-foreground">Ignored (Non-Job)</span>
                <p className="display mt-1 text-xl font-bold text-muted-foreground">
                  {status?.emailEventCounts?.ignored || 0}
                </p>
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
              <div className="flex flex-wrap gap-1">
                {(["all", "extracted", "queued", "failed", "ignored", "pending_sender"] as const).map((tab) => {
                  return (
                    <button
                      key={tab}
                      onClick={() => setEventFilter(tab)}
                      className={`btn !px-3 !py-1 text-xs capitalize ${
                        eventFilter === tab ? "btn-primary" : "btn-quiet"
                      }`}
                      data-testid={`filter-tab-${tab}`}
                    >
                      {tab.replace("_", " ")}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Events Table / List */}
            {eventsQuery.isLoading ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                <LoaderCircle size={18} className="animate-spin mx-auto mb-2 text-primary" />
                Loading email events…
              </div>
            ) : eventsQuery.data?.items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                No email events found for this filter.
              </div>
            ) : (
              <div className="divide-y divide-border rounded-xl border border-border bg-card/40 overflow-hidden">
                {eventsQuery.data?.items.map((event: EmailEventItem) => {
                  const isExpanded = expandedEventId === event.id;
                  const ai = event.aiResult as any;
                  const canReprocess = ["extracted", "failed", "ignored"].includes(event.status);

                  return (
                    <div
                      key={event.id}
                      className="group transition-colors hover:bg-muted/30 cursor-pointer"
                      onClick={() => setExpandedEventId(isExpanded ? null : event.id)}
                      data-testid={`email-event-row-${event.id}`}
                    >
                      <div className="p-4 space-y-2">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-semibold text-sm truncate text-foreground">
                                {event.subject || "(No subject)"}
                              </h4>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                                  event.status === "extracted"
                                    ? "bg-primary/20 text-primary"
                                    : event.status === "queued"
                                    ? "bg-amber-500/20 text-amber-400"
                                    : event.status === "failed"
                                    ? "bg-destructive/20 text-destructive"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {event.status}
                              </span>
                              {ai?.suggested_status && (
                                <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-mono text-primary">
                                  {ai.suggested_status}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              From: {event.fromAddress || event.fromDomain || "unknown"} · Received:{" "}
                              {formatRelativeTime(event.receivedAt)}
                            </p>
                          </div>

                          <div className="flex items-center gap-3 shrink-0 self-end sm:self-auto">
                            {event.confidence && (
                              <span className="mono text-xs text-muted-foreground">
                                {Math.round(Number(event.confidence) * 100)}% conf
                              </span>
                            )}
                            {canReprocess && (
                              <button
                                type="button"
                                onClick={(e) => handleReprocess(e, event.id)}
                                disabled={reprocessMutation.isPending}
                                className="btn btn-subtle !py-1 !px-2.5 text-xs"
                                data-testid={`button-reprocess-${event.id}`}
                              >
                                <RefreshCw size={12} className={reprocessMutation.isPending ? "animate-spin" : ""} />
                                Reprocess
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-quiet !p-1 text-muted-foreground"
                              aria-label={isExpanded ? "Collapse" : "Expand"}
                            >
                              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </button>
                          </div>
                        </div>

                        {/* One line summary */}
                        {ai?.summary && (
                          <p className="text-xs text-muted-foreground/90 line-clamp-1 italic">
                            &ldquo;{ai.summary}&rdquo;
                          </p>
                        )}

                        {/* Model and stage badge */}
                        <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-muted-foreground">
                          {ai?.company && (
                            <span className="font-medium text-foreground">
                              🏢 {ai.company} {ai.role ? `· ${ai.role}` : ""}
                            </span>
                          )}
                          {ai?.stage_detail && (
                            <span>🎯 {ai.stage_detail}</span>
                          )}
                          {ai?.next_at && (
                            <span className="text-primary font-medium">
                              📅 Next: {new Date(ai.next_at).toLocaleString()}
                            </span>
                          )}
                          {ai?._meta?.model && (
                            <span className="mono text-[10px] opacity-75">
                              AI: {ai._meta.model}
                            </span>
                          )}
                          {event.error && (
                            <span className="text-destructive font-medium">
                              ⚠️ Error: {event.error}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Expanded View: Full Extracted JSON fields */}
                      {isExpanded && (
                        <div
                          className="border-t border-border bg-muted/20 p-4 text-xs space-y-3 cursor-default"
                          onClick={(e) => e.stopPropagation()}
                          data-testid={`extracted-details-${event.id}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-primary">Full Extracted Details</span>
                            <span className="text-[10px] text-muted-foreground">
                              (Email body is never persisted)
                            </span>
                          </div>

                          {ai ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <p className="text-muted-foreground text-[10px] uppercase font-mono">Company / Role</p>
                                <p className="font-medium mt-0.5">{ai.company || "None"} / {ai.role || "None"}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground text-[10px] uppercase font-mono">Suggested Status / Stage</p>
                                <p className="font-medium mt-0.5">{ai.suggested_status || "None"} — {ai.stage_detail || "None"}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground text-[10px] uppercase font-mono">Next Date & Time</p>
                                <p className="font-medium mt-0.5">
                                  {ai.next_at ? `${ai.next_at} (${ai.next_type || "Event"})` : "None"}
                                </p>
                              </div>
                              <div>
                                <p className="text-muted-foreground text-[10px] uppercase font-mono">Action Required</p>
                                <p className="font-medium mt-0.5">
                                  {ai.action_required ? `Yes: ${ai.action_note || "Unspecified"}` : "No"}
                                </p>
                              </div>
                              <div>
                                <p className="text-muted-foreground text-[10px] uppercase font-mono">Location / Package</p>
                                <p className="font-medium mt-0.5">
                                  {ai.location || "None"} · {ai.package_lpa != null ? `${ai.package_lpa} LPA` : "Not mentioned"}
                                </p>
                              </div>
                              <div>
                                <p className="text-muted-foreground text-[10px] uppercase font-mono">Contact Info</p>
                                <p className="font-medium mt-0.5">
                                  {ai.contact_name || "None"} ({ai.contact_email_or_phone || "None"})
                                </p>
                              </div>
                              {ai.rejection_reason && (
                                <div className="sm:col-span-2">
                                  <p className="text-muted-foreground text-[10px] uppercase font-mono">Rejection Reason</p>
                                  <p className="text-destructive mt-0.5">{ai.rejection_reason}</p>
                                </div>
                              )}
                              <div className="sm:col-span-2">
                                <p className="text-muted-foreground text-[10px] uppercase font-mono">Extraction Metadata</p>
                                <p className="mono text-[11px] text-muted-foreground mt-0.5">
                                  Provider: {ai._meta?.provider} · Model: {ai._meta?.model} · Version: {ai._meta?.prompt_version} · Extracted at: {ai._meta?.extracted_at}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <p className="text-muted-foreground italic">
                              {event.error ? `Failed with error: ${event.error}` : "Extraction pending."}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* ─── STEP 6: APPLY TO APPLICATIONS ─── */}
        <section
          className={`panel p-6 transition-all ${
            !step5Done ? "opacity-60" : step6Done ? "border-primary/20" : "border-border"
          }`}
          data-testid="step-apply-applications"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  step6Done
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-secondary text-muted-foreground"
                }`}
              >
                {step6Done ? <Check size={16} strokeWidth={2.6} /> : "6"}
              </span>
              <div>
                <h2 className="text-lg font-bold">Apply to applications</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Match extracted emails to your applications, creating new records or advancing interview stages.
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <a
                    href="/review"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                    data-testid="link-review-queue"
                  >
                    Open Review Queue
                    {(status?.emailEventCounts?.needs_review || 0) > 0 && (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-500 border border-amber-500/20">
                        {status?.emailEventCounts?.needs_review} need review
                      </span>
                    )}
                  </a>
                </div>
              </div>
            </div>

            <button
              onClick={handleApplyEmails}
              disabled={
                !step2Done ||
                applyMutation.isPending ||
                (status?.emailEventCounts?.extracted || 0) === 0
              }
              className="btn btn-primary !py-2 !px-4 text-xs shrink-0"
              data-testid="button-apply-emails"
            >
              <Check size={14} className={applyMutation.isPending ? "animate-spin" : ""} />
              {applyMutation.isPending ? "Applying…" : "Apply to applications"}
            </button>
          </div>

          <div className="mt-5 border-t border-border pt-4 space-y-4">
            {applyResult && (
              <div className="rounded-xl border border-primary/20 bg-primary/10 p-3 text-xs text-primary">
                Applied {applyResult.applied} emails ({applyResult.created} created, {applyResult.updated} updated,{" "}
                {applyResult.historical} historical, {applyResult.needsReview} sent to review queue).
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-border bg-card/60 p-3">
                <span className="text-[11px] font-medium text-muted-foreground">Applied Emails</span>
                <p className="display mt-1 text-xl font-bold text-primary">
                  {status?.emailEventCounts?.applied || 0}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card/60 p-3">
                <span className="text-[11px] font-medium text-muted-foreground">Awaiting Apply</span>
                <p className="display mt-1 text-xl font-bold">
                  {status?.emailEventCounts?.extracted || 0}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card/60 p-3">
                <span className="text-[11px] font-medium text-muted-foreground">Needs Review</span>
                <p className="display mt-1 text-xl font-bold text-amber-500">
                  {status?.emailEventCounts?.needs_review || 0}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card/60 p-3">
                <span className="text-[11px] font-medium text-muted-foreground">Ignored Emails</span>
                <p className="display mt-1 text-xl font-bold text-muted-foreground">
                  {status?.emailEventCounts?.ignored || 0}
                </p>
              </div>
            </div>
          </div>
        </section>



      </div>

      {/* Disconnect Confirmation Modal */}
      {showDisconnectModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          data-testid="modal-disconnect-gmail"
        >
          <div className="panel max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold">Disconnect Gmail Account</h3>
            <p className="text-xs text-muted-foreground">
              Are you sure you want to disconnect <strong>{status?.googleEmail}</strong>? Background email sync will
              cease immediately.
            </p>

            <label className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={deleteEmailData}
                onChange={(e) => setDeleteEmailData(e.target.checked)}
                className="h-4 w-4 rounded border-border"
                data-testid="checkbox-delete-email-data"
              />
              <span>Also delete stored email metadata and sender rules</span>
            </label>

            <p className="text-[11px] text-muted-foreground">
              * Note: Your existing job applications will always remain untouched in your notebook.
            </p>

            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={() => setShowDisconnectModal(false)}
                className="btn btn-subtle text-xs"
                data-testid="button-cancel-disconnect"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={disconnectMutation.isPending}
                className="btn bg-destructive text-destructive-foreground hover:bg-destructive/90 text-xs"
                data-testid="button-confirm-disconnect"
              >
                {disconnectMutation.isPending && <LoaderCircle size={14} className="animate-spin" />}
                Confirm Disconnect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
