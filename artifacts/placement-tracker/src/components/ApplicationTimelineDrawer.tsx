import React, { useState } from "react";
import {
  getGetApplicationTimelineQueryKey,
  useGetApplicationTimeline,
  useUndoApplicationEvent,
  type Application,
  type ApplicationTimelineEvent,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Clock,
  History,
  RotateCcw,
  Sparkles,
  UserCheck,
  X,
  AlertCircle,
} from "lucide-react";

interface TimelineDrawerProps {
  application: Application | null;
  onClose: () => void;
}

export function ApplicationTimelineDrawer({
  application,
  onClose,
}: TimelineDrawerProps) {
  const queryClient = useQueryClient();
  const [confirmUndoEventId, setConfirmUndoEventId] = useState<string | null>(null);

  const {
    data: timeline = [],
    isLoading,
    error,
  } = useGetApplicationTimeline(application?.id || "", {
    query: {
      enabled: Boolean(application?.id),
      queryKey: getGetApplicationTimelineQueryKey(application?.id || ""),
    },
  });

  const undoMutation = useUndoApplicationEvent();

  if (!application) return null;

  // Find latest undoable event (appliedBy auto or review, not already undone)
  const nonUndoneEvents = timeline.filter((e) => !e.undoneAt && (e.appliedBy === "auto" || e.appliedBy === "review"));
  const latestUndoableEvent = nonUndoneEvents.length > 0 ? nonUndoneEvents[0] : null;

  const handleUndo = async (eventId: string) => {
    try {
      await undoMutation.mutateAsync({
        id: application.id,
        eventId,
      });
      setConfirmUndoEventId(null);
      // Invalidate queries
      void queryClient.invalidateQueries({ queryKey: ["/api/applications"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/review"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/gmail/status"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/dashboard/summary"] });
      // If the latest event was "created", undoing it deleted the app, so close drawer
      if (latestUndoableEvent?.kind === "created") {
        onClose();
      }
    } catch (err: any) {
      alert(err?.message || "Failed to undo application event");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-background/60 backdrop-blur-sm transition-opacity">
      <div className="flex h-full w-full max-w-md flex-col border-l border-border bg-card p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border/60 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <History size={18} className="text-primary" />
              <h2 className="text-lg font-bold text-foreground">Application History</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {application.companyName} {application.role ? `• ${application.role}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center text-xs text-muted-foreground animate-pulse">
              Loading timeline...
            </div>
          ) : error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive">
              Failed to load timeline events.
            </div>
          ) : timeline.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Clock size={28} className="text-muted-foreground/60" />
              <p className="mt-2 text-xs text-muted-foreground">No events recorded for this application yet.</p>
            </div>
          ) : (
            <div className="relative pl-6 space-y-6 before:absolute before:bottom-0 before:left-2 before:top-2 before:w-0.5 before:bg-border">
              {timeline.map((event: ApplicationTimelineEvent) => {
                const isLatestUndoable = latestUndoableEvent?.id === event.id;
                const isUndone = Boolean(event.undoneAt);

                return (
                  <div key={event.id} className="relative group">
                    {/* Dot on line */}
                    <div
                      className={`absolute -left-6 top-1.5 grid h-4 w-4 place-items-center rounded-full border-2 ${
                        isUndone
                          ? "border-muted-foreground/40 bg-muted-foreground/20"
                          : event.kind === "created"
                            ? "border-primary bg-primary/20"
                            : "border-border bg-card"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          isUndone ? "bg-muted-foreground" : "bg-primary"
                        }`}
                      />
                    </div>

                    {/* Event Body */}
                    <div
                      className={`rounded-xl border p-3.5 text-xs transition-all ${
                        isUndone
                          ? "border-border/40 bg-secondary/20 opacity-60 line-through"
                          : "border-border bg-secondary/30"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 font-semibold text-foreground">
                          {event.fromStatus && event.toStatus ? (
                            <span className="flex items-center gap-1">
                              <span>{event.fromStatus}</span>
                              <ArrowRight size={11} className="text-muted-foreground" />
                              <span className="text-primary">{event.toStatus}</span>
                            </span>
                          ) : event.toStatus ? (
                            <span className="text-primary">{event.toStatus}</span>
                          ) : (
                            <span className="capitalize">{event.kind}</span>
                          )}
                        </div>

                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          {event.appliedBy === "auto" ? (
                            <span className="flex items-center gap-0.5 text-primary/80">
                              <Sparkles size={10} /> Auto
                            </span>
                          ) : (
                            <span className="flex items-center gap-0.5 text-muted-foreground">
                              <UserCheck size={10} /> Review
                            </span>
                          )}
                          <span>•</span>
                          <span>
                            {new Date(event.occurredAt).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        </div>
                      </div>

                      {event.stageDetail && (
                        <div className="mt-1 text-[11px] text-foreground/80 font-medium">
                          {event.stageDetail}
                        </div>
                      )}

                      {event.summary && (
                        <div className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                          {event.summary}
                        </div>
                      )}

                      {/* Undo Action on latest undoable event */}
                      {isLatestUndoable && !isUndone && (
                        <div className="mt-3 pt-2 border-t border-border/50 flex items-center justify-end">
                          {confirmUndoEventId === event.id ? (
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-destructive flex items-center gap-1">
                                <AlertCircle size={12} /> Confirm undo?
                              </span>
                              <button
                                type="button"
                                disabled={undoMutation.isPending}
                                onClick={() => handleUndo(event.id)}
                                className="rounded bg-destructive px-2 py-1 text-[11px] font-semibold text-destructive-foreground hover:bg-destructive/90 transition-all"
                              >
                                {undoMutation.isPending ? "Undoing..." : "Yes, undo"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmUndoEventId(null)}
                                className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmUndoEventId(event.id)}
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-destructive transition-colors"
                            >
                              <RotateCcw size={12} />
                              Undo this change
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
