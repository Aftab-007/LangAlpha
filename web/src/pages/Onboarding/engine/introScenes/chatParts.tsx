import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  PanelRight,
  Paperclip,
  type LucideProps,
} from 'lucide-react';
import { useLocale } from '@/hooks/useLocale';
import { compactNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Favicon } from '@/pages/ChatAgent/components/Favicon';
import {
  messagingAppDomain,
  messagingAppName,
} from '@/pages/ChatAgent/components/messaging/messageDelivery';
import { look, VIEW, type Shot } from './camera';
import type { Bar } from './charts';
import { ease, progress, useSceneTime } from './clock';
import { Appear, Loader, rv } from './kit';

/* The chat transcript's parts, shared by the chat scenes: the agent's reply,
   activity rows, the workspace line, the hand-off card, a workflow run, the
   caption on a message from another agent, a chart in the reply, and the
   files a turn produced. Each is a small copy of the component the app draws
   it with (named on each). */
/* eslint-disable react-refresh/only-export-components -- shared parts:
   scene components plus the style helper */

export type Icon = ComponentType<LucideProps>;

/** The chat scenes draw each page at the view's size, so the wide shot is
    the whole page and every other shot a crop of it. */
export const PAGE = { width: VIEW.width, height: VIEW.height };

/** The camera's shot arriving at `at`: centred as near the page point
    (`x`, `y`) as the page allows at `zoom`, the move in taking `dur` ms. */
export const shot = (at: number, x: number, y: number, zoom: number, dur?: number): Shot => ({
  at,
  dur,
  ...look(x, y, zoom),
});

/** The wide shot: the whole page, as the app draws it. */
export const wide = (at: number, dur?: number): Shot =>
  shot(at, PAGE.width / 2, PAGE.height / 2, 1, dur);

/** A solid card in the chat transcript (`--color-bg-tool-card`), as tool results sit. */
export const toolCard: CSSProperties = {
  background: 'var(--color-bg-tool-card)',
  borderColor: 'var(--color-border-muted)',
};

/* ── the chat transcript ───────────────────────────────────────────────── */

/**
 * The agent's reply streaming in from `at`, `cps` characters a second, in
 * the transcript's body text; `**bold**` spans render bold, as the app's
 * markdown does. Takes no room until its first character lands.
 */
export function Reply({
  text,
  at,
  cps = 150,
  className,
}: {
  text: string;
  at: number;
  cps?: number;
  className?: string;
}) {
  const t = useSceneTime();
  const typed = Math.floor(((t - at) * cps) / 1000);
  if (typed <= 0) return null;
  // each span with where its first character falls in the plain text
  const spans: { bold: boolean; body: string; from: number }[] = [];
  let from = 0;
  for (const span of text.split(/(\*\*[^*]+\*\*)/).filter(Boolean)) {
    const bold = span.startsWith('**');
    const body = bold ? span.slice(2, -2) : span;
    spans.push({ bold, body, from });
    from += body.length;
  }
  return (
    <p
      className={cn('text-[0.5rem] leading-[1.45]', className)}
      style={{ color: 'var(--iv-text)' }}
    >
      {spans.map(({ bold, body, from }, i) => {
        if (typed <= from) return null;
        const shown = body.slice(0, typed - from);
        return bold ? (
          <b key={i} className="font-semibold">
            {shown}
          </b>
        ) : (
          <span key={i}>{shown}</span>
        );
      })}
    </p>
  );
}

/** What a settled activity row acted on: the app's mono `.obj` pill. */
export function Pill({ children }: { children: ReactNode }) {
  return (
    <span
      className="truncate font-mono text-[0.4375rem] leading-none"
      style={{ color: 'var(--Labels-Secondary)' }}
    >
      {children}
    </span>
  );
}

/** One row of a turn's activity (`ToolCallRow`, `ReasoningRow`): the tool's
    icon, its running verb shimmering until `done`, then its title and what
    it acted on. */
