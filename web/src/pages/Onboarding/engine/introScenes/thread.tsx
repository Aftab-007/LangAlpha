import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  BookMarked,
  CheckSquare,
  FileText,
  Info,
  RefreshCw,
  ScrollText,
  Upload,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBytes, paddedClockTime, shortMonthDay } from '@/lib/format';
import { useLocale } from '@/hooks/useLocale';
import type { IntroVisualId } from '../../registry';
import { useSceneTime, useTween } from './clock';
import { Appear, Cursor, Loader, Typed, UserBubble, pointAt, type Waypoint } from './kit';
import {
  ChromeIcon,
  PanelTab,
  Prose,
  ThreadFrame,
  Timeline,
  ToolRow,
  iconStyle,
} from './threadParts';
import type { IntroScene } from './types';

/* Scenes for the thread intro's memory and memo steps: the chat column
   beside the file panel, Memory and Memo open as tabs of their own, drawn
   the way the thread page draws them. Labels are the app's own strings. The
   file panel step lives in `threadFiles`. */
/* eslint-disable react-refresh/only-export-components -- scene module:
   private scene components, one record export */

/* ── thread · step 2: long-term memory ─────────────────────────────────── */

/** A position typed and sent, the agent adding it to the `positions` topic
    file, the Memory tab's listing of that file updating, and the pointer
    opening it to show the line it gained. Pointer positions are px in the
    400px scene: positions.md is the second row of the listing, y 92–117. */
const MEM = {
  before: 'NVDA closed at **$182.42**, up 1.61% on the day.',
  ask: 'remember: long NVDA, 4%',
  typeAsk: 450,
  sendAsk: 1500,
  save: 1950,
  saved: 2650,
  topic: 'positions',
  reply: 'Noted. NVDA ideas will now be sized against the 4% you already hold.',
  replyAt: 2800,
  path: [
    { at: 2900, x: 320, y: 250 },
    { at: 3500, x: 236, y: 103 },
    { at: 3950, x: 236, y: 103 },
    { at: 4500, x: 360, y: 220 },
  ] satisfies Waypoint[],
  click: 3600,
  open: 3680,
  leave: 3950,
  length: 5000,
};

/** One file in the memory list: its name, then size and when it changed
    (the time of day when that was today). */
function MemoryFile({
  name,
  bytes,
  modified,
  today = false,
  hover = false,
}: {
  name: string;
  bytes: number;
  modified: Date;
  today?: boolean;
  hover?: boolean;
}) {
  const locale = useLocale();
  const when = today ? paddedClockTime(modified, locale) : shortMonthDay(modified, locale);
  return (
    <div
      className="flex min-w-0 items-center gap-1.5 px-1.5 py-1"
      style={{ background: hover ? 'var(--color-bg-hover)' : undefined }}
    >
      <FileText className="h-[9px] w-[9px] shrink-0" style={iconStyle} />
      <span className="flex min-w-0 flex-col gap-[3px]">
        <span className="truncate text-[0.5rem] leading-none" style={{ color: 'var(--iv-text)' }}>
          {name}
        </span>
        <span className="text-[0.375rem] leading-none" style={iconStyle}>
          {formatBytes(bytes, locale)} · {when}
        </span>
      </span>
    </div>
  );
}

/** The Memory tab's list (`MemoryPanel`): the User / Workspace switch, the
    folder it lists, and the files in it, memory.md first. The topic file
    the agent writes to grows and reads as changed today once it lands. */
function MemoryList() {
  const { t } = useTranslation();
  const now = useSceneTime();
  const saved = now >= MEM.saved;
  const tiers = [t('memoryPanel.tierUser'), t('memoryPanel.tierWorkspace')];
  return (
    <>
      <div
        className="flex items-center justify-between border-b px-1.5 py-1"
        style={{ borderColor: 'var(--iv-border)' }}
      >
        <span
          className="flex gap-0.5 rounded p-[1.5px]"
          style={{ background: 'var(--color-border-muted)' }}
        >
          {tiers.map((tier, i) => (
            <span
              key={tier}
              className="rounded-[3px] px-1.5 py-[3px] text-[0.4375rem] font-medium leading-none"
              style={
                i === 0
                  ? { background: 'var(--color-bg-page)', color: 'var(--iv-text)' }
                  : { color: 'var(--iv-text-3)' }
              }
            >
              {tier}
            </span>
          ))}
        </span>
        <ChromeIcon icon={RefreshCw} />
      </div>
      <span className="px-1.5 pb-0.5 pt-1.5 text-[0.375rem] leading-none" style={iconStyle}>
        .agents/user/memory/
      </span>
      <MemoryFile name="memory.md" bytes={1260} modified={new Date(2026, 9, 18)} />
      <MemoryFile
        name={`${MEM.topic}.md`}
        bytes={saved ? 171 : 128}
        modified={saved ? new Date(2026, 9, 21, 14, 5) : new Date(2026, 7, 14)}
        today={saved}
        hover={now >= MEM.path[1].at}
      />
      <MemoryFile name="risk-preferences.md" bytes={640} modified={new Date(2026, 9, 12)} />
      <MemoryFile name="watchlist.md" bytes={412} modified={new Date(2026, 9, 9)} />
    </>
  );
}

