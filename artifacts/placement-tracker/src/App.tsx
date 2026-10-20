import { useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation, useSearch } from 'wouter';
import { useForm } from 'react-hook-form';
import {
  Activity, ArrowDownWideNarrow, ArrowLeft, ArrowRight, BriefcaseBusiness, CalendarDays,
  Check, ChevronDown, CircleAlert, Download, FilePlus2, Filter, History, Inbox, LayoutDashboard, LoaderCircle,
  LogOut, Mail, MapPin, Pencil, Plus, RotateCcw, Search, Sparkles, Trash2, TrendingUp, X
} from 'lucide-react';
import {
  getExportApplicationsQueryKey, getGetApplicationQueryKey, getGetCurrentUserQueryKey, getGetDashboardSummaryQueryKey,
  getGetGmailStatusQueryKey,
  getListApplicationsQueryKey, useCreateApplication, useDeleteApplication,
  useDeleteSampleApplications, useExportApplications, useGetApplication,
  useGetCurrentUser, useGetDashboardSummary, useListApplications, useLogin,
  useLogout, useRegister, useUpdateApplication, useGetGmailStatus
} from '@workspace/api-client-react';
import type { Application, ApplicationInput, ApplicationStatus, RejectionRound } from '@workspace/api-client-react';
import { Form } from '@/components/ui/form';
import NotFound from '@/pages/not-found';
import { GmailSettingsPage } from '@/pages/GmailSettings';
import { ReviewQueuePage } from '@/pages/ReviewQueue';
import { ApplicationTimelineDrawer } from '@/components/ApplicationTimelineDrawer';
import { NotificationBell } from '@/components/NotificationBell';
import { CalendarPage } from '@/pages/Calendar';
import { ConfirmDialog } from '@/components/ConfirmDialog';

const queryClient = new QueryClient();
const STATUSES: ApplicationStatus[] = [
  'APPLIED',
  'SCREENING',
  'TEST',
  'INTERVIEW',
  'ACCEPTED',
  'REJECTED',
  'WITHDRAWN'
];

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  APPLIED: 'Applied',
  SCREENING: 'Screening',
  TEST: 'Test',
  INTERVIEW: 'Interview',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
};

const MODES = ['On-campus', 'Off-campus', 'Referral', 'Job portal', 'Unknown'] as const;
const ROUNDS: RejectionRound[] = ['Resume shortlisting', 'Aptitude/online test', 'Coding round', 'Technical interview', 'HR interview', 'Other'];
const emptyApplication: ApplicationInput = {
  companyName: '', role: '', packageLpa: null, location: '', appliedDate: new Date().toISOString().slice(0, 10),
  mode: 'On-campus', status: 'APPLIED', nextDate: '', contactName: '', contactEmailOrPhone: '',
  jobLink: '', notes: '', rejectionRound: null, rejectionDate: '', rejectionReason: ''
};

function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'Something unexpected happened. Please try again.';
}
function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1 text-xs text-destructive" role="alert">{message}</p> : null;
}
function dateLabel(value?: string | null) {
  if (!value) return 'No date set';
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function formatDeadline(app: { nextAt?: string | null; nextAtHasTime?: boolean; nextDate?: string | null }) {
  if (app.nextAt) {
    const d = new Date(app.nextAt);
    if (!Number.isNaN(d.getTime())) {
      if (app.nextAtHasTime) {
        return new Intl.DateTimeFormat('en', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }).format(d);
      }
      return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
    }
  }
  return dateLabel(app.nextDate);
}

function getStatusClass(status: string) {
  return `status-pill status-${status.toLowerCase()}`;
}
function StatusPill({ status }: { status: string }) {
  const displayLabel = STATUS_LABELS[status as ApplicationStatus] || status;
  return <span className={getStatusClass(status)} data-testid={`status-pill-${status.toLowerCase()}`}>{displayLabel}</span>;
}
function LoadingState({ label = 'Loading your placement notebook' }: { label?: string }) {
  return <div className="grid gap-4" aria-label={label} data-testid="loading-state">
    <div className="h-8 w-52 animate-pulse rounded-lg bg-muted" />
    <div className="h-32 animate-pulse rounded-2xl bg-muted/80" />
    <div className="h-56 animate-pulse rounded-2xl bg-muted/80" />
  </div>;
}
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="panel flex flex-col items-start gap-3 p-6" role="alert" data-testid="error-state">
    <div className="flex items-center gap-2 font-semibold"><CircleAlert size={18} className="text-destructive" />We couldn’t load this view</div>
    <p className="text-sm text-muted-foreground">{message}</p>
    <button onClick={onRetry} className="btn btn-subtle" data-testid="button-retry">Try again</button>
  </div>;
}

