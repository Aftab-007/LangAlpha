import { Fragment, type ReactNode } from 'react';
import { ArrowLeft, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAgentNames } from '../introAgents';
import { useSceneTime } from './clock';
import { Appear, InputDock, Tag } from './kit';
import { ChatHeaderButtons, PanelStrip } from './panelParts';

/* The thread page the thread intro's scenes play on: the chat column beside
   the file panel, the panel a full-height column with its own tab strip,
   and the transcript's prose and tool rows. Each part is a small copy of the
   component the app draws it with. */
/* eslint-disable react-refresh/only-export-components -- shared parts:
   scene components plus layout constants */

/** The file panel's width in the 400px scene; the chat column takes the rest. */
export const PANEL_W = 212;

/** A glyph in the chrome of a tab's own body (the Memory and Memo tabs). */
export function ChromeIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon className="h-2 w-2 shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />;
}

/**
 * The agent's prose as the transcript sets it: body text, `**bold**` lead-ins,
 * and a workspace path in backticks drawn as the link the app makes of it.
 * Streams in from `at`, `cps` characters a second; with no `at` it was written
 * before the scene began, and outside a clock it is whole.
 */
export function Prose({ text, at, cps = 110 }: { text: string; at?: number; cps?: number }) {
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
    <p className="text-[8px] leading-[1.5]" style={{ color: 'var(--color-text-primary)' }}>
      {out}
    </p>
  );
}

/** The chat column's header: back, the thread's `title`, the agent, and
    share. The panel is open beside it, so the panel toggle is in the
    panel's corner rather than here. */
function ChatHeader({ title }: { title: string }) {
  const { worker } = useAgentNames();
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5 pl-2.5 pr-[9px]">
      <ArrowLeft className="h-2.5 w-2.5 shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
      <span
        className="min-w-0 truncate text-[8px] font-medium leading-none"
        style={{ color: 'var(--color-text-primary)' }}
      >
        {title}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <Tag>{worker}</Tag>
        <ChatHeaderButtons panelOpen />
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
 * whose tab strip (`tabs`, with `back` and `tree` as `PanelStrip` reads
 * them) sits level with the chat header and `panel` fills the rest. `stack`
 * places the transcript: from the top for a new thread, or settled on the
 * composer for one with history above, the oldest lines running off the top
 * as the newest come in.
 */
export function ThreadPage({
  title,
  tabs,
  back,
  tree,
  chat,
  panel,
  composer,
  sendAt,
  stack = 'top',
}: {
  title: string;
  tabs: ReactNode;
  back?: boolean;
  tree?: boolean;
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
        style={{ height: HEADER_H, borderColor: 'var(--color-border-muted)' }}
      >
        <ChatHeader title={title} />
        <PanelStrip
          tabs={tabs}
          back={back}
          tree={tree}
          className="border-l"
          style={{ width: PANEL_W, borderColor: 'var(--color-border-muted)' }}
        />
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
          style={{ width: PANEL_W, borderColor: 'var(--color-border-muted)' }}
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
 * no spinner and no check on these rows. A row with no `running` is a call
 * the thread made before the scene began, so it is settled from the start.
 */
export function ToolRow({
  icon: Icon,
  running,
  settled,
  at = 0,
  done = 0,
}: {
  icon: LucideIcon;
  running?: RowLine;
  settled: RowLine;
  at?: number;
  done?: number;
}) {
  const now = useSceneTime();
  const live = running != null && now < done;
  const { label, pill } = live ? running : settled;
  return (
    <Appear at={at} className="flex min-w-0 items-center gap-1.5 py-[3px]">
      {/* page-colored behind the icon, so the rule breaks around it */}
      <span
        className="flex h-[11px] w-3.5 shrink-0 items-center justify-center"
        style={{ background: 'var(--color-bg-page)' }}
      >
        <Icon className="h-2 w-2" style={{ color: 'var(--Labels-Secondary)' }} />
      </span>
      {/* label and pill share a baseline, as the app's row line does */}
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span
          className={cn('truncate text-[8px] leading-none', live && 'intro-shimmer')}
          style={live ? undefined : { color: 'var(--color-text-primary)' }}
        >
          {label}
        </span>
        {pill && (
          <span
            className="whitespace-nowrap font-mono text-[7px] leading-none"
            style={{ color: 'var(--Labels-Secondary)' }}
          >
            {pill}
          </span>
        )}
      </span>
    </Appear>
  );
}