/** A Markdown list as the panel sets one. */
function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex flex-col gap-1 pl-2.5">
      {items.map((item, i) => (
        <li
          key={i}
          className="list-disc text-[0.4375rem] leading-none marker:text-[var(--iv-text-3)]"
          style={{ color: 'var(--iv-text-2)' }}
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

/** A memory file open in the Memory tab: back, its path, then the file as
    Markdown. The line the agent just added is the last one. */
function MemoryViewer() {
  const body = { color: 'var(--iv-text-2)' };
  const held = [
    ['TSM', '3%', 'Jun 2026'],
    ['AVGO', '2%', 'Aug 2026'],
    ['NVDA', '4%', 'Oct 21, 2026'],
  ];
  return (
    <Appear at={MEM.open} className="flex flex-1 flex-col">
      <div
        className="flex items-center gap-1 border-b px-1.5 py-[5px]"
        style={{ borderColor: 'var(--iv-border)' }}
      >
        <ArrowLeft className="h-2 w-2 shrink-0" style={iconStyle} />
        <span
          className="truncate text-[0.4375rem] font-semibold leading-none"
          style={{ color: 'var(--iv-text)' }}
        >
          .agents/user/memory/{MEM.topic}.md
        </span>
      </div>
      <div className="flex flex-col gap-1.5 px-2.5 py-2">
        <span
          className="text-[0.625rem] font-semibold leading-none"
          style={{ color: 'var(--iv-text)' }}
        >
          Positions
        </span>
        <span className="text-[0.4375rem] leading-snug" style={body}>
          Current holdings, as a share of the book.
        </span>
        <Bullets
          items={held.map(([sym, size, since]) => (
            <Fragment key={sym}>
              Long <b style={{ color: 'var(--iv-text)' }}>{sym}</b>, {size} of book, since {since}
            </Fragment>
          ))}
        />
        <span
          className="mt-1 text-[0.5rem] font-semibold leading-none"
          style={{ color: 'var(--iv-text)' }}
        >
          Notes
        </span>
        <Bullets
          items={['Benchmarked to the S&P 500.', 'Keep any single name under 6% of book.']}
        />
      </div>
    </Appear>
  );
}

function Memory() {
  const t = useSceneTime();
  const { t: tr } = useTranslation();
  const away = useTween(MEM.leave, 550);
  const composer =
    t >= MEM.typeAsk && t < MEM.sendAsk ? <Typed text={MEM.ask} at={MEM.typeAsk} /> : undefined;
  return (
    <div className="relative w-full max-w-[400px]">
      <ThreadFrame
        title="NVDA sizing"
        tabs={
          <>
            <PanelTab icon={FileText} label="notes.md" />
            <PanelTab icon={BookMarked} label={tr('filePanel.tabs.memory')} active />
          </>
        }
        actions={
          <>
            <ChromeIcon icon={BookMarked} />
            <ChromeIcon icon={ScrollText} />
          </>
        }
        composer={composer}
        sendAt={[MEM.sendAsk]}
        chat={
          <>
            <Prose text={MEM.before} />
            <UserBubble at={MEM.sendAsk + 80}>{MEM.ask}</UserBubble>
            <Timeline>
              <ToolRow
                icon={BookMarked}
                running={{
                  label: tr('toolArtifact.inProgress.addingMemoryTopic', { topic: MEM.topic }),
                }}
                settled={{ label: tr('toolArtifact.completed.addedMemory'), pill: MEM.topic }}
                at={MEM.save}
                done={MEM.saved}
              />
            </Timeline>
            <Prose text={MEM.reply} at={MEM.replyAt} />
          </>
        }
        panel={t >= MEM.open ? <MemoryViewer /> : <MemoryList />}
      />
      {/* the pointer opens the topic file, then drifts off and fades */}
      {away < 1 && (
        <div className="pointer-events-none absolute inset-0" style={{ opacity: 1 - away }}>
          <Cursor path={MEM.path} clicks={[MEM.click]} />
        </div>
      )}
    </div>
  );
}

/* ── thread · step 3: memos ────────────────────────────────────────────── */

/** Two documents dragged in from the chat side and dropped on the Memo tab:
    the drop overlay takes the drag, Upload reads "Uploading…", then each memo
    is listed generating its summary and turns Ready with its description. */
const MEMO = {
  // pointer in px of the 400px scene; the panel spans x 188–399, and the
  // drop overlay over its listing x 192–395, y 55–325. The overlay shows from
  // the moment the pointer crosses into the panel (x 188 at about 1370ms).
  path: [
    { at: 350, x: 74, y: 236 },
    { at: 650, x: 74, y: 236 },
    { at: 1850, x: 228, y: 112 },
    { at: 2150, x: 228, y: 112 },
    { at: 2750, x: 330, y: 262 },
  ] satisfies Waypoint[],
  over: 1400,
  drop: 2050,
  uploaded: 2650,
  leave: 2550,
  rows: [
    {
      name: 'nvda-10q.pdf',
      at: 2650,
      ready: 3550,
      description: '10-Q for the quarter ended Jul 27',
    },
    { name: 'call-notes.md', at: 2750, ready: 4050, description: 'Notes from the Q2 call' },
  ],
  ask: 'What did they guide?',
  answer:
    'Another sequential step up, led by data center. Add the 10-Q and your call notes ' +
    'as memos and I can tie the segment numbers back to them.',
  length: 5000,
};

/** What the OS drags out of Finder: the file's icon and its name, with the
    count badge a multi-file drag carries. It shrinks into the drop. */
function DragChip() {
  const t = useSceneTime();
  const sink = useTween(MEMO.drop, 240);
  if (t < MEMO.path[0].at || sink >= 1) return null;
  const { x, y } = pointAt(MEMO.path, t);
  return (
    <div
      className="pointer-events-none absolute z-[9] flex flex-col items-center gap-[3px]"
      style={{
        left: x + 9,
        top: y + 10,
        opacity: 1 - sink,
        transform: `translateX(-50%) scale(${1 - 0.25 * sink})`,
      }}
    >
      <span
        className={cn(
          'relative flex h-[18px] w-[14px] items-end justify-center',
          'rounded-[1.5px] border pb-[2px]'
        )}
        style={{ background: '#fff', borderColor: 'rgba(0, 0, 0, 0.2)' }}
      >
        <span className="text-[0.25rem] font-semibold leading-none" style={{ color: '#8a8a8a' }}>
          PDF
        </span>
        <span
          className={cn(
            'absolute -right-1.5 -top-1.5 flex h-2.5 min-w-2.5 items-center justify-center',
            'rounded-full px-[2px] text-[0.375rem] font-semibold leading-none text-white'
          )}
          style={{ background: '#ff3b30' }}
        >
          {MEMO.rows.length}
        </span>
      </span>
      <span
        className={cn(
          'whitespace-nowrap rounded-[2px] px-[3px] py-[1.5px]',
          'text-[0.375rem] leading-none text-white'
        )}
        style={{ background: '#0a64d8' }}
      >
        {MEMO.rows[0].name}
      </span>
    </div>
  );
}

/** A memo's status pill: generating with the loader, then Ready. */
function MemoStatus({ ready }: { ready: number }) {
  const t = useSceneTime();
  const { t: tr } = useTranslation();
  const pill = 'inline-flex rounded-full px-1 py-[2px] text-[0.375rem] font-medium leading-none';
  if (t < ready) {
    return (
      <span
        className={cn(pill, 'items-center gap-0.5')}
        style={{ background: 'var(--color-border-muted)', color: 'var(--iv-text-3)' }}
      >
        <Loader />
        {tr('memoPanel.status.pending')}
      </span>
    );
  }
  return (
    <Appear at={ready} pop className="flex">
      <span
        className={pill}
        style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent-primary)' }}
      >
        {tr('memoPanel.status.ready')}
      </span>
    </Appear>
  );
}

/* the columns a narrow Memo tab keeps: name, status, description */
const COL_NAME = 'flex w-[80px] min-w-0 shrink-0 items-center gap-1 pl-1.5';
const COL_STATUS = 'flex w-[56px] shrink-0 px-1';

/** One memo in the table, listed from `at`; its description, the summary
    the agent writes of it, fills in once it is ready. */
function MemoRow({
  name,
  at,
  ready,
  description,
}: {
  name: string;
  at: number;
  ready: number;
  description: string;
}) {
  return (
    <Appear at={at} className="flex items-center py-1">
      <span className={COL_NAME}>
        <FileText className="h-2 w-2 shrink-0" style={iconStyle} />
        <span
          className="truncate text-[0.4375rem] leading-none"
          style={{ color: 'var(--iv-text)' }}
        >
          {name}
        </span>
      </span>
      <span className={COL_STATUS}>
        <MemoStatus ready={ready} />
      </span>
      <Appear
        at={ready}
        className="line-clamp-2 min-w-0 flex-1 pr-1.5 text-[0.375rem] leading-[1.35]"
        style={{ color: 'var(--iv-text-2)' }}
      >
        {description}
      </Appear>
    </Appear>
  );
}

/** The Memo tab: its title bar with Upload, the table (or the empty state
    before anything is in it), and the drop overlay while a drag is over it. */
function MemoTab() {
  const t = useSceneTime();
  const { t: tr } = useTranslation();
  const over = t >= MEMO.over && t < MEMO.drop;
  const uploading = t >= MEMO.drop && t < MEMO.uploaded;
  const listed = t >= MEMO.rows[0].at;
  return (
    <>
      <div
        className="flex items-center justify-between border-b px-1.5 py-1"
        style={{ borderColor: 'var(--iv-border)' }}
      >
        <span className="flex items-center gap-1">
          <span
            className="text-[0.5rem] font-semibold leading-none"
            style={{ color: 'var(--iv-text)' }}
          >
            {tr('memoPanel.title')}
          </span>
          <Info className="h-[7px] w-[7px]" style={iconStyle} />
        </span>
        <span className="flex items-center gap-1.5">
          <ChromeIcon icon={RefreshCw} />
          <ChromeIcon icon={CheckSquare} />
          <span
            className={cn(
              'flex items-center gap-1 rounded px-1.5 py-[3px]',
              'text-[0.4375rem] font-medium leading-none'
            )}
            style={{
              background: 'var(--color-btn-primary-bg)',
              color: 'var(--color-btn-primary-text)',
            }}
          >
            {uploading ? <Loader /> : <Upload className="h-[7px] w-[7px] shrink-0" />}
            {uploading ? tr('memoPanel.uploading') : tr('memoPanel.uploadButton')}
          </span>
        </span>
      </div>
      <div className="relative flex flex-1 flex-col">
        {listed ? (
          <>
            <div className="flex py-1 text-[0.4375rem] font-medium leading-none" style={iconStyle}>
              <span className={COL_NAME}>{tr('memoPanel.columns.name')}</span>
              <span className={COL_STATUS}>{tr('memoPanel.columns.status')}</span>
              <span>{tr('memoPanel.columns.description')}</span>
            </div>
            {MEMO.rows.map((r) => (
              <MemoRow key={r.name} {...r} />
            ))}
          </>
        ) : (
          <div
            className="flex flex-col items-center gap-1.5 px-2 py-5 text-center"
            style={iconStyle}
          >
            <ScrollText className="h-5 w-5 opacity-40" />
            <span
              className="text-[0.5rem] font-medium leading-none"
              style={{ color: 'var(--iv-text)' }}
            >
              {tr('memoPanel.empty.title')}
            </span>
            <span className="max-w-[150px] text-[0.4375rem] leading-snug">
              {tr('memoPanel.empty.hint')}
            </span>
          </div>
        )}
        {over && (
          <div
            className={cn(
              'absolute inset-1 z-[5] flex flex-col items-center justify-center gap-1',
              'rounded-[5px] border-[1.5px] border-dashed text-[0.5rem] font-medium leading-none'
            )}
            style={{
              background: 'var(--color-bg-overlay-strong)',
              borderColor: 'var(--color-accent-overlay)',
              color: 'var(--iv-text-3)',
            }}
          >
            <Upload className="h-4 w-4" style={{ color: 'var(--color-accent-primary)' }} />
            {tr('memoPanel.dragOverlayText')}
          </div>
        )}
      </div>
    </>
  );
}

function Memo() {
  const { t } = useTranslation();
  const away = useTween(MEMO.leave, 600);
  return (
    <div className="relative w-full max-w-[400px]">
      <ThreadFrame
        tabs={
          <>
            <PanelTab icon={BookMarked} label={t('filePanel.tabs.memory')} />
            <PanelTab icon={ScrollText} label={t('filePanel.tabs.memo')} active />
          </>
        }
        actions={
          <>
            <ChromeIcon icon={BookMarked} />
            <ChromeIcon icon={ScrollText} />
          </>
        }
        title="Q2 guidance"
        chat={
          <>
            <UserBubble at={0}>{MEMO.ask}</UserBubble>
            <Prose text={MEMO.answer} />
          </>
        }
        panel={<MemoTab />}
      />
      <DragChip />
      {/* the pointer drifts off once the files are in, then fades */}
      {away < 1 && (
        <div className="pointer-events-none absolute inset-0" style={{ opacity: 1 - away }}>
          <Cursor path={MEMO.path} />
        </div>
      )}
    </div>
  );
}

export const threadScenes = {
  memory: { Scene: Memory, length: MEM.length, anchor: 'right' },
  memo: { Scene: Memo, length: MEMO.length, anchor: 'right' },
} satisfies Partial<Record<IntroVisualId, IntroScene>>;