export function ActivityRow({
  icon: RowIcon,
  verb,
  title,
  after,
  at,
  done,
}: {
  icon: Icon;
  verb: string;
  title: string;
  after?: ReactNode;
  at: number;
  done: number;
}) {
  const live = useSceneTime() < done;
  return (
    <Appear at={at} className="flex items-center gap-1.5">
      <RowIcon className="h-2 w-2 shrink-0" style={{ color: 'var(--Labels-Secondary)' }} />
      {live ? (
        <span className="intro-shimmer truncate text-[0.5rem] leading-none">{verb}</span>
      ) : (
        <>
          <span className="shrink-0 text-[0.5rem] leading-none" style={{ color: 'var(--iv-text)' }}>
            {title}
          </span>
          {after}
        </>
      )}
    </Appear>
  );
}

/** The Chief of Staff creating a workspace (`CreateWorkspaceCard`): the
    card's header with its loader until `done`, then the one line it settles
    to. */
export function WorkspaceLine({ name, at, done }: { name: string; at: number; done: number }) {
  const { t } = useTranslation();
  const pending = useSceneTime() < done;
  return (
    <Appear at={at} className="flex min-w-0 items-center gap-1">
      {pending ? (
        <>
          <FolderPlus className="h-2 w-2 shrink-0" style={{ color: 'var(--color-accent-light)' }} />
          <span
            className="truncate text-[0.5rem] font-medium leading-none"
            style={{ color: 'var(--iv-text)' }}
          >
            {t('chat.createWorkspaceCard.title')}
          </span>
          <span className="ml-auto flex">
            <Loader color="var(--color-icon-muted)" className="text-[0.4375rem]" />
          </span>
        </>
      ) : (
        <>
          <ChevronRight className="h-2 w-2 shrink-0" style={{ color: 'var(--color-icon-muted)' }} />
          <Check className="h-2 w-2 shrink-0" style={{ color: 'var(--color-accent-light)' }} />
          <span
            className="truncate text-[0.5rem] leading-none"
            style={{ color: 'var(--iv-text-3)' }}
          >
            {t('chat.createWorkspaceCard.created', { name })}
          </span>
        </>
      )}
    </Appear>
  );
}

/** A hand-off to an Analyst under way (`PTCAgentCard`, its mission panel):
    the workspace in small mono caps and the run's status, the thread's
    title with the brief under it, then a rule over what the run is doing
    and the way into its thread. Starting until `started`, working until
    `finished`, then completed. */
export function HandoffCard({
  workspace,
  title,
  brief,
  at,
  started,
  finished = Number.POSITIVE_INFINITY,
}: {
  workspace: string;
  title: string;
  brief: string;
  at: number;
  started: number;
  finished?: number;
}) {
  const { t } = useTranslation();
  const now = useSceneTime();
  const live = now < finished;
  const [label, hint] =
    now < started
      ? ['chat.ptcCard.statusStarting', 'chat.ptcCard.hintProvisioning']
      : live
        ? ['chat.ptcCard.statusWorking', 'chat.ptcCard.hintWorking']
        : ['chat.ptcCard.statusCompleted', null];
  const muted = 'var(--color-border-muted)';
  return (
    <Appear at={at}>
      <div
        className="flex flex-col rounded-md border px-2 pb-1.5 pt-1.5"
        style={{ ...toolCard, borderColor: live ? 'var(--color-border-default)' : muted }}
      >
        <div className="flex items-center gap-1">
          <span
            className={cn(
              'truncate font-mono text-[0.375rem] font-medium uppercase',
              'leading-none tracking-[0.08em]'
            )}
            style={{ color: 'var(--color-text-quaternary)' }}
          >
            {workspace}
          </span>
          <span
            className={cn(
              'ml-auto flex shrink-0 items-center gap-0.5',
              'text-[0.4375rem] font-medium leading-none'
            )}
            style={{ color: 'var(--iv-text-3)' }}
          >
            {live ? (
              <Loader color="var(--color-accent-primary)" className="text-[0.4375rem]" />
            ) : (
              <Check
                className="intro-pop h-2 w-2"
                strokeWidth={2.5}
                style={{ ...rv(0), color: 'var(--color-success)' }}
              />
            )}
            {t(label)}
          </span>
        </div>
        <span
          className="mt-1.5 truncate text-[0.5rem] font-medium leading-none"
          style={{ color: 'var(--iv-text)' }}
        >
          {title}
        </span>
        <span
          className="mt-1 truncate text-[0.4375rem] leading-none"
          style={{ color: 'var(--iv-text-3)' }}
        >
          {brief}
        </span>
        <div
          className="mt-1.5 flex items-center justify-between gap-1 border-t pt-1"
          style={{ borderColor: muted }}
        >
          <span
            className="truncate text-[0.375rem] leading-none"
            style={{ color: 'var(--color-text-quaternary)' }}
          >
            {hint && t(hint)}
          </span>
          <span
            className="flex shrink-0 items-center gap-0.5 text-[0.4375rem] font-medium leading-none"
            style={{ color: 'var(--iv-text-3)' }}
          >
            {t('chat.ptcCard.ctaOpenThread')}
            <ArrowRight className="h-2 w-2" />
          </span>
        </div>
      </div>
    </Appear>
  );
}