function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const [location, setLocation] = useLocation();
  const qc = useQueryClient();
  const current = useGetCurrentUser({ query: { retry: false, queryKey: getGetCurrentUserQueryKey() } });
  const loginMutation = useLogin();
  const registerMutation = useRegister();
  const form = useForm<{ email: string; password: string }>({ defaultValues: { email: '', password: '' } });
  const pending = loginMutation.isPending || registerMutation.isPending;
  useEffect(() => { if (current.data) setLocation('/dashboard'); }, [current.data, setLocation]);
  if (current.data) return null;
  const submit = form.handleSubmit((values) => {
    const mutation = mode === 'login' ? loginMutation : registerMutation;
    mutation.mutate({ data: values }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() }); setLocation('/dashboard'); } });
  });
  const error = loginMutation.error || registerMutation.error;
  return <main className="app-shell flex min-h-[100dvh] items-stretch">
    <section className="relative hidden w-[43%] overflow-hidden bg-[#245b4c] p-12 text-[#f5f1e7] lg:flex lg:flex-col lg:justify-between">
      <div className="absolute -right-24 -top-20 h-96 w-96 rounded-full border border-white/10" />
      <div className="absolute -right-3 top-14 h-72 w-72 rounded-full border border-white/10" />
      <Link href="/login" className="relative z-10 flex items-center gap-3 text-sm font-bold tracking-tight text-inherit" data-testid="link-brand-auth">
        <BrandMark light /> <span>fieldnotes<span className="text-[#b7d4a7]">/career</span></span>
      </Link>
      <div className="relative z-10 max-w-lg pb-12">
        <p className="mono mb-5 text-xs uppercase tracking-[.2em] text-[#bfd4b8]">Your search, in perspective</p>
        <h1 className="display text-5xl font-semibold leading-[1.08] xl:text-6xl">A clearer path<br />to what’s next.</h1>
        <p className="mt-6 max-w-md text-base leading-7 text-[#e0e8dc]">Keep every application, conversation and next step in one thoughtful place. Progress is easier to see when context stays close.</p>
      </div>
      <div className="relative z-10 flex items-center gap-3 text-xs text-[#d8e4d5]">
        <span className="flex -space-x-2"><i className="grid h-8 w-8 place-items-center rounded-full border-2 border-[#245b4c] bg-[#d49a58] not-italic text-[#2c4239]">A</i><i className="grid h-8 w-8 place-items-center rounded-full border-2 border-[#245b4c] bg-[#96b9a5] not-italic text-[#263c34]">R</i><i className="grid h-8 w-8 place-items-center rounded-full border-2 border-[#245b4c] bg-[#e7c4a1] not-italic text-[#513c2e]">S</i></span>
        <span>Made for the long game, one step at a time.</span>
      </div>
    </section>
    <section className="flex flex-1 items-center justify-center px-5 py-12">
      <div className="w-full max-w-[420px] fade-up">
        <Link href="/login" className="mb-12 inline-flex items-center gap-2 text-sm font-bold lg:hidden" data-testid="link-brand-mobile"><BrandMark />fieldnotes<span className="text-primary">/career</span></Link>
        <div className="mb-9">
          <span className="mono text-[11px] uppercase tracking-[.18em] text-primary">{mode === 'login' ? 'Welcome back' : 'A fresh start'}</span>
          <h2 className="display mt-2 text-3xl font-bold">{mode === 'login' ? 'Pick up where you left off.' : 'Make room for momentum.'}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{mode === 'login' ? 'Your search is right where you left it.' : 'Create your private placement notebook.'}</p>
        </div>
        <Form {...form}>
          <form onSubmit={submit} className="space-y-5" data-testid={`form-${mode}`}>
            <div><label className="label" htmlFor="auth-email">Email address</label><input className="field" id="auth-email" type="email" placeholder="you@university.edu" autoComplete="email" {...form.register('email', { required: 'Enter your email address', pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email address' } })} data-testid="input-email" />{form.formState.errors.email && <p className="mt-1 text-xs text-destructive">{form.formState.errors.email.message}</p>}</div>
            <div><label className="label" htmlFor="auth-password">Password</label><input className="field" id="auth-password" type="password" placeholder="At least 8 characters" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} {...form.register('password', { required: 'Enter your password', minLength: mode === 'register' ? { value: 8, message: 'Use at least 8 characters' } : undefined })} data-testid="input-password" />{form.formState.errors.password && <p className="mt-1 text-xs text-destructive">{form.formState.errors.password.message}</p>}</div>
            {error && <div role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-sm text-destructive" data-testid="auth-error">{errorMessage(error)}</div>}
            <button type="submit" disabled={pending} className="btn btn-primary w-full py-3" data-testid={`button-submit-${mode}`}>{pending ? <LoaderCircle className="animate-spin" size={17} /> : null}{pending ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create account'}<ArrowRight size={16} /></button>
          </form>
        </Form>
        <div className="mt-7 border-t border-border pt-6 text-center text-sm text-muted-foreground">
          {mode === 'login' ? 'New to fieldnotes?' : 'Already have an account?'}{' '}
          <Link className="font-semibold text-primary hover:underline" href={mode === 'login' ? '/register' : '/login'} data-testid="link-auth-switch">{mode === 'login' ? 'Create an account' : 'Sign in'}</Link>
        </div>
        <p className="mt-9 text-center text-xs leading-5 text-muted-foreground">Private by design. Your placement journey belongs to you.</p>
      </div>
    </section>
  </main>;
}

function BrandMark({ light = false }: { light?: boolean }) {
  return <span aria-hidden="true" className={`grid h-9 w-9 place-items-center rounded-xl ${light ? 'bg-[#d1e0c4] text-[#245b4c]' : 'bg-primary text-primary-foreground'}`}><Activity size={19} strokeWidth={2.4} /></span>;
}

function AppShell({ children, active }: { children: React.ReactNode; active: 'dashboard' | 'applications' | 'gmail' | 'review' | 'calendar' }) {
  const [location, setLocation] = useLocation();
  const qc = useQueryClient();
  const user = useGetCurrentUser({ query: { retry: false, queryKey: getGetCurrentUserQueryKey() } });
  const gmailStatus = useGetGmailStatus({
    query: {
      enabled: Boolean(user.data),
      queryKey: getGetGmailStatusQueryKey(),
    },
  });
  const logout = useLogout();

  if (user.isLoading) return <div className="app-shell grid min-h-[100dvh] place-items-center"><LoadingState /></div>;
  if (!user.data) { if (location !== '/login') setLocation('/login'); return null; }
  const signOut = () => logout.mutate(undefined, { onSuccess: () => { qc.clear(); setLocation('/login'); } });
  const email = user.data.email;
  const needsReviewCount = gmailStatus.data?.emailEventCounts?.needs_review || 0;

  return <div className="app-shell">
    <div className="grain" />
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-[248px] flex-col border-r border-border bg-sidebar px-5 py-6 md:flex">
      <Link href="/dashboard" className="flex items-center gap-3 px-1 text-sm font-bold tracking-tight" data-testid="link-brand"><BrandMark /><span>fieldnotes<span className="text-primary">/career</span></span></Link>
      <div className="mt-12 px-2"><p className="mono text-[10px] uppercase tracking-[.17em] text-muted-foreground">Your workspace</p></div>
      <nav className="mt-3 space-y-1" aria-label="Main navigation">
        <Link href="/dashboard" className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${active === 'dashboard' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`} data-testid="link-dashboard"><LayoutDashboard size={17} />Overview</Link>
        <Link href="/applications" className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${active === 'applications' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`} data-testid="link-applications"><BriefcaseBusiness size={17} />Applications</Link>
        <Link href="/calendar" className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${active === 'calendar' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`} data-testid="link-calendar"><CalendarDays size={17} />Calendar</Link>
        <Link href="/review" className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${active === 'review' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`} data-testid="link-review">
          <span className="flex items-center gap-3"><Inbox size={17} />Review</span>
          {needsReviewCount > 0 && <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-500 border border-amber-500/30" data-testid="badge-needs-review-count">{needsReviewCount}</span>}
        </Link>
        <Link href="/settings/gmail" className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${active === 'gmail' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`} data-testid="link-gmail"><Mail size={17} />Gmail</Link>
      </nav>
      <div className="mt-auto rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-primary" /><span className="mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">Private notebook</span></div>
        <p className="text-xs leading-5 text-muted-foreground">Every next step, kept in one place. Just for you.</p>
      </div>
      <div className="mt-4 flex items-center gap-3 border-t border-border px-1 pt-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold uppercase text-secondary-foreground">{email.slice(0, 1)}</span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium" data-testid="text-user-email">{email}</span>
        <NotificationBell />
        <button className="btn btn-quiet !p-2" aria-label="Sign out" onClick={signOut} disabled={logout.isPending} data-testid="button-sign-out"><LogOut size={16} /></button>
      </div>
    </aside>
    <header className="sticky top-0 z-10 flex h-[62px] items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur md:hidden">
      <Link href="/dashboard" className="flex items-center gap-2 text-sm font-bold" data-testid="link-brand-mobile-app"><BrandMark />fieldnotes<span className="text-primary">/career</span></Link>
      <div className="flex items-center gap-1">
        <Link href="/dashboard" aria-label="Overview" className={`btn btn-quiet !p-2 ${active === 'dashboard' ? 'text-primary' : ''}`} data-testid="mobile-link-dashboard"><LayoutDashboard size={19} /></Link>
        <Link href="/applications" aria-label="Applications" className={`btn btn-quiet !p-2 ${active === 'applications' ? 'text-primary' : ''}`} data-testid="mobile-link-applications"><BriefcaseBusiness size={19} /></Link>
        <Link href="/calendar" aria-label="Calendar" className={`btn btn-quiet !p-2 ${active === 'calendar' ? 'text-primary' : ''}`} data-testid="mobile-link-calendar"><CalendarDays size={19} /></Link>
        <Link href="/review" aria-label="Review" className={`relative btn btn-quiet !p-2 ${active === 'review' ? 'text-primary' : ''}`} data-testid="mobile-link-review">
          <Inbox size={19} />
          {needsReviewCount > 0 && <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-amber-500" />}
        </Link>
        <Link href="/settings/gmail" aria-label="Gmail" className={`btn btn-quiet !p-2 ${active === 'gmail' ? 'text-primary' : ''}`} data-testid="mobile-link-gmail"><Mail size={19} /></Link>
        <NotificationBell />
        <button onClick={signOut} aria-label="Sign out" className="btn btn-quiet !p-2" data-testid="mobile-button-sign-out"><LogOut size={18} /></button>
      </div>
    </header>
    <main className="mx-auto max-w-[1440px] px-4 pb-12 pt-7 md:ml-[248px] md:px-8 md:pt-10 xl:px-12">{children}</main>
  </div>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
    <div><p className="mono text-[10px] uppercase tracking-[.19em] text-primary">{eyebrow}</p><h1 className="display mt-2 text-3xl font-bold tracking-tight sm:text-[2.6rem]" data-testid="heading-page">{title}</h1><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{description}</p></div>
    {action && <div className="shrink-0">{action}</div>}
  </div>;
}

function Dashboard() {
  const summary = useGetDashboardSummary();
  const appsQuery = useListApplications();
  const [, setLocation] = useLocation();
  if (summary.isLoading) return <AppShell active="dashboard"><LoadingState /></AppShell>;
  if (summary.isError || !summary.data) return <AppShell active="dashboard"><ErrorState message={errorMessage(summary.error)} onRetry={() => summary.refetch()} /></AppShell>;
  const data = summary.data;

  const actionNeededCount = appsQuery.data?.filter((a) => a.actionRequired).length || 0;

  const metrics = [
    { label: 'Total', value: data.total, filter: 'All statuses', color: 'text-primary' },
    { label: 'Applied', value: data.counts.APPLIED, filter: 'APPLIED', color: 'text-[#717873] dark:text-[#b5b8b6]' },
    { label: 'Screening', value: data.counts.SCREENING, filter: 'SCREENING', color: 'text-[#207a7a] dark:text-[#5fd4d4]' },
    { label: 'Test', value: data.counts.TEST, filter: 'TEST', color: 'text-[#a87835] dark:text-[#e2bd78]' },
    { label: 'Interview', value: data.counts.INTERVIEW, filter: 'INTERVIEW', color: 'text-[#805ea7] dark:text-[#c5a6e7]' },
    { label: 'Accepted', value: data.counts.ACCEPTED, filter: 'ACCEPTED', color: 'text-[#38805e] dark:text-[#8bc9a5]' },
    { label: 'Rejected', value: data.counts.REJECTED, filter: 'REJECTED', color: 'text-[#a75549] dark:text-[#e5a097]' },
    { label: 'Withdrawn', value: data.counts.WITHDRAWN, filter: 'WITHDRAWN', color: 'text-[#858b87] dark:text-[#b1b5b2]' },
  ];
  const maxReject = Math.max(1, ...data.rejectionRounds.map((item) => item.count));
  return <AppShell active="dashboard">
    <PageHeading eyebrow="Your overview" title="Keep your bearings." description="A little perspective on where things stand, and what’s coming next." action={<button className="btn btn-primary" onClick={() => setLocation('/applications?new=1')} data-testid="button-add-application"><Plus size={17} />Add application</button>} />
    <div className="panel relative mb-6 overflow-hidden bg-[#245b4c] p-6 text-[#f5f1e7] sm:p-8">
      <div className="absolute -right-12 -top-24 h-72 w-72 rounded-full border border-white/10" /><div className="absolute right-14 top-10 h-44 w-44 rounded-full border border-white/10" />
      <div className="relative flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
        <div><p className="mono text-[10px] uppercase tracking-[.2em] text-[#c1d6b8]">The bigger picture</p><p className="display mt-3 text-5xl font-bold tracking-tight">{data.total}<span className="ml-3 text-lg font-medium text-[#d2dfcf]">applications tracked</span></p><p className="mt-3 max-w-lg text-sm leading-6 text-[#dce7d9]">You’ve made room for possibility. Keep capturing the details as your search takes shape.</p></div>
        <div className="flex flex-wrap items-center gap-3 self-start sm:self-auto">
          {actionNeededCount > 0 && (
            <button
              onClick={() => setLocation('/applications?actionRequired=1')}
              className="flex items-center gap-2.5 rounded-xl border border-amber-400/30 bg-amber-500/20 px-3.5 py-2.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/30 transition-all"
              data-testid="banner-action-needed"
            >
              <CircleAlert size={16} className="text-amber-300" />
              <span>{actionNeededCount} {actionNeededCount === 1 ? 'action required' : 'actions required'}</span>
            </button>
          )}
          <div className="flex items-center gap-3 rounded-xl border border-white/15 bg-white/5 px-4 py-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#d3e1c5] text-[#245b4c]"><TrendingUp size={18} /></span><span><span className="block text-lg font-bold leading-tight">{data.counts.INTERVIEW + data.counts.ACCEPTED}</span><span className="text-xs text-[#d2dfcf]">interviews & offers</span></span></div>
        </div>
      </div>
    </div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
      {metrics.map((metric, index) => <button key={metric.label} type="button" onClick={() => setLocation(metric.filter === 'All statuses' ? '/applications' : `/applications?status=${encodeURIComponent(metric.filter)}`)} className="panel fade-up p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ animationDelay: `${index * 45}ms` }} data-testid={`metric-card-${metric.label.toLowerCase()}`} aria-label={`Show ${metric.label} applications: ${metric.value}`}>
        <p className="text-xs font-medium text-muted-foreground">{metric.label}</p>
        <p className={`display mt-3 text-3xl font-bold ${metric.color}`} data-testid={`text-metric-${metric.label.toLowerCase()}`}>{metric.value}</p>
      </button>)}
    </div>
    <div className="mt-5 grid gap-5 lg:grid-cols-[1.05fr_.95fr]">
      <section className="panel p-5 sm:p-6">
        <div className="mb-6 flex items-start justify-between"><div><p className="mono text-[10px] uppercase tracking-[.15em] text-primary">Learning as you go</p><h2 className="display mt-1 text-xl font-bold">Rejection-round insights</h2><p className="mt-1 text-xs text-muted-foreground">A pattern is useful information, not a verdict.</p></div><span className="grid h-9 w-9 place-items-center rounded-lg bg-secondary text-secondary-foreground"><Activity size={17} /></span></div>
        {data.rejectionRounds.length ? <div className="space-y-4" data-testid="list-rejection-rounds">{data.rejectionRounds.map((item, i) => <div key={item.round} className="grid grid-cols-[minmax(120px,1fr)_2fr_30px] items-center gap-3" data-testid={`rejection-round-${i}`}>
          <span className="truncate text-xs font-medium">{item.round}</span><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-[#ce8761] transition-all duration-500" style={{ width: `${Math.max(6, item.count / maxReject * 100)}%` }} /></div><span className="mono text-right text-xs text-muted-foreground">{item.count}</span>
        </div>)}</div> : <div className="rounded-xl border border-dashed border-border bg-muted/30 px-5 py-8 text-center" data-testid="empty-rejection-rounds"><span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-accent text-primary"><Sparkles size={18} /></span><p className="mt-3 text-sm font-semibold">No closed chapters yet</p><p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-muted-foreground">If a rejection comes along, recording its round can help you spot where to focus next.</p></div>}
      </section>
      <section className="panel p-5 sm:p-6">
        <div className="mb-5 flex items-start justify-between"><div><p className="mono text-[10px] uppercase tracking-[.15em] text-primary">Coming up</p><h2 className="display mt-1 text-xl font-bold">Next seven days</h2><p className="mt-1 text-xs text-muted-foreground">Keep the next conversation in view.</p></div><span className="grid h-9 w-9 place-items-center rounded-lg bg-secondary text-secondary-foreground"><CalendarDays size={17} /></span></div>
        {data.upcomingDeadlines.length ? <div className="divide-y divide-border" data-testid="list-upcoming-deadlines">{data.upcomingDeadlines.map((app) => <div key={app.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0" data-testid={`deadline-${app.id}`}>
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-primary"><CalendarDays size={16} /></div>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{app.companyName}</p><p className="truncate text-xs text-muted-foreground">{app.role || 'Application'} · {app.status}</p></div>
          <span className="text-right text-xs font-semibold">{formatDeadline(app)}</span>
        </div>)}</div> : <div className="rounded-xl border border-dashed border-border bg-muted/30 px-5 py-8 text-center" data-testid="empty-upcoming-deadlines"><span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-secondary text-secondary-foreground"><Check size={18} /></span><p className="mt-3 text-sm font-semibold">A little breathing room</p><p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-muted-foreground">No deadlines in the coming week. Add a next date to an application and it’ll show up here.</p></div>}
      </section>
    </div>
    <section className="mt-5 panel flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#f2e8d6] text-[#9a6c35] dark:bg-[#483a29] dark:text-[#e8bd7b]"><ArrowDownWideNarrow size={18} /></div><div><p className="text-sm font-semibold">Your pipeline, at a glance</p><p className="text-xs text-muted-foreground">{STATUSES.map((status) => `${STATUS_LABELS[status]} ${data.counts[status]}`).join('  ·  ')}</p></div></div>
      <Link href="/applications" className="btn btn-subtle w-full sm:w-auto" data-testid="link-view-applications">View applications <ArrowRight size={15} /></Link>
    </section>
  </AppShell>;
}

type AppFormProps = { initial?: Application; appId?: string; onClose: () => void };
function ApplicationEditor({ initial, appId, onClose }: AppFormProps) {
  const qc = useQueryClient();
  const detail = useGetApplication(appId || '', { query: { enabled: Boolean(appId), queryKey: getGetApplicationQueryKey(appId || '') } });
  const create = useCreateApplication();
  const update = useUpdateApplication();
  const app = appId ? detail.data : initial;
  const defaults = useMemo(() => app ? {
    companyName: app.companyName, role: app.role || '', packageLpa: app.packageLpa ?? null,
    location: app.location || '', appliedDate: app.appliedDate?.slice(0, 10) || emptyApplication.appliedDate,
    mode: app.mode, status: app.status, nextDate: app.nextDate?.slice(0, 10) || '',
    contactName: app.contactName || '', contactEmailOrPhone: app.contactEmailOrPhone || '',
    jobLink: app.jobLink || '', notes: app.notes || '', rejectionRound: app.rejectionRound || null,
    rejectionDate: app.rejectionDate?.slice(0, 10) || '', rejectionReason: app.rejectionReason || ''
  } as ApplicationInput : emptyApplication, [app]);
  const form = useForm<ApplicationInput>({ values: defaults });
  const save = form.handleSubmit((values) => {
    const normalized = {
      ...values,
      packageLpa: values.packageLpa === null || values.packageLpa === undefined ? null : Number(values.packageLpa),
      role: values.role || null, location: values.location || null, nextDate: values.nextDate || null,
      contactName: values.contactName || null, contactEmailOrPhone: values.contactEmailOrPhone || null,
      jobLink: values.jobLink || null, notes: values.notes || null,
      rejectionRound: values.status === 'REJECTED' ? values.rejectionRound || null : null,
      rejectionDate: values.status === 'REJECTED' ? values.rejectionDate || null : null,
      rejectionReason: values.status === 'REJECTED' ? values.rejectionReason || null : null
    };
    const done = () => {
      qc.invalidateQueries({ queryKey: getListApplicationsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      if (appId) qc.invalidateQueries({ queryKey: getGetApplicationQueryKey(appId) });
      onClose();
    };
    if (appId) update.mutate({ id: appId, data: normalized }, { onSuccess: done });
    else create.mutate({ data: normalized }, { onSuccess: done });
  });
  const busy = create.isPending || update.isPending;
  if (appId && detail.isLoading) return <ModalFrame title="Loading application" onClose={onClose}><LoadingState /></ModalFrame>;
  if (appId && (detail.isError || !app)) return <ModalFrame title="Application unavailable" onClose={onClose}><ErrorState message={errorMessage(detail.error)} onRetry={() => detail.refetch()} /></ModalFrame>;
  return <ModalFrame title={appId ? 'Edit application' : 'Add an application'} onClose={onClose}>
    <p className="mb-5 text-sm text-muted-foreground">Keep the details that help you pick up the thread later.</p>
    <Form {...form}>
      <form onSubmit={save} className="scrollbar-thin max-h-[70vh] space-y-5 overflow-y-auto pr-1" data-testid="form-application">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><label className="label">Company <span className="text-destructive">*</span></label><input className="field" placeholder="e.g. Northstar Labs" {...form.register('companyName', { required: 'Company name is required', maxLength: { value: 160, message: 'Use 160 characters or fewer' } })} data-testid="input-company-name" /><FieldError message={form.formState.errors.companyName?.message} /></div>
          <div><label className="label">Role</label><input className="field" placeholder="Software engineer" {...form.register('role', { maxLength: { value: 160, message: 'Use 160 characters or fewer' } })} data-testid="input-role" /><FieldError message={form.formState.errors.role?.message} /></div>
          <div><label className="label">Package (LPA)</label><input className="field" type="number" min="0" max="1000" step=".1" placeholder="e.g. 12.5" {...form.register('packageLpa', { setValueAs: (v) => v === '' ? null : Number(v), validate: (v) => v == null || (Number.isFinite(v) && v >= 0 && v <= 1000) || 'Enter a package between 0 and 1,000 LPA' })} data-testid="input-package" /><FieldError message={form.formState.errors.packageLpa?.message} /></div>
          <div><label className="label">Location</label><input className="field" placeholder="City or remote" {...form.register('location', { maxLength: { value: 160, message: 'Use 160 characters or fewer' } })} data-testid="input-location" /><FieldError message={form.formState.errors.location?.message} /></div>
          <div><label className="label">Application mode</label><select className="field" {...form.register('mode')} data-testid="select-mode">{MODES.map((mode) => <option key={mode} value={mode}>{mode === 'Unknown' ? 'Not specified' : mode}</option>)}</select></div>
          <div><label className="label">Status</label><select className="field" {...form.register('status')} data-testid="select-status">{STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select></div>
          <div><label className="label">Applied on</label><input className="field" type="date" {...form.register('appliedDate', { required: 'Applied date is required' })} data-testid="input-applied-date" /><FieldError message={form.formState.errors.appliedDate?.message} /></div>
          <div><label className="label">Next date</label><input className="field" type="date" {...form.register('nextDate')} data-testid="input-next-date" /></div>
          <div><label className="label">Contact name</label><input className="field" placeholder="Recruiter or contact" {...form.register('contactName', { maxLength: { value: 160, message: 'Use 160 characters or fewer' } })} data-testid="input-contact-name" /><FieldError message={form.formState.errors.contactName?.message} /></div>
          <div><label className="label">Contact details</label><input className="field" placeholder="Email or phone" {...form.register('contactEmailOrPhone', { maxLength: { value: 254, message: 'Use 254 characters or fewer' } })} data-testid="input-contact-details" /><FieldError message={form.formState.errors.contactEmailOrPhone?.message} /></div>
          <div className="sm:col-span-2"><label className="label">Job link</label><input className="field" type="url" placeholder="https://" {...form.register('jobLink', { maxLength: { value: 2048, message: 'Use a shorter link' }, validate: (value) => !value || value.toLowerCase().startsWith('https://') || value.toLowerCase().startsWith('http://') || 'Use a link that starts with http:// or https://' })} data-testid="input-job-link" /><FieldError message={form.formState.errors.jobLink?.message} /></div>
          {form.watch('status') === 'REJECTED' && <div className="sm:col-span-2 rounded-xl border border-[#e5c2b7] bg-[#fbf0ec] p-4 dark:border-[#603e38] dark:bg-[#322320]" data-testid="rejection-fields">
            <p className="mb-3 text-sm font-semibold text-[#994d3d] dark:text-[#e6a493]">A note for future you</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className="label">Round</label><select className="field" {...form.register('rejectionRound')} data-testid="select-rejection-round"><option value="">Choose a round</option>{ROUNDS.map((round) => <option key={round} value={round}>{round}</option>)}</select></div>
              <div><label className="label">Rejection date</label><input className="field" type="date" {...form.register('rejectionDate')} data-testid="input-rejection-date" /></div>
               <div className="sm:col-span-2"><label className="label">Feedback or reason</label><textarea className="field min-h-20 resize-y" placeholder="What would be useful to remember?" {...form.register('rejectionReason', { maxLength: { value: 5000, message: 'Use 5,000 characters or fewer' } })} data-testid="input-rejection-reason" /><FieldError message={form.formState.errors.rejectionReason?.message} /></div>
            </div>
          </div>}
          <div className="sm:col-span-2"><label className="label">Notes</label><textarea className="field min-h-24 resize-y" placeholder="People you spoke with, what stood out, what to follow up on…" {...form.register('notes', { maxLength: { value: 10000, message: 'Use 10,000 characters or fewer' } })} data-testid="input-notes" /><FieldError message={form.formState.errors.notes?.message} /></div>
        </div>
        {(create.error || update.error) && <div role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive" data-testid="application-save-error">{errorMessage(create.error || update.error)}</div>}
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-card py-3"><button type="button" className="btn btn-subtle" onClick={onClose} data-testid="button-cancel-application">Cancel</button><button type="submit" disabled={busy} className="btn btn-primary" data-testid="button-save-application">{busy && <LoaderCircle size={16} className="animate-spin" />}{appId ? 'Save changes' : 'Add application'}</button></div>
      </form>
    </Form>
  </ModalFrame>;
}

function ModalFrame({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#18211f]/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label={title} className="panel fade-up w-full max-w-2xl rounded-b-none p-5 sm:rounded-2xl sm:p-7">
      <div className="mb-2 flex items-center justify-between"><h2 className="display text-2xl font-bold">{title}</h2><button className="btn btn-quiet !p-2" onClick={onClose} aria-label="Close" data-testid="button-close-dialog"><X size={19} /></button></div>{children}
    </section>
  </div>;
}

function Applications() {
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(() => {
    const selected = new URLSearchParams(window.location.search).get('status');
    return selected && STATUSES.includes(selected as ApplicationStatus) ? selected : 'All statuses';
  });
  const [onlyActionRequired, setOnlyActionRequired] = useState(() => {
    return new URLSearchParams(window.location.search).get('actionRequired') === '1';
  });
  const [sort, setSort] = useState('recently-updated');
  const [editingId, setEditingId] = useState<string | undefined>();
  const [isAdding, setIsAdding] = useState(false);
  const [timelineApp, setTimelineApp] = useState<Application | null>(null);
  const [showDeleteSamplesDialog, setShowDeleteSamplesDialog] = useState(false);
  const [deleteConfirmApp, setDeleteConfirmApp] = useState<Application | null>(null);

  const qc = useQueryClient();
  const appsQuery = useListApplications();
  const exportQuery = useExportApplications({ query: { enabled: false, queryKey: getExportApplicationsQueryKey() } });
  const deleteSamples = useDeleteSampleApplications();
  const deleteOne = useDeleteApplication();
  const hasSamples = appsQuery.data?.some((app) => app.isSample) || false;

  const list = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return [...(appsQuery.data || [])].filter((app) => {
      const matchStatus = status === 'All statuses' || app.status === status;
      const matchAction = !onlyActionRequired || app.actionRequired;
      const matchTerm = !term || [app.companyName, app.role, app.location, app.notes, app.stageDetail, app.actionNote].some((value) => value?.toLocaleLowerCase().includes(term));
      return matchStatus && matchAction && matchTerm;
    }).sort((a, b) => {
      if (sort === 'recently-updated') {
        const getTs = (app: Application) => Math.max(
          app.updatedAt ? new Date(app.updatedAt).getTime() : 0,
          app.lastEmailAt ? new Date(app.lastEmailAt).getTime() : 0,
        );
        return getTs(b) - getTs(a);
      }
      if (sort === 'oldest') return a.appliedDate.localeCompare(b.appliedDate);
      if (sort === 'company') return a.companyName.localeCompare(b.companyName);
      if (sort === 'package') return (b.packageLpa ?? -Infinity) - (a.packageLpa ?? -Infinity);
      return b.appliedDate.localeCompare(a.appliedDate); // 'recent'
    });
  }, [appsQuery.data, search, status, onlyActionRequired, sort]);

  const runExport = async () => {
    try {
      const result = await exportQuery.refetch();
      if (!result.data) return;
      const blob = new Blob([result.data], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'placement-applications.csv'; anchor.click(); URL.revokeObjectURL(url);
    } catch { /* query error is shown inline */ }
  };

  const doRemoveSamples = () => {
    deleteSamples.mutate(undefined, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListApplicationsQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); setShowDeleteSamplesDialog(false); } });
  };

  const doRemoveApp = (app: Application) => {
    deleteOne.mutate({ id: app.id }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListApplicationsQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); setDeleteConfirmApp(null); } });
  };

  const removeSamples = () => {
    setShowDeleteSamplesDialog(true);
  };

  const removeApp = (app: Application) => {
    setDeleteConfirmApp(app);
  };

  useEffect(() => {
    const currentSearch = searchString || window.location.search;
    if (currentSearch.includes('new=1')) {
      setIsAdding(true);
      setLocation('/applications');
    }
    const params = new URLSearchParams(currentSearch);
    const selected = params.get('status');
    if (selected && STATUSES.includes(selected as ApplicationStatus)) {
      setStatus(selected);
    }
    if (params.get('actionRequired') === '1') {
      setOnlyActionRequired(true);
    }
  }, [searchString, setLocation]);

  return <AppShell active="applications">
    <PageHeading eyebrow="Your notebook" title="Applications" description="The little details are what make it easier to pick the thread back up." action={<button onClick={() => setIsAdding(true)} className="btn btn-primary" data-testid="button-add-application"><Plus size={17} />Add application</button>} />
    <div className="mb-5 flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-card/70 p-2 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1"><Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input type="search" className="field border-0 bg-transparent pl-10 shadow-none focus:shadow-none" placeholder="Search companies, roles, notes…" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-applications" /></label>
        <div className="flex flex-wrap gap-2">
          <label className="relative flex-1 sm:w-44"><Filter size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><select className="field appearance-none pl-9 pr-8 text-sm" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="select-filter-status"><option value="All statuses">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select><ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" /></label>
          <label className="relative flex-1 sm:w-40"><select className="field appearance-none pr-8 text-sm" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort applications" data-testid="select-sort-applications"><option value="recently-updated">Recently updated</option><option value="recent">Newest first</option><option value="oldest">Oldest first</option><option value="company">Company A–Z</option><option value="package">Highest package</option></select><ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" /></label>
          <button
            type="button"
            onClick={() => setOnlyActionRequired(!onlyActionRequired)}
            className={`btn text-xs !py-1.5 !px-3 border ${
              onlyActionRequired
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'btn-subtle text-muted-foreground border-border'
            }`}
            data-testid="filter-action-required"
          >
            Action needed
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" data-testid="text-application-count">{appsQuery.data ? `${list.length} of ${appsQuery.data.length} ${appsQuery.data.length === 1 ? 'application' : 'applications'}` : 'Your list'}</p>
        <div className="flex gap-2">
          {hasSamples && <button disabled={deleteSamples.isPending} onClick={removeSamples} className="btn btn-quiet !px-2.5 !text-xs" data-testid="button-remove-samples"><Trash2 size={14} />Remove samples</button>}
          <button disabled={exportQuery.isFetching || !appsQuery.data?.length} onClick={runExport} className="btn btn-subtle !px-2.5 !text-xs" data-testid="button-export-csv">{exportQuery.isFetching ? <LoaderCircle size={14} className="animate-spin" /> : <Download size={14} />}Export CSV</button>
        </div>
      </div>
      {exportQuery.error && <div className="rounded-lg bg-destructive/5 p-3 text-xs text-destructive" data-testid="export-error">{errorMessage(exportQuery.error)}</div>}
      {deleteSamples.error && <div className="rounded-lg bg-destructive/5 p-3 text-xs text-destructive" data-testid="delete-samples-error">{errorMessage(deleteSamples.error)}</div>}
    </div>
    {appsQuery.isLoading ? <LoadingState label="Loading applications" /> :
      appsQuery.isError ? <ErrorState message={errorMessage(appsQuery.error)} onRetry={() => appsQuery.refetch()} /> :
      appsQuery.data?.length === 0 ? <div className="panel flex flex-col items-center px-6 py-16 text-center" data-testid="empty-applications">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent text-primary"><FilePlus2 size={25} /></span><p className="display mt-5 text-2xl font-bold">Start with one possibility.</p><p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Add your first application. Keep the people, details and next steps together as you go.</p><button onClick={() => setIsAdding(true)} className="btn btn-primary mt-6" data-testid="button-empty-add-application"><Plus size={16} />Add your first application</button>
      </div> : list.length === 0 ? <div className="panel flex flex-col items-center px-6 py-12 text-center" data-testid="empty-filter-results"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-secondary text-secondary-foreground"><Search size={20} /></span><p className="mt-4 font-semibold">Nothing matches just yet</p><p className="mt-1 text-sm text-muted-foreground">Try another search or loosen the status filter.</p><button onClick={() => { setSearch(''); setStatus('All statuses'); setOnlyActionRequired(false); }} className="btn btn-subtle mt-4" data-testid="button-clear-filters">Clear filters</button></div> :
      <div className="grid gap-3" data-testid="list-applications">{list.map((app) => <ApplicationCard key={app.id} application={app} onEdit={() => setEditingId(app.id)} onDelete={() => removeApp(app)} onOpenTimeline={() => setTimelineApp(app)} deleting={deleteOne.isPending} />)}</div>}
    {deleteOne.error && <div className="mt-4 rounded-lg bg-destructive/5 p-3 text-sm text-destructive" data-testid="delete-application-error">{errorMessage(deleteOne.error)}</div>}
    {isAdding && <ApplicationEditor onClose={() => setIsAdding(false)} />}
    {editingId && <ApplicationEditor appId={editingId} onClose={() => setEditingId(undefined)} />}
    <ApplicationTimelineDrawer application={timelineApp} onClose={() => setTimelineApp(null)} />
    <ConfirmDialog
      isOpen={showDeleteSamplesDialog}
      title="Remove sample applications"
      description="Remove all sample applications? Your own applications will stay untouched."
      confirmLabel="Remove samples"
      isDestructive
      onConfirm={doRemoveSamples}
      onCancel={() => setShowDeleteSamplesDialog(false)}
    />
    {deleteConfirmApp && (
      <ConfirmDialog
        isOpen={Boolean(deleteConfirmApp)}
        title="Delete application"
        description={`Delete the ${deleteConfirmApp.companyName} application? This can’t be undone.`}
        confirmLabel="Delete"
        isDestructive
        onConfirm={() => doRemoveApp(deleteConfirmApp)}
        onCancel={() => setDeleteConfirmApp(null)}
      />
    )}
  </AppShell>;
}

function ApplicationCard({ application: app, onEdit, onDelete, onOpenTimeline, deleting }: { application: Application; onEdit: () => void; onDelete: () => void; onOpenTimeline: () => void; deleting: boolean }) {
  return <article className="panel group overflow-hidden p-4 transition-shadow hover:shadow-md sm:p-5" data-testid={`card-application-${app.id}`}>
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground"><BriefcaseBusiness size={18} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-bold" data-testid={`text-company-${app.id}`}>{app.companyName}</h3>
            <StatusPill status={app.status} />
            {app.source === 'email' && (
              <span className="rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary" data-testid={`badge-source-email-${app.id}`}>
                From email
              </span>
            )}
            {app.actionRequired && (
              <span className="rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[10px] font-semibold text-amber-500" title={app.actionNote || undefined} data-testid={`badge-action-needed-${app.id}`}>
                Action needed
              </span>
            )}
            {app.isSample && <span className="rounded-full border border-border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground" data-testid={`badge-sample-${app.id}`}>Sample</span>}
          </div>
          {app.stageDetail && (
            <p className="mt-0.5 text-xs font-medium text-foreground/85" data-testid={`text-stage-detail-${app.id}`}>
              {app.stageDetail}
            </p>
          )}
          <p className="mt-1 text-sm text-muted-foreground">{app.role || 'Role not specified'}{app.packageLpa != null && <span className="ml-2 mono text-xs text-foreground/70">{app.packageLpa} LPA</span>}</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {app.location && <span className="inline-flex items-center gap-1"><MapPin size={13} />{app.location}</span>}
            <span>Applied {dateLabel(app.appliedDate)}</span>
            <span>{app.mode === 'Unknown' ? 'Not specified' : app.mode}</span>
            {(app.nextAt || app.nextDate) && (
              <span className="inline-flex items-center gap-1 font-semibold text-primary" data-testid={`deadline-label-${app.id}`}>
                <CalendarDays size={13} />Next: {formatDeadline(app)}
              </span>
            )}
          </div>
          {app.actionRequired && app.actionNote && (
            <div className="mt-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
              <span className="font-semibold text-amber-400">Action:</span> {app.actionNote}
            </div>
          )}
          {app.status === 'REJECTED' && (app.rejectionRound || app.rejectionReason) && <div className="mt-3 rounded-lg border border-[#ead0c8] bg-[#fbf3f0] px-3 py-2 dark:border-[#503b36] dark:bg-[#302521]" data-testid={`rejection-feedback-${app.id}`}><p className="text-[11px] font-bold uppercase tracking-wide text-[#a55b49] dark:text-[#e3a18e]">Rejection notes{app.rejectionRound ? ` · ${app.rejectionRound}` : ''}</p>{app.rejectionReason && <p className="mt-1 line-clamp-2 text-xs leading-5 text-foreground/75">{app.rejectionReason}</p>}</div>}
          {app.notes && <p className="mt-3 line-clamp-2 max-w-3xl text-xs leading-5 text-muted-foreground">{app.notes}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 self-end sm:self-start">
        <button className="btn btn-quiet !p-2" onClick={onOpenTimeline} title="View timeline history" aria-label={`Timeline for ${app.companyName}`} data-testid={`button-timeline-${app.id}`}><History size={15} /></button>
        {app.jobLink && <a className="btn btn-quiet !px-2.5 !text-xs" href={app.jobLink} target="_blank" rel="noreferrer" data-testid={`link-job-${app.id}`}>Job link <ArrowRight size={13} /></a>}
        <button className="btn btn-quiet !p-2" onClick={onEdit} aria-label={`Edit ${app.companyName}`} data-testid={`button-edit-${app.id}`}><Pencil size={15} /></button>
        <button className="btn btn-quiet !p-2 hover:!text-destructive" onClick={onDelete} disabled={deleting} aria-label={`Delete ${app.companyName}`} data-testid={`button-delete-${app.id}`}><Trash2 size={15} /></button>
      </div>
    </div>
  </article>;
}

function DashboardRoute() { return <Dashboard />; }
function CalendarRoute() { return <AppShell active="calendar"><CalendarPage /></AppShell>; }
function ApplicationsRoute() { return <Applications />; }
function ReviewRoute() { return <AppShell active="review"><ReviewQueuePage /></AppShell>; }
function GmailRoute() { return <AppShell active="gmail"><GmailSettingsPage /></AppShell>; }
function ProtectedGate({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const user = useGetCurrentUser({ query: { retry: false, queryKey: getGetCurrentUserQueryKey() } });
  useEffect(() => { if (!user.isLoading && !user.data && location !== '/login' && location !== '/register') setLocation('/login'); }, [user.isLoading, user.data, location, setLocation]);
  if (user.isLoading) return <div className="app-shell grid min-h-[100dvh] place-items-center"><LoadingState /></div>;
  if (!user.data) return null;
  return <>{children}</>;
}
function SystemTheme() {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);
  return null;
}
function Router() {
  return <Switch>
    <Route path="/"><ProtectedGate><DashboardRoute /></ProtectedGate></Route>
    <Route path="/login"><AuthPage mode="login" /></Route>
    <Route path="/register"><AuthPage mode="register" /></Route>
    <Route path="/dashboard"><ProtectedGate><DashboardRoute /></ProtectedGate></Route>
    <Route path="/applications"><ProtectedGate><ApplicationsRoute /></ProtectedGate></Route>
    <Route path="/review"><ProtectedGate><ReviewRoute /></ProtectedGate></Route>
    <Route path="/settings/gmail"><ProtectedGate><GmailRoute /></ProtectedGate></Route>
    <Route path="/calendar"><ProtectedGate><CalendarRoute /></ProtectedGate></Route>
    <Route component={NotFound} />
  </Switch>;
}
function App() {
  return <QueryClientProvider client={queryClient}><SystemTheme /><Router /></QueryClientProvider>;
}

export default App;
