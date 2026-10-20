import React, { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Calendar as CalendarIcon,
  Clock,
  ExternalLink,
  MapPin,
  CheckCircle2,
  AlertCircle,
  FileText,
  Sparkles,
  X,
  Mail,
  User,
} from "lucide-react";
import {
  useGetCalendarEvents,
  useDismissReminder,
  getGetCalendarEventsQueryKey,
} from "@workspace/api-client-react";
import type { CalendarEventItem } from "@workspace/api-client-react";

const KIND_COLORS = {
  interview: {
    chip: "bg-purple-500/15 text-purple-400 border border-purple-500/30",
    dot: "bg-purple-400",
    label: "Interview",
  },
  assessment: {
    chip: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
    dot: "bg-amber-400",
    label: "Assessment",
  },
  screening: {
    chip: "bg-teal-500/15 text-teal-400 border border-teal-500/30",
    dot: "bg-teal-400",
    label: "Screening",
  },
  deadline: {
    chip: "bg-rose-500/15 text-rose-400 border border-rose-500/30",
    dot: "bg-rose-400",
    label: "Deadline",
  },
} as const;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatDateString(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

export function CalendarPage() {
  const [, setLocation] = useLocation();
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [viewMode, setViewMode] = useState<"month" | "agenda">("month");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [focusedEvent, setFocusedEvent] = useState<CalendarEventItem | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Query range: start of month - 7 days to end of month + 14 days
  const fromStr = formatDateString(year, month - 1, 20);
  const toStr = formatDateString(year, month + 1, 28);

  const eventsQuery = useGetCalendarEvents(
    { from: fromStr, to: toStr },
    {
      query: {
        queryKey: getGetCalendarEventsQueryKey({ from: fromStr, to: toStr }),
      },
    },
  );

  const dismissMutation = useDismissReminder();

  const events: CalendarEventItem[] = eventsQuery.data || [];

  // Group events by YYYY-MM-DD
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEventItem[]>();
    for (const ev of events) {
      const dayStr = ev.start.slice(0, 10);
      if (!map.has(dayStr)) map.set(dayStr, []);
      map.get(dayStr)!.push(ev);
    }
    return map;
  }, [events]);

  const monthTitle = new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
  }).format(currentDate);

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const handleToday = () => {
    const now = new Date();
    setCurrentDate(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDay(formatDateString(now.getFullYear(), now.getMonth(), now.getDate()));
  };

  // Month grid generation
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayIndex = new Date(year, month, 1).getDay(); // 0 is Sunday

  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const gridCells = useMemo(() => {
    const cells: Array<{
      dateStr: string;
      dayNumber: number;
      isCurrentMonth: boolean;
      isWeekend: boolean;
      isToday: boolean;
    }> = [];

    const todayStr = formatDateString(
      new Date().getFullYear(),
      new Date().getMonth(),
      new Date().getDate(),
    );

    // Prev month padding
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const dateStr = formatDateString(year, month - 1, d);
      const isWeekend = new Date(year, month - 1, d).getDay() % 6 === 0;
      cells.push({
        dateStr,
        dayNumber: d,
        isCurrentMonth: false,
        isWeekend,
        isToday: dateStr === todayStr,
      });
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = formatDateString(year, month, d);
      const isWeekend = new Date(year, month, d).getDay() % 6 === 0;
      cells.push({
        dateStr,
        dayNumber: d,
        isCurrentMonth: true,
        isWeekend,
        isToday: dateStr === todayStr,
      });
    }

    // Next month padding to fill up to 35 or 42 cells
    const remaining = (7 - (cells.length % 7)) % 7;
    for (let d = 1; d <= remaining; d++) {
      const dateStr = formatDateString(year, month + 1, d);
      const isWeekend = new Date(year, month + 1, d).getDay() % 6 === 0;
      cells.push({
        dateStr,
        dayNumber: d,
        isCurrentMonth: false,
        isWeekend,
        isToday: dateStr === todayStr,
      });
    }

    return cells;
  }, [year, month, firstDayIndex, daysInMonth, daysInPrevMonth]);

  // Selected day events
  const activeDayEvents = selectedDay ? eventsByDay.get(selectedDay) || [] : [];

  const handleDayClick = (dateStr: string) => {
    setSelectedDay(dateStr);
    setFocusedEvent(null);
  };

  const handleEventChipClick = (ev: CalendarEventItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedDay(ev.start.slice(0, 10));
    setFocusedEvent(ev);
  };

  // Agenda view items (next 30 days)
  const agendaDays = useMemo(() => {
    const list: Array<{ dateStr: string; date: Date; events: CalendarEventItem[] }> = [];
    const today = new Date();
    for (let i = 0; i < 30; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      const dateStr = formatDateString(d.getFullYear(), d.getMonth(), d.getDate());
      const dayEvs = eventsByDay.get(dateStr) || [];
      if (dayEvs.length > 0) {
        list.push({ dateStr, date: d, events: dayEvs });
      }
    }
    return list;
  }, [eventsByDay]);

  return (
    <div className="space-y-6">
      {/* Header controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="display text-3xl font-bold text-foreground" data-testid="heading-calendar">
              {monthTitle}
            </h1>
            <button
              onClick={handleToday}
              className="btn btn-subtle text-xs !py-1 !px-2.5 font-semibold"
              data-testid="button-calendar-today"
            >
              Today
            </button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Keep track of interviews, assessment deadlines, and next steps in one place.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Segmented Control Month vs Agenda */}
          <div className="flex items-center rounded-xl border border-border bg-muted/40 p-1 text-xs">
            <button
              type="button"
              onClick={() => setViewMode("month")}
              className={`rounded-lg px-3 py-1 font-semibold transition-colors ${
                viewMode === "month"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="button-view-month"
            >
              Month
            </button>
            <button
              type="button"
              onClick={() => setViewMode("agenda")}
              className={`rounded-lg px-3 py-1 font-semibold transition-colors ${
                viewMode === "agenda"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="button-view-agenda"
            >
              Agenda
            </button>
          </div>

          {/* Month Prev/Next */}
          {viewMode === "month" && (
            <div className="flex items-center rounded-xl border border-border bg-card p-0.5">
              <button
                type="button"
                onClick={handlePrevMonth}
                aria-label="Previous month"
                className="btn btn-quiet !p-1.5"
                data-testid="button-calendar-prev"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                onClick={handleNextMonth}
                aria-label="Next month"
                className="btn btn-quiet !p-1.5"
                data-testid="button-calendar-next"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}

          {/* Export All ICS */}
          <a
            href="/api/calendar/export.ics"
            download="placement-tracker-calendar.ics"
            className="btn btn-subtle text-xs !py-1.5 !px-3 inline-flex items-center gap-1.5 font-medium"
            data-testid="button-export-all-ics"
          >
            <Download size={14} />
            Export all (.ics)
          </a>
        </div>
      </div>

      {/* Color Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap px-1">
        <span className="font-medium text-foreground text-[11px] uppercase tracking-wider">
          Legend:
        </span>
        {Object.entries(KIND_COLORS).map(([kindKey, config]) => (
          <div key={kindKey} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${config.dot}`} />
            <span>{config.label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 ml-2">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 ring-2 ring-amber-500/30" />
          <span>Action needed</span>
        </div>
      </div>

      {/* Main View Area */}
      {viewMode === "month" ? (
        <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
          {/* Day of Week Headers */}
          <div className="grid grid-cols-7 border-b border-border bg-muted/30 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((dayName, idx) => (
              <div
                key={dayName}
                className={`py-2.5 ${idx === 0 || idx === 6 ? "bg-muted/10 text-muted-foreground/70" : ""}`}
              >
                {dayName}
              </div>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 auto-rows-fr divide-x divide-y divide-border">
            {gridCells.map((cell) => {
              const dayEvents = eventsByDay.get(cell.dateStr) || [];
              const hasActionNeeded = dayEvents.some((e) => e.actionRequired);
              const isSelected = selectedDay === cell.dateStr;

              return (
                <div
                  key={cell.dateStr}
                  onClick={() => handleDayClick(cell.dateStr)}
                  className={`min-h-[105px] p-2 flex flex-col justify-between cursor-pointer transition-colors relative ${
                    cell.isCurrentMonth ? "bg-card hover:bg-muted/40" : "bg-muted/20 opacity-40 hover:opacity-70"
                  } ${cell.isWeekend ? "bg-muted/15" : ""} ${
                    isSelected ? "ring-2 ring-primary inset-0 bg-primary/5" : ""
                  }`}
                  data-testid={`calendar-cell-${cell.dateStr}`}
                >
                  {/* Date number header */}
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs font-semibold rounded-full flex items-center justify-center ${
                        cell.isToday
                          ? "bg-primary text-primary-foreground h-6 w-6 font-bold shadow-sm"
                          : "h-6 w-6 text-foreground"
                      }`}
                    >
                      {cell.dayNumber}
                    </span>

                    {hasActionNeeded && (
                      <span
                        className="h-2 w-2 rounded-full bg-amber-500 ring-2 ring-amber-500/20"
                        title="Application needs action"
                      />
                    )}
                  </div>

                  {/* Event Chips List */}
                  <div className="mt-1 space-y-1 overflow-hidden">
                    {dayEvents.slice(0, 2).map((ev) => {
                      const color = KIND_COLORS[ev.kind] || KIND_COLORS.deadline;
                      const timeStr = !ev.allDay && ev.start.includes("T")
                        ? new Intl.DateTimeFormat("en", {
                            hour: "numeric",
                            minute: "2-digit",
                          }).format(new Date(ev.start))
                        : null;

                      return (
                        <div
                          key={ev.id}
                          onClick={(e) => handleEventChipClick(ev, e)}
                          className={`group flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold truncate transition-transform hover:scale-[1.02] ${
                            color.chip
                          } ${ev.isPast ? "opacity-50 grayscale" : ""}`}
                          title={`${ev.company}: ${ev.title}`}
                          data-testid={`event-chip-${ev.id}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${color.dot}`} />
                          <span className="truncate">
                            {timeStr ? `${timeStr} ` : ""}
                            {ev.company}
                          </span>
                        </div>
                      );
                    })}

                    {dayEvents.length > 2 && (
                      <span className="text-[10px] text-muted-foreground font-semibold px-1 block">
                        +{dayEvents.length - 2} more
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Agenda View */
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          {agendaDays.length === 0 ? (
            <div className="py-12 text-center" data-testid="empty-agenda">
              <Sparkles size={32} className="mx-auto text-primary/30 mb-3" />
              <h3 className="text-sm font-bold text-foreground">No upcoming events scheduled</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                Applications with interviews, tests, and deadlines will automatically appear here.
                Connect your Gmail to sync events directly from your inbox!
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {agendaDays.map((dayGroup) => {
                const dayTitle = new Intl.DateTimeFormat("en", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                }).format(dayGroup.date);

                return (
                  <div key={dayGroup.dateStr} className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground border-b border-border pb-1">
                      {dayTitle}
                    </h3>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {dayGroup.events.map((ev) => {
                        const color = KIND_COLORS[ev.kind] || KIND_COLORS.deadline;
                        return (
                          <div
                            key={ev.id}
                            onClick={() => {
                              setSelectedDay(dayGroup.dateStr);
                              setFocusedEvent(ev);
                            }}
                            className={`rounded-xl border p-4 cursor-pointer hover:border-primary/40 transition-colors ${
                              color.chip
                            } ${ev.isPast ? "opacity-50" : ""}`}
                          >
                            <div className="flex items-center justify-between text-xs font-bold">
                              <span>{ev.company}</span>
                              <span className="text-[11px] font-medium">{ev.title}</span>
                            </div>
                            {ev.role && (
                              <p className="text-xs text-muted-foreground mt-1">{ev.role}</p>
                            )}
                            <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
                              <span>{ev.allDay ? "All day" : "Timed event"}</span>
                              {ev.actionRequired && (
                                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[9px] font-bold text-amber-500">
                                  Action needed
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Side Panel / Drawer for Day Events */}
      {selectedDay && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
        >
          <div className="panel w-full max-w-md h-full overflow-y-auto p-6 space-y-5 bg-card border-l border-border shadow-2xl animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div>
                <h3 className="text-base font-bold text-foreground">
                  Events on{" "}
                  {new Intl.DateTimeFormat("en", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  }).format(new Date(`${selectedDay}T12:00:00`))}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {activeDayEvents.length} event{activeDayEvents.length === 1 ? "" : "s"}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setSelectedDay(null)}
                aria-label="Close panel"
                className="btn btn-quiet !p-2 text-muted-foreground hover:text-foreground"
                data-testid="button-close-calendar-drawer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Event Cards */}
            {activeDayEvents.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted-foreground">
                No events scheduled for this day.
              </div>
            ) : (
              <div className="space-y-4">
                {activeDayEvents.map((ev) => {
                  const color = KIND_COLORS[ev.kind] || KIND_COLORS.deadline;
                  const isHighlighted = focusedEvent?.id === ev.id;

                  return (
                    <div
                      key={ev.id}
                      className={`rounded-2xl border p-4 space-y-3 transition-colors ${
                        isHighlighted
                          ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                          : "border-border bg-card"
                      }`}
                      data-testid={`event-card-${ev.id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-bold text-foreground">{ev.company}</h4>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${color.chip}`}
                            >
                              {ev.title}
                            </span>
                          </div>
                          {ev.role && (
                            <p className="text-xs text-muted-foreground mt-0.5">{ev.role}</p>
                          )}
                        </div>

                        <span className="text-[10px] font-semibold text-muted-foreground capitalize bg-muted/60 px-2 py-0.5 rounded-md">
                          {ev.source === "email" ? "From email" : "Added manually"}
                        </span>
                      </div>

                      {/* Details row */}
                      <div className="space-y-1.5 text-xs text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Clock size={13} className="text-primary" />
                          <span>
                            {ev.allDay
                              ? "All day"
                              : new Intl.DateTimeFormat("en", {
                                  hour: "numeric",
                                  minute: "2-digit",
                                  timeZoneName: "short",
                                }).format(new Date(ev.start))}
                          </span>
                        </div>

                        {ev.stageDetail && (
                          <div className="flex items-center gap-2">
                            <CheckCircle2 size={13} className="text-muted-foreground" />
                            <span>Stage: {ev.stageDetail}</span>
                          </div>
                        )}
                      </div>

                      {/* Action Note */}
                      {ev.actionRequired && ev.actionNote && (
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-500 flex items-start gap-2">
                          <AlertCircle size={14} className="shrink-0 mt-0.5" />
                          <div>
                            <span className="font-semibold block">Action needed:</span>
                            {ev.actionNote}
                          </div>
                        </div>
                      )}

                      {/* Summary */}
                      {ev.summary && (
                        <div className="rounded-xl bg-muted/40 p-2.5 text-xs text-muted-foreground">
                          <p className="line-clamp-3 italic">"{ev.summary}"</p>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center justify-between border-t border-border pt-3">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDay(null);
                            setLocation(`/applications?open=${ev.applicationId}`);
                          }}
                          className="btn btn-subtle text-xs !py-1 !px-2.5 font-semibold"
                          data-testid={`button-open-app-${ev.id}`}
                        >
                          Open application
                        </button>

                        <a
                          href={`/api/applications/${ev.applicationId}/event.ics`}
                          download={`${ev.company}-event.ics`}
                          className="text-xs text-primary hover:underline font-semibold inline-flex items-center gap-1"
                          data-testid={`button-download-ics-${ev.id}`}
                        >
                          <Download size={12} />
                          Add to calendar (.ics)
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