/** The caption over a message nobody typed in this thread
    (`MessageProvenanceLabel`): who sent it, by its glyph or a chat app's
    `logo`, then the arrow that opens where it came from. A chat app's
    message has nowhere to open, so it goes without. It sits over the
    bubble's right edge, or alone in place of a report-back's hidden
    message. */
export function Provenance({
  icon: Glyph,
  logo,
  children,
}: {
  icon?: Icon;
  logo?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1 text-[0.4375rem] leading-none"
      style={{ color: 'var(--iv-text-3)' }}
    >
      {logo ?? (Glyph && <Glyph className="h-[7px] w-[7px] shrink-0" />)}
      <span className="truncate">{children}</span>
      {!logo && <ArrowUpRight className="h-[7px] w-[7px] shrink-0" />}
    </span>
  );
}

/** A chat app's mark, as the app draws it: the favicon of the app's site. */
export function AppLogo({ app, size = 7 }: { app: string; size?: number }) {
  return <Favicon domain={messagingAppDomain(app) ?? ''} size={size} />;
}

/** The caption over a message that came in from a chat app: its logo and
    `Via iMessage`. */
export function ViaApp({ app }: { app: string }) {
  const { t } = useTranslation();
  return (
    <Provenance logo={<AppLogo app={app} />}>
      {t('chat.provenance.viaChannel', { platform: messagingAppName(app) })}
    </Provenance>
  );
}

/** A message the agent sent to a chat app (`MessageDeliveryCard`), as its
    pill: the app, how many files went with it, and the send's status. */
export function DeliveryPill({ app, files }: { app: string; files: number }) {
  const { t } = useTranslation();
  return (
    <span
      className="inline-flex w-fit items-center gap-1 rounded-full border py-[3px] pl-1.5 pr-[3px] text-[0.4375rem] leading-none"
      style={{
        borderColor: 'var(--color-border-elevated)',
        background: 'var(--color-bg-card)',
        color: 'var(--iv-text)',
      }}
    >
      <AppLogo app={app} size={8} />
      <span className="font-medium">{messagingAppName(app)}</span>
      <span className="flex items-center gap-0.5" style={{ color: 'var(--iv-text-2)' }}>
        <span style={{ color: 'var(--iv-text-3)' }}>·</span>
        <Paperclip className="h-[7px] w-[7px]" />
        {files}
      </span>
      <span
        className="flex items-center gap-0.5 rounded-full px-1 py-0.5 font-medium"
        style={{ background: 'var(--color-success-soft)', color: 'var(--color-success)' }}
      >
        <CheckCircle2 className="h-[7px] w-[7px]" />
        {t('toolArtifact.messageDelivery.status.sent')}
      </span>
    </span>
  );
}

/** One agent a workflow's script sends out: its label, when it is sent,
    and when it settles, with the time the row then reads. */
export interface FlowAgent {
  label: string;
  at: number;
  done: number;
  took: string;
}

/** Agent rows the run card keeps in view; earlier ones fold into a count. */
const FLOW_ROWS = 8;

/**
 * A workflow run (`WorkflowRunCard` in `TaskCardShell`): `workflow · name`
 * and the run's status over a rule, the run's title, the phase rail with the
 * phase under way in bold, a row per agent the script sends out (the loader
 * while it runs, a check and its time once done), the latest log line while
 * the run goes, and its totals in a band under a rule. Each phase starts at
 * its `at`, the tokens count up from `at`, and the run settles at `done`.
 */
