import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  PanelRight,
  type LucideProps,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { progress, useSceneTime } from './clock';
import { Appear, Ln, Loader, rv } from './kit';

/* The chat transcript's parts, shared by the chat scenes: activity rows,
   the workspace line, hand-off and subagent cards, and a produced file's card.
   Each is a small copy of the component the app draws it with (named on each). */
/* eslint-disable react-refresh/only-export-components -- shared parts:
   scene components plus the style helper */

export type Icon = ComponentType<LucideProps>;

/** A solid card in the chat transcript (`--color-bg-tool-card`), as tool results sit. */
export const toolCard: CSSProperties = {
  background: 'var(--color-bg-tool-card)',
  borderColor: 'var(--color-border-muted)',
};

/* ── the chat transcript ───────────────────────────────────────────────── */

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

/** A hand-off to the Analyst (`PTCAgentCard`): the workspace in small mono
    caps, what was handed off, and the run's status: starting, working from
    `started`, completed from `finished`. */
export function HandoffCard({
  heading,
  at,
  started,
  finished = Number.POSITIVE_INFINITY,
}: {
  heading: string;
  at: number;
  started: number;
  finished?: number;
}) {
  const { t } = useTranslation();
  const now = useSceneTime();
  const live = now < finished;
  const label =
    now < started
      ? 'chat.ptcCard.statusStarting'
      : live
        ? 'chat.ptcCard.statusWorking'
        : 'chat.ptcCard.statusCompleted';
  return (
    <Appear at={at}>
      <div
        className="flex flex-col gap-1 rounded-md border p-1.5"
        style={{
          ...toolCard,
          borderColor: live ? 'var(--color-border-default)' : 'var(--color-border-muted)',
        }}
      >
        <div className="flex items-center gap-1">
          <span
            className={cn(
              'truncate font-mono text-[0.375rem] font-medium uppercase',
              'leading-none tracking-[0.08em]'
            )}
            style={{ color: 'var(--color-text-quaternary)' }}
          >
            NVDA deep dive
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
          className="block truncate text-[0.5rem] font-medium leading-none first-letter:uppercase"
          style={{ color: 'var(--iv-text)' }}
        >
          {heading}
        </span>
        <Ln w="72%" h={2} c="var(--iv-line-3)" />
      </div>
    </Appear>
  );
}

/** A subagent's task card (`TaskCardShell`): its type and status over a
    rule, then the task as the agent wrote it, and its tool and token counts
    ticking up from `at` until it completes at `done`. */
export function SubagentCard({
  name,
  task,
  tools,
  at,
  done,
}: {
  name: string;
  task: string;
  tools: number;
  at: number;
  done: number;
}) {
  const { t } = useTranslation();
  const now = useSceneTime();
  const used = Math.floor(tools * progress(now, at, done - at));
  const running = now < done;
  const strong = { color: 'var(--iv-text-2)', fontWeight: 600 };
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
            {name}
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
        </div>
        <div className="flex flex-col gap-1.5 px-1.5 pb-1.5 pt-1.5">
          <span
            className="truncate font-sans text-[0.5rem] font-medium leading-none"
            style={{ color: 'var(--iv-text)' }}
          >
            {task}
          </span>
          <span
            className={cn(
              'h-[0.375rem] whitespace-nowrap',
              'text-[0.375rem] leading-none tracking-[0.02em]'
            )}
            style={{ color: 'var(--iv-text-3)' }}
          >
            {used > 0 && (
              <>
                <b style={strong}>{used}</b> {t('chat.subagentCard.toolUnit', { count: used })}
                {' · '}
                <b style={strong}>{((used * 540) / 1000).toFixed(1)}k</b>{' '}
                {t('chat.subagentCard.tokenUnit')}
              </>
            )}
          </span>
        </div>
      </div>
    </Appear>
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
