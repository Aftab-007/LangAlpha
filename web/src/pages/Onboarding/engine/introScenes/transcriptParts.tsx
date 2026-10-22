import { Fragment, type ReactNode } from 'react';
import { ArrowLeft, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PAST, useSceneTime } from './clock';
import { Appear, Tag, typedCount } from './kit';

/* A thread's transcript as every scene that opens one draws it: the thread's
   header and title, the column its turns stack in, the agent's prose, and
   the tool rows on their timeline. The chat, thread, market and automations
   scenes all show the same chat page, so its parts live here once. Each is
   a small copy of the component the app draws it with (named on each).

   Two scene families set the transcript a touch differently, and `dense`
   keeps each as it was: the chat and automations scenes' prose sits at
   1.45 and their tool rows are bare, while the thread and market scenes'
   prose sits at the app's 1.5 and their rows sit on the timeline's rule. */

/** The thread header's height, and the file panel's tab strip's beside it:
    the app's 53px top bar at the scenes' scale. Every scene draws it the
    same, so whatever sits under it (a popover, a chip the pointer clicks, a
    shot's top edge) can be placed from it. */
export const HEADER_H = 28;

/** The thread's back arrow and its title, from `ChatView`'s top bar. */
export function TopTitle({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-1', className)}>
      <ArrowLeft className="h-2.5 w-2.5 shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
      <span
        className="truncate text-[8px] font-medium leading-none"
        style={{ color: 'var(--color-text-primary)' }}
      >
        {children}
      </span>
    </span>
  );
}

/**
 * A thread page's own header, `ChatView`'s top bar, `HEADER_H` tall: back
 * and the thread's `title`, the `agent` it runs with, and `children` (the
 * header's buttons) at its right. The spacing in `className` is the
 * caller's: the scenes that draw this header alone do not all space it
 * alike.
 */
export function ThreadHeader({
  title,
  agent,
  className,
  children,
}: {
  title: ReactNode;
  agent: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn('flex shrink-0 items-center border-b', className)}
      style={{ height: HEADER_H, borderColor: 'var(--color-border-muted)' }}
    >
      <TopTitle>{title}</TopTitle>
      <Tag>{agent}</Tag>
      {children && <span className="ml-auto flex">{children}</span>}
    </div>
  );
}

/**
 * A chat column's transcript, `ChatView`'s message area: from the top while
 * it fits, then held on its newest lines with the oldest running off the
 * top, as a thread scrolls with its replies. A `settled` transcript has
 * history above it, so it sits on the composer from the first frame.
 */
export function Transcript({
  settled = false,
  className,
  children,
}: {
  settled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col justify-end overflow-hidden', className)}>
      <div className={cn('flex shrink-0 flex-col gap-1.5', !settled && 'min-h-full')}>
        {children}
      </div>
    </div>
  );
}

/**
 * The agent's prose (`TextMessageContent`, the chat variant of `Markdown`):
 * body text, `**bold**` lead-ins, and a workspace path in backticks drawn as
 * the link the app makes of it. Streams in from `at`, `cps` characters a
 * second, and takes no room until its first character lands; with no `at`
 * it was written before the scene began, and outside a clock it is whole.
 */
export function Reply({
  text,
  at = PAST,
  cps = 150,
  dense = false,
}: {
  text: string;
  at?: number;
  cps?: number;
  dense?: boolean;
}) {
  let left = Math.max(typedCount(useSceneTime(), at, cps), 0);
  if (left === 0) return null;
  const out: ReactNode[] = [];
  text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/)
    .filter(Boolean)
    .forEach((part, i) => {
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
    <p
      className={dense ? 'text-[8px] leading-[1.45]' : 'text-[8px] leading-[1.5]'}
      style={{ color: 'var(--color-text-primary)' }}
    >
      {out}
    </p>
  );
}

/** What a tool row says at one stage: its label, and the mono pill naming
    what it acted on when there is one. */
interface RowLine {
  label: string;
  pill?: string;
}

/**
 * One tool call (`ToolCallRow`, or `ReasoningRow` for a think): its icon,
 * then what it says. While it runs the label shimmers, then it settles. A
 * file call keeps one pill throughout ("Writing" then "Write", beside
 * `notes.md`); a memory call runs as one phrase and settles with its topic
 * as the pill. `after` follows the settled line where a pill would, as a
 * think's chevron does. The app draws no spinner and no check on these
 * rows. A row with no `running` is a call the thread made before the scene
 * began, so it is settled from the start.
 *
 * On the timeline's rule the icon sits on a page-colored box so the rule
 * breaks around it, and the label and pill share a baseline, as the app's
 * row line does. A `dense` row is bare: no box, no padding, label and pill
 * centred on each other, and the settled label kept whole so the pill is
 * what truncates.
 */
export function ToolRow({
  icon: Icon,
  running,
  settled,
  after,
  at = PAST,
  done = PAST,
  dense = false,
}: {
  icon: LucideIcon;
  running?: RowLine;
  settled: RowLine;
  after?: ReactNode;
  at?: number;
  done?: number;
  dense?: boolean;
}) {
  const now = useSceneTime();
  const live = running != null && now < done;
  const { label, pill } = live ? running : settled;
  const muted = { color: 'var(--Labels-Secondary)' };
  return (
    <Appear
      at={at}
      className={dense ? 'flex items-center gap-1.5' : 'flex min-w-0 items-center gap-1.5 py-[3px]'}
    >
      {dense ? (
        <Icon className="h-2 w-2 shrink-0" style={muted} />
      ) : (
        <span
          className="flex h-[11px] w-3.5 shrink-0 items-center justify-center"
          style={{ background: 'var(--color-bg-page)' }}
        >
          <Icon className="h-2 w-2" style={muted} />
        </span>
      )}
      <span
        className={
          dense ? 'flex min-w-0 items-center gap-1.5' : 'flex min-w-0 items-baseline gap-1.5'
        }
      >
        <span
          className={cn(
            dense && !live ? 'shrink-0' : 'truncate',
            'text-[8px] leading-none',
            live && 'intro-shimmer'
          )}
          style={live ? undefined : { color: 'var(--color-text-primary)' }}
        >
          {label}
        </span>
        {pill && (
          <span
            className={cn(
              dense ? 'truncate' : 'whitespace-nowrap',
              'font-mono text-[7px] leading-none'
            )}
            style={muted}
          >
            {pill}
          </span>
        )}
        {!live && after}
      </span>
    </Appear>
  );
}

/**
 * A turn's tool calls threaded on the timeline's rule (`ActivityBlock`). Under
 * full rows the rule runs from the first icon to the last, broken by each
 * icon's box; under `dense` rows, spaced apart, it is a short segment between
 * one row's icon and the next, as the app draws it.
 */
export function Timeline({ dense = false, children }: { dense?: boolean; children: ReactNode }) {
  return (
    <div className={dense ? 'relative flex flex-col gap-[10px]' : 'relative flex flex-col'}>
      <span
        aria-hidden
        className={
          dense
            ? 'absolute bottom-[10.5px] left-[3.5px] top-[10.5px] w-px'
            : 'absolute bottom-[8.5px] left-[6.5px] top-[8.5px] w-px'
        }
        style={{ background: 'var(--color-border-default)' }}
      />
      {children}
    </div>
  );
}