export function WorkflowCard({
  name,
  title,
  phases,
  agents,
  logs,
  at,
  done,
  took,
  tokens,
}: {
  name: string;
  title: string;
  phases: { name: string; at: number }[];
  agents: FlowAgent[];
  logs: { text: string; at: number }[];
  at: number;
  done: number;
  took: string;
  tokens: number;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const now = useSceneTime();
  const running = now < done;
  const current = phases.filter((p) => p.at <= now).length - 1;
  const sent = agents.filter((a) => a.at <= now);
  const settled = sent.filter((a) => a.done <= now).length;
  const hidden = Math.max(0, sent.length - FLOW_ROWS);
  const log = logs.filter((l) => l.at <= now).at(-1);
  const spent = Math.round(tokens * progress(now, at, done - at));
  const meta: string[] = [];
  if (sent.length > 0) {
    const count = t('chat.workflowRun.agents', { count: sent.length });
    meta.push(running ? `${count} · ${t('chat.workflowRun.done', { count: settled })}` : count);
  }
  if (!running) meta.push(took);
  if (spent > 0) {
    meta.push(t('chat.workflowRun.tokens', { value: compactNumber(spent, locale) }));
  }
  const small = 'text-[0.375rem] leading-none';
  return (
    <Appear at={at}>
      <div className="overflow-hidden rounded-lg border font-mono" style={toolCard}>
        <div
          className="flex items-center gap-1 border-b px-1.5 pb-1 pt-1.5"
          style={{ borderColor: 'var(--color-border-subtle)' }}
        >
          <span
            className="truncate text-[0.4375rem] font-medium lowercase leading-none"
            style={{ color: 'var(--iv-text-2)' }}
          >
            workflow · {name}
          </span>
          <span
            className={cn(
              'ml-auto flex shrink-0 items-center gap-0.5',
              'text-[0.375rem] font-medium leading-none tracking-[0.04em]'
            )}
            style={{ color: running ? 'var(--color-warning)' : 'var(--color-success)' }}
          >
            {running ? (
              <Loader color="currentColor" className="text-[0.4375rem]" />
            ) : (
              <Check className="intro-pop h-1.5 w-1.5" strokeWidth={2.5} style={rv(0)} />
            )}
            {t(running ? 'chat.taskCard.statusRunning' : 'chat.taskCard.statusCompleted')}
          </span>
          <ChevronRight
            className="h-2 w-2 shrink-0"
            style={{ color: 'var(--color-text-quaternary)' }}
          />
        </div>
        <div className="flex flex-col gap-1.5 px-1.5 py-1.5">
          <span
            className="truncate font-sans text-[0.5rem] font-medium leading-none"
            style={{ color: 'var(--iv-text)' }}
          >
            {title}
          </span>
          {/* the phase rail: done phases dim, the one under way bold */}
          <span className={cn('flex flex-wrap items-center gap-x-1', small)}>
            {phases.map((phase, i) => (
              <span key={phase.name} className="flex items-center gap-1">
                {i > 0 && <span style={{ color: 'var(--color-text-quaternary)' }}>─</span>}
                <span
                  style={
                    running && i === current
                      ? { color: 'var(--iv-text)', fontWeight: 600 }
                      : {
                          color:
                            !running || i < current
                              ? 'var(--iv-text-3)'
                              : 'var(--color-text-quaternary)',
                          fontWeight: 500,
                        }
                  }
                >
                  {phase.name}
                </span>
              </span>
            ))}
          </span>
          {sent.length > 0 && (
            <span className="flex flex-col gap-[3px]">
              {hidden > 0 && (
                <span className={small} style={{ color: 'var(--color-text-quaternary)' }}>
                  {t('chat.workflowRun.earlier', { count: hidden })}
                </span>
              )}
              {sent.slice(hidden).map((agent) => {
                const live = now < agent.done;
                return (
                  <span key={agent.label} className={cn('flex items-center gap-1', small)}>
                    {live ? (
                      <Loader color="var(--color-warning)" className="text-[0.375rem]" />
                    ) : (
                      <Check
                        className="h-[6px] w-[6px] shrink-0"
                        strokeWidth={2.5}
                        style={{ color: 'var(--color-success)' }}
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--iv-text-2)' }}>
                      {agent.label}
                    </span>
                    <span className="shrink-0" style={{ color: 'var(--iv-text-3)' }}>
                      {live ? '' : agent.took}
                    </span>
                  </span>
                );
              })}
            </span>
          )}
          {running && log && (
            <span className={cn('truncate', small)} style={{ color: 'var(--iv-text-3)' }}>
              › {log.text}
            </span>
          )}
        </div>
        {meta.length > 0 && (
          <div
            className={cn('border-t px-1.5 py-1 tracking-[0.02em]', small)}
            style={{ borderColor: 'var(--color-border-subtle)', color: 'var(--iv-text-3)' }}
          >
            {meta.join(' · ')}
          </div>
        )}
      </div>
    </Appear>
  );
}

/** A chart the agent drew into its reply: a solid card with the chart's
    title and, across from it, its legend for the dashed rule, then the
    chart. */
export function ChartCard({
  title,
  legend,
  children,
}: {
  title: string;
  legend: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border px-2 py-1.5" style={toolCard}>
      <span className="flex items-baseline gap-1 leading-none">
        <span
          className="truncate text-[0.4375rem] font-semibold"
          style={{ color: 'var(--iv-text)' }}
        >
          {title}
        </span>
        <span
          className="ml-auto flex shrink-0 items-center gap-0.5 text-[0.3125rem]"
          style={{ color: 'var(--iv-text-3)' }}
        >
          <span className="w-1.5 border-t border-dashed" style={{ borderColor: 'currentColor' }} />
          {legend}
        </span>
      </span>
      {children}
    </div>
  );
}

/** The plot's height (px) in a `ColumnChart`, and the headroom over the
    tallest column for the marked column's value. */
const COLUMN_H = 29;
const COLUMN_HEAD = 7;

/**
 * A column chart as an agent draws one into a reply: a column per name, the
 * subject in the accent with its value over it, the rest in grey, a dashed
 * rule at the median, and the names under the baseline. Columns rise one
 * after another from `at`, `per` ms apart.
 */
export function ColumnChart({
  bars,
  max,
  median,
  at,
  per = 50,
}: {
  bars: Bar[];
  max: number;
  median: number;
  at: number;
  per?: number;
}) {
  const t = useSceneTime();
  const plot = COLUMN_H - COLUMN_HEAD;
  return (
    <div className="flex flex-col gap-[3px]">
      <div
        className="relative flex items-end gap-[3px] border-b"
        style={{ height: COLUMN_H, borderColor: 'var(--color-border-default)' }}
      >
        {bars.map((bar, i) => {
          const p = ease(t, at + i * per, 520);
          return (
            <span key={bar.label} className="flex flex-1 flex-col items-center justify-end">
              {bar.mark && (
                <span
                  className="mb-[2px] text-[0.3125rem] font-semibold tabular-nums leading-none"
                  style={{ color: 'var(--iv-text)', opacity: p > 0.6 ? 1 : 0 }}
                >
                  {bar.shown}
                </span>
              )}
              <span
                className="w-full rounded-t-[1px]"
                style={{
                  height: (bar.value / max) * plot * p,
                  background: bar.mark ? 'var(--color-accent-primary)' : 'var(--iv-line-2)',
                }}
              />
            </span>
          );
        })}
        <span
          className="pointer-events-none absolute inset-x-0 border-t border-dashed"
          style={{
            bottom: (median / max) * plot,
            borderColor: 'var(--color-text-tertiary)',
            opacity: ease(t, at + bars.length * per, 300),
          }}
          aria-hidden
        />
      </div>
      <div className="flex gap-[3px]">
        {bars.map((bar) => (
          <span
            key={bar.label}
            className="flex-1 text-center text-[0.28125rem] leading-none tracking-[-0.01em]"
            style={{
              color: bar.mark ? 'var(--iv-text)' : 'var(--iv-text-3)',
              fontWeight: bar.mark ? 600 : 400,
            }}
          >
            {bar.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A file's thumbnail on its card: a page over a tilted sheet, the kind's glyph on it. */
function FileThumb({ icon: Glyph }: { icon: Icon }) {
  return (
    <span className="relative h-[15px] w-3 shrink-0">
      <span
        className="absolute inset-0 rounded-sm border"
        style={{
          background: 'var(--color-bg-elevated)',
          borderColor: 'var(--color-border-muted)',
          transform: 'translate(-1px, 1px) rotate(-5deg)',
        }}
      />
      <span
        className="absolute inset-0 flex items-center justify-center rounded-sm border"
        style={{ background: 'var(--color-bg-page)', borderColor: 'var(--color-border-elevated)' }}
      >
        <Glyph className="h-1.5 w-1.5" style={{ color: 'var(--color-accent-primary)' }} />
      </span>
    </span>
  );
}

/** A file the turn produced (`TurnFileCards`): thumbnail, name, kind, and
    the Open button, or the deck's count once `count` files are stacked. */
export function FileCard({
  name,
  kind,
  icon,
  count = 1,
}: {
  name: string;
  kind: 'spreadsheet' | 'document';
  icon: Icon;
  count?: number;
}) {
  const { t } = useTranslation();
  const ext = name.slice(name.lastIndexOf('.') + 1).toUpperCase();
  const muted = { borderColor: 'var(--color-border-muted)' };
  return (
    <div
      className="flex h-6 items-center gap-1.5 rounded-lg border px-1.5"
      style={{ ...muted, background: 'var(--color-bg-card)' }}
    >
      <FileThumb icon={icon} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[0.5rem] leading-none" style={{ color: 'var(--iv-text)' }}>
          {name}
        </span>
        <span
          className="truncate text-[0.375rem] leading-none"
          style={{ color: 'var(--iv-text-3)' }}
        >
          {t(`chat.turnFiles.kind.${kind}`)} · {ext}
        </span>
      </span>
      {count > 1 ? (
        <span className="intro-pop ml-auto flex items-center gap-0.5" style={rv(0)}>
          <span
            className={cn(
              'flex h-2.5 min-w-2.5 items-center justify-center rounded-full px-0.5',
              'text-[0.375rem] font-medium leading-none'
            )}
            style={{ background: 'var(--color-bg-tag)', color: 'var(--iv-text-2)' }}
          >
            {count}
          </span>
          <ChevronDown className="h-2 w-2" style={{ color: 'var(--iv-text-3)' }} />
        </span>
      ) : (
        <span
          className="ml-auto flex shrink-0 items-stretch text-[0.375rem] leading-none"
          style={{ color: 'var(--iv-text-3)' }}
        >
          <span className="flex items-center gap-0.5 rounded-l border px-1 py-0.5" style={muted}>
            <PanelRight className="h-1.5 w-1.5" />
            {t('chat.turnFiles.open')}
          </span>
          <span className="flex items-center rounded-r border border-l-0 px-0.5" style={muted}>
            <ChevronDown className="h-1.5 w-1.5" />
          </span>
        </span>
      )}
    </div>
  );
}

/** A file for `FileStack`: its name, its kind, and its card's glyph. */
interface TurnFile {
  name: string;
  kind: 'spreadsheet' | 'document';
  icon: Icon;
}

/** The files a turn produced, stacked as the app stacks them: the first
    card lands at `at`, and once the second lands at `next` it peeks out
    under the first, which takes the count. */
export function FileStack({
  top,
  under,
  at,
  next,
}: {
  top: TurnFile;
  under: TurnFile;
  at: number;
  next: number;
}) {
  const stacked = useSceneTime() >= next;
  return (
    <Appear at={at}>
      <div className="relative" style={{ height: stacked ? 27 : 24 }}>
        {stacked && (
          <div
            className="absolute inset-x-0 top-0"
            style={{ transform: 'translateY(3px) scale(0.98)' }}
          >
            <FileCard {...under} />
          </div>
        )}
        <div className="absolute inset-x-0 top-0">
          <FileCard {...top} count={stacked ? 2 : 1} />
        </div>
      </div>
    </Appear>
  );
}
