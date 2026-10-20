import React, { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Bell,
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import {
  useGetReminders,
  useDismissReminder,
  useDismissAllReminders,
  getGetRemindersQueryKey,
} from "@workspace/api-client-react";
import type { ReminderItem } from "@workspace/api-client-react";

function formatRelativeTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const absDiff = Math.abs(diffMs);

  const hours = Math.round(absDiff / (1000 * 60 * 60));
  const days = Math.round(absDiff / (1000 * 60 * 60 * 24));

  if (diffMs > 0) {
    if (hours < 1) return "in moments";
    if (hours < 24) return `in ${hours} hour${hours > 1 ? "s" : ""}`;
    if (days === 1) return "tomorrow";
    return `in ${days} days`;
  } else {
    if (hours < 1) return "just now";
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }
}

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [desktopEnabled, setDesktopEnabled] = useState<boolean>(() => {
    try {
      return (
        typeof window !== "undefined" &&
        window.localStorage.getItem("desktop_notifications_enabled") === "true" &&
        "Notification" in window &&
        Notification.permission === "granted"
      );
    } catch {
      return false;
    }
  });

  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const popoverRef = useRef<HTMLDivElement>(null);
  const isFirstLoadRef = useRef(true);

  // Poll GET /reminders every 60s and on window focus
  const remindersQuery = useGetReminders({
    query: {
      refetchInterval: 60_000,
      refetchOnWindowFocus: true,
      queryKey: getGetRemindersQueryKey(),
    },
  });

  const dismissMutation = useDismissReminder();
  const dismissAllMutation = useDismissAllReminders();

  const items: ReminderItem[] = remindersQuery.data?.items || [];
  const unreadCount = items.length;

  // Browser notifications handling
  useEffect(() => {
    if (!desktopEnabled || typeof window === "undefined" || !("Notification" in window)) {
      return;
    }

    if (Notification.permission !== "granted") {
      return;
    }

    // On initial load, mark all existing keys as known so we don't alert for them
    let knownKeys: Set<string>;
    try {
      const stored = window.localStorage.getItem("notified_reminder_keys");
      knownKeys = new Set(stored ? JSON.parse(stored) : []);
    } catch {
      knownKeys = new Set();
    }

    if (isFirstLoadRef.current) {
      isFirstLoadRef.current = false;
      for (const item of items) {
        knownKeys.add(item.key);
      }
      try {
        window.localStorage.setItem(
          "notified_reminder_keys",
          JSON.stringify(Array.from(knownKeys)),
        );
      } catch {}
      return;
    }

    // New items trigger browser notification
    let updated = false;
    for (const item of items) {
      if (!knownKeys.has(item.key)) {
        knownKeys.add(item.key);
        updated = true;

        try {
          const notif = new Notification(item.title, {
            body: item.body,
            icon: "/favicon.ico",
          });
          notif.onclick = () => {
            window.focus();
            if (item.applicationId) {
              setLocation(`/applications?open=${item.applicationId}`);
            } else {
              setLocation("/calendar");
            }
          };
        } catch (e) {
          console.error("Failed to show desktop notification:", e);
        }
      }
    }

    if (updated) {
      try {
        window.localStorage.setItem(
          "notified_reminder_keys",
          JSON.stringify(Array.from(knownKeys)),
        );
      } catch {}
    }
  }, [items, desktopEnabled, setLocation]);

  // Click outside listener for popover
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const toggleDesktopNotifications = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      alert("Browser notifications are not supported on this browser.");
      return;
    }

    if (desktopEnabled) {
      setDesktopEnabled(false);
      try {
        window.localStorage.setItem("desktop_notifications_enabled", "false");
      } catch {}
      return;
    }

    try {
      const perm = await Notification.requestPermission();
      if (perm === "granted") {
        setDesktopEnabled(true);
        try {
          window.localStorage.setItem("desktop_notifications_enabled", "true");
        } catch {}
      } else {
        alert("Notifications permission was denied or dismissed in your browser.");
      }
    } catch (err: any) {
      console.error("Permission request failed", err);
    }
  };

  const handleDismiss = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    dismissMutation.mutate(
      { data: { key } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetRemindersQueryKey() });
        },
      },
    );
  };

  const handleDismissAll = () => {
    dismissAllMutation.mutate(undefined, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetRemindersQueryKey() });
      },
    });
  };

  const handleItemClick = (item: ReminderItem) => {
    setIsOpen(false);
    if (item.applicationId) {
      setLocation(`/applications?open=${item.applicationId}`);
    } else {
      setLocation("/calendar");
    }
  };

  const getSeverityStyle = (severity: string) => {
    if (severity === "urgent") {
      return "border-l-4 border-l-[#ff6b6b] bg-[#ff6b6b]/5 hover:bg-[#ff6b6b]/10";
    }
    if (severity === "soon") {
      return "border-l-4 border-l-amber-500 bg-amber-500/5 hover:bg-amber-500/10";
    }
    return "border-l-4 border-l-sky-500 bg-sky-500/5 hover:bg-sky-500/10";
  };

  const getSeverityBadge = (severity: string) => {
    if (severity === "urgent") {
      return (
        <span className="rounded-full bg-[#ff6b6b]/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#ff6b6b]">
          Urgent
        </span>
      );
    }
    if (severity === "soon") {
      return (
        <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-500">
          Soon
        </span>
      );
    }
    return (
      <span className="rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-sky-500">
        Info
      </span>
    );
  };

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="relative btn btn-quiet !p-2 text-foreground/80 hover:text-foreground"
        aria-label="Reminders and notifications"
        data-testid="button-notification-bell"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#ff6b6b] px-1 text-[10px] font-bold text-white shadow-sm"
            data-testid="badge-reminder-count"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl border border-border bg-card p-4 shadow-2xl z-50 animate-in fade-in-50 zoom-in-95 duration-150"
          data-testid="popover-reminders"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-foreground">Reminders</h3>
              {unreadCount > 0 && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                  {unreadCount} active
                </span>
              )}
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleDismissAll}
                disabled={dismissAllMutation.isPending}
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 font-medium"
                data-testid="button-dismiss-all"
              >
                <CheckCheck size={13} />
                Dismiss all
              </button>
            )}
          </div>

          {/* Desktop Notification Toggle */}
          <div className="mt-3 flex items-center justify-between rounded-xl border border-border bg-muted/40 p-2.5">
            <div className="flex items-center gap-2">
              <Volume2 size={14} className="text-muted-foreground" />
              <span className="text-xs font-medium text-foreground">Desktop notifications</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={desktopEnabled}
                onChange={toggleDesktopNotifications}
                className="sr-only peer"
                data-testid="toggle-desktop-notifications"
              />
              <div className="w-8 h-4.5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>

          {/* Reminder Items List */}
          <div className="mt-3 max-h-80 overflow-y-auto space-y-2 pr-1">
            {items.length === 0 ? (
              <div className="py-8 text-center" data-testid="empty-reminders">
                <Sparkles size={24} className="mx-auto text-primary/40 mb-2" />
                <p className="text-xs font-semibold text-foreground">You are all caught up!</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  No upcoming deadlines or required actions right now.
                </p>
              </div>
            ) : (
              items.map((item) => (
                <div
                  key={item.key}
                  onClick={() => handleItemClick(item)}
                  className={`group relative flex flex-col gap-1 rounded-xl p-3 cursor-pointer transition-colors ${getSeverityStyle(
                    item.severity,
                  )}`}
                  data-testid={`reminder-item-${item.key}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {getSeverityBadge(item.severity)}
                      <span className="text-xs font-semibold text-foreground line-clamp-1">
                        {item.title}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => handleDismiss(item.key, e)}
                      aria-label="Dismiss reminder"
                      className="opacity-0 group-hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10 rounded p-1 text-muted-foreground transition-opacity"
                      data-testid={`button-dismiss-${item.key}`}
                    >
                      <X size={13} />
                    </button>
                  </div>

                  <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                    {item.body}
                  </p>

                  <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock size={10} />
                      {formatRelativeTime(item.dueAt)}
                    </span>

                    {item.company && (
                      <span className="font-medium text-foreground/80 flex items-center gap-0.5">
                        {item.company}
                        <ExternalLink size={9} />
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

