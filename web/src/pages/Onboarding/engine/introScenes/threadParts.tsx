import { Fragment, type ReactNode } from 'react';
import { ArrowLeft, FolderOpen, Plus, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAgentNames } from '../introAgents';
import { useSceneTime } from './clock';
import { Appear, InputDock, Tag } from './kit';

/* The thread page the thread intro's scenes play on: the chat column beside
   the file panel, the panel a full-height column with its own tab strip,
   and the transcript's prose and tool rows. Each part is a small copy of the
   component the app draws it with. */
/* eslint-disable react-refresh/only-export-components -- shared parts:
   scene components plus layout constants */

/** The file panel's width in the 400px scene; the chat column takes the rest. */
export const PANEL_W = 212;

export const iconStyle = { color: 'var(--iv-text-3)' };

/** A tab in the panel's strip: the open one sits on a raised pill. A file
    opened on loan (`onLoan`, the preview a next open takes over) is set in
    italics, as the strip marks it. */
export function PanelTab({
  icon: Icon,
  label,
  active = false,
  onLoan = false,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onLoan?: boolean;
}) {
  return (
    <span
      className={cn(
        'flex h-[15px] min-w-0 shrink items-center gap-1 rounded border pl-1 pr-2',
        'text-[0.4375rem] leading-none'
      )}
      style={
        active
          ? {
              background: 'var(--color-bg-elevated)',
              borderColor: 'var(--color-border-muted)',
              color: 'var(--iv-text)',
            }
          : { borderColor: 'transparent', color: 'var(--iv-text-3)' }
      }
    >
      <Icon className="h-2 w-2 shrink-0" />
      <span className={cn('truncate', onLoan && 'italic')}>{label}</span>
    </span>
  );
}

/** An icon button in the panel or tree chrome. */
export function ChromeIcon({ icon: Icon, on = false }: { icon: LucideIcon; on?: boolean }) {
  return (
    <Icon
      className="h-2 w-2 shrink-0"
      style={{ color: on ? 'var(--iv-text)' : 'var(--iv-text-3)' }}
    />
  );
}

/**
 * The agent's prose as the transcript sets it: body text, `**bold**` lead-ins,
 * and a workspace path in backticks drawn as the link the app makes of it.
 * Streams in from `at`, `cps` characters a second; with no `at` it was written
 * before the scene began, and outside a clock it is whole.
 */
export function Prose({
  text,
  at,
  cps = 110,
  className,
}: {
  text: string;
  at?: number;
  cps?: number;
  className?: string;
}) {
  const t = useSceneTime();
  let left = at == null ? Infinity : Math.max(Math.floor(((t - at) * cps) / 1000), 0);
  if (left === 0) return null;
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).filter(Boolean);
  const out: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (left <= 0) return;
    const bold = part.startsWith('**');
    const link = part.startsWith('`');
    const body = bold ? part.slice(2, -2) : link ? part.slice(1, -1) : part;
    const piece = body.slice(0, left);
    left -= body.length;
    out.push(
      bold ? (
        <b key={i} className="font-semibold">
          {piece}
        </b>
      ) : link ? (
        <span
          key={i}
          className="underline decoration-from-font underline-offset-[1.5px]"
          style={{ color: 'var(--color-accent-primary)' }}
        >
          {piece}
        </span>
      ) : (
        <Fragment key={i}>{piece}</Fragment>
      )
    );
  });
  return (
    <p className={cn('text-[0.5rem] leading-[1.5]', className)} style={{ color: 'var(--iv-text)' }}>
      {out}
    </p>
  );
}

/** The chat column's header: back, the thread's `title`, the agent, and the
    folder button that opens the file panel, held while it is open. */
function ChatHeader({ title }: { title: string }) {
  const { worker } = useAgentNames();
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5">
      <ArrowLeft className="h-2.5 w-2.5 shrink-0" style={iconStyle} />
      <span
        className="min-w-0 truncate text-[0.5rem] font-medium leading-none"
        style={{ color: 'var(--iv-text)' }}
      >
        {title}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <Tag>{worker}</Tag>
        <span
          className="flex h-3.5 w-3.5 items-center justify-center rounded"
          style={{ background: 'var(--color-border-muted)' }}
        >
          <FolderOpen className="h-2.5 w-2.5" style={{ color: 'var(--iv-text)' }} />
        </span>
      </span>
    </div>
  );
}

/** The file panel's tab strip: `tabs`, new tab, then `actions` and close. */
function PanelStrip({ tabs, actions }: { tabs: ReactNode; actions: ReactNode }) {
  return (
    <div
      className="flex shrink-0 items-center gap-1 border-l px-1"
      style={{ width: PANEL_W, borderColor: 'var(--iv-border)' }}
    >
      {tabs}
      <ChromeIcon icon={Plus} />
      <span className="ml-auto flex items-center gap-1.5 pr-0.5">
        {actions}
        <ChromeIcon icon={X} />
      </span>
    </div>
  );
}

/** The thread page's size when a scene's camera frames it. */
export const PAGE = { width: 400, height: 330 };

/** The page's header row: the chat header beside the panel's tab strip. */
export const HEADER_H = 28;

/**
 * The thread page alone, drawn at `PAGE` for a scene's `Camera` to crop: the
 * chat column with its header (the thread's `title`) beside the file panel,
 * whose tab strip (`tabs`, `actions`) sits level with the chat header and
 * `panel` fills the rest. `stack` places the transcript: from the top for a
 * new thread, or settled on the composer for one with history above, the
 * oldest lines running off the top as the newest come in.
 */
export function ThreadPage({
  title,
  tabs,
  actions,
  chat,
  panel,
  composer,
  sendAt,
  stack = 'top',
}: {
  title: string;
  tabs: ReactNode;
  actions: ReactNode;
  chat: ReactNode;
  panel: ReactNode;
  composer?: ReactNode;
  sendAt?: number[];
  stack?: 'top' | 'bottom';
}) {
  return (
    <div className="relative flex flex-col" style={PAGE}>
      <div
        className="flex shrink-0 items-stretch border-b"
        style={{ height: HEADER_H, borderColor: 'var(--iv-border)' }}
      >
        <ChatHeader title={title} />
        <PanelStrip tabs={tabs} actions={actions} />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-2.5">
          {stack === 'bottom' ? (
            <div className="flex min-h-0 flex-1 flex-col justify-end gap-1.5 overflow-hidden">
              {chat}
            </div>
          ) : (
            chat
          )}
          <InputDock text={composer} sendAt={sendAt} />
        </div>
        <div
          className="flex shrink-0 flex-col border-l"
          style={{ width: PANEL_W, borderColor: 'var(--iv-border)' }}
        >
          {panel}
        </div>
      </div>
    </div>
  );
}

/** A turn's tool calls, threaded on the timeline's rule through their icons. */
export function Timeline({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex flex-col">
      <span
        aria-hidden
        className="absolute bottom-[8.5px] left-[6.5px] top-[8.5px] w-px"
        style={{ background: 'var(--color-border-default)' }}
      />
      {children}
    </div>
  );
}

/** What a tool row says at one stage: its label, and the mono pill naming
    the file when there is one. */
interface RowLine {
  label: string;
  pill?: string;
}

/**
 * One tool call on the timeline: its icon on the rule, then what it says.
 * While it runs the label shimmers, then it settles. A file call keeps one
 * pill throughout ("Writing" then "Write", beside `notes.md`); a memory call
 * runs as one phrase and settles with its topic as the pill. The app draws
 * no spinner and no check on these rows.
 */
export function ToolRow({
  icon: Icon,
  running,
  settled,
  at,
  done,
}: {
  icon: LucideIcon;
  running: RowLine;
  settled: RowLine;
  at: number;
  done: number;
}) {
  const live = useSceneTime() < done;
  const { label, pill } = live ? running : settled;
  return (
    <Appear at={at} className="flex min-w-0 items-center gap-1.5 py-[3px]">
      {/* page-colored behind the icon, so the rule breaks around it */}
      <span
        className="flex h-[11px] w-3.5 shrink-0 items-center justify-center"
        style={{ background: 'var(--iv-mk-bg)' }}
      >
        <Icon className="h-2 w-2" style={{ color: 'var(--Labels-Secondary)' }} />
      </span>
      {/* label and pill share a baseline, as the app's row line does */}
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span
          className={cn('truncate text-[0.5rem] leading-none', live && 'intro-shimmer')}
          style={live ? undefined : { color: 'var(--iv-text)' }}
        >
          {label}
        </span>
        {pill && (
          <span
            className="whitespace-nowrap font-mono text-[0.4375rem] leading-none"
            style={{ color: 'var(--Labels-Secondary)' }}
          >
            {pill}
          </span>
        )}
      </span>
    </Appear>
  );
}
