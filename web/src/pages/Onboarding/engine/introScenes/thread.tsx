import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  BookMarked,
  BookText,
  CheckSquare,
  FileBarChart,
  FileText,
  Info,
  RefreshCw,
  ScrollText,
  TrendingUp,
  Upload,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBytes, paddedClockTime, shortMonthDay } from '@/lib/format';
import { useLocale } from '@/hooks/useLocale';
import type { IntroVisualId } from '../../registry';
import { Camera, type Shot } from './camera';
import { useSceneTime, useTween } from './clock';
import { Appear, Loader, Typed, UserBubble, pointAt, type Waypoint } from './kit';
import {
  ChromeIcon,
  PANEL_W,
  PAGE,
  PanelTab,
  Prose,
  ThreadPage,
  Timeline,
  ToolRow,
  framePage,
  iconStyle,
} from './threadParts';
import type { IntroScene } from './types';

/* Scenes for the thread intro's memory and memo steps: the chat column
   beside the file panel, Memory and Memo open as tabs of their own, drawn
   the way the thread page draws them. The page is drawn whole and a camera
   crops it to the part each beat is about. Labels are the app's own
   strings. The file panel step lives in `threadFiles`. */
/* eslint-disable react-refresh/only-export-components -- scene module:
   private scene components, one record export */

/* ── thread · step 2: long-term memory ─────────────────────────────────── */

/** A position typed and sent, the agent adding it to the `positions` topic
    file, the Memory tab's listing of that file picking up the change, and
    the pointer opening it to show the line it gained. Positions are px on
    the thread page: positions.md is the second file in the listing. */
const MEM = {
  earlier: 'Where did NVDA close?',
  before: 'NVDA closed at **$182.42**, up 1.61% on the day.',
  ask: 'remember: long NVDA, 4%',
  typeAsk: 400,
  sendAsk: 1400,
  save: 1800,
  saved: 2400,
  topic: 'positions',
  reply: 'Noted. NVDA ideas will now be sized against the 4% you already hold.',
  replyAt: 2550,
  listed: 4500,
  path: [
    { at: 4600, x: 330, y: 150 },
    { at: 5100, x: 236, y: 98 },
    { at: 5450, x: 236, y: 98 },
    { at: 6000, x: 360, y: 260 },
  ] satisfies Waypoint[],
  click: 5200,
  open: 5280,
  length: 7600,
};

/** The camera: close on the composer as the ask is typed, back a little for
    the exchange, then across to the Memory tab as the topic file changes,
    and onto the file once it opens, the line it gained last. */
const MEM_SHOTS: [Shot, ...Shot[]] = [
  { at: 0, ...framePage({ x: 10, y: 225, w: 168, h: 100 }, 4) },
  { at: 2300, dur: 700, ...framePage({ x: 6, y: 167, w: 182, h: 160 }, 0) },
  { at: 4300, dur: 900, ...framePage({ x: 188, y: 28, w: 170, h: 140 }, 0) },
  { at: 6200, dur: 900, ...framePage({ x: 190, y: 30, w: 184, h: 152 }, 0) },
];

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
  const saved = now >= MEM.listed;
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
  const composer =
    t >= MEM.typeAsk && t < MEM.sendAsk ? <Typed text={MEM.ask} at={MEM.typeAsk} /> : undefined;
  return (
    <Camera shots={MEM_SHOTS} cursor={MEM.path} clicks={[MEM.click]}>
      <ThreadPage
        title="NVDA sizing"
        stack="bottom"
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
            <UserBubble at={0}>{MEM.earlier}</UserBubble>
            <Timeline>
              <ToolRow
                icon={TrendingUp}
                running={{ label: tr('toolArtifact.tool.stockPrices'), pill: 'NVDA' }}
                settled={{ label: tr('toolArtifact.tool.stockPrices'), pill: 'NVDA' }}
                at={0}
                done={0}
              />
            </Timeline>
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
    </Camera>
  );
}

/* ── thread · step 3: memos ────────────────────────────────────────────── */

/** Two documents dragged in from Finder and dropped on the Memo tab, below
    the memos already there: the drop overlay takes the drag, Upload reads
    "Uploading…", then each new memo is listed generating its summary and
    turns Ready with its description. Then a question typed under the
    thread's last exchange, which the agent answers from both. Positions are
    px on the thread page; the overlay shows while the pointer is over the
    panel, and the drag holds left of the overlay's label so both read. */
const MEMO = {
  path: [
    { at: 300, x: 120, y: 240 },
    { at: 1400, x: 212, y: 172 },
    { at: 1750, x: 212, y: 172 },
    { at: 2400, x: 330, y: 380 },
  ] satisfies Waypoint[],
  drop: 1600,
  uploaded: 2400,
  /** Listed oldest first, as the tab sorts them. */
  held: [
    { name: 'semis-comps.csv', description: 'NTM consensus for nine AI semis' },
    { name: 'ai-capex.md', description: 'Hyperscaler capex by quarter' },
  ],
  rows: [
    {
      name: 'nvda-10q.pdf',
      at: 2400,
      ready: 3200,
      description: '10-Q for the quarter ended Jul 27',
    },
    { name: 'call-notes.md', at: 2500, ready: 3600, description: 'Notes from the Q2 call' },
  ],
  earlier: {
    ask: "How did NVDA's Q2 land?",
    answer: 'Revenue of **$46.7B**, up 56% from a year ago. Data center made $41.1B of it.',
  },
  ask: 'What did they guide for Q3?',
  typeAsk: 4100,
  askAt: 4950,
  reads: [
    { slug: 'call-notes.md', at: 5350 },
    { slug: 'nvda-10q.pdf', at: 5700 },
  ],
  read: 400,
  answer:
    'Q3 revenue of **$54.0B**, plus or minus 2%, assuming no H20 sales to China. ' +
    'Gross margin of 73.5%, plus or minus 50 bps, on opex of about $4.2B. ' +
    'Full-year opex growth in the high 30s.',
  answerAt: 6250,
  cite: 'From `call-notes.md` and `nvda-10q.pdf`.',
  citeAt: 7550,
  length: 8700,
};

/** The camera: on the Memo tab's list as the drag comes over it, up to its
    title bar and table as the drop uploads and each memo turns Ready, then
    across to the chat's last exchange and the composer as the question is
    typed and the reads come in, the top edge kept between messages as the
    thread scrolls, then in on the question and its answer. */
const MEMO_SHOTS: [Shot, ...Shot[]] = [
  { at: 0, ...framePage({ x: 188, y: 72, w: PANEL_W, h: 176 }, 0) },
  { at: 2300, dur: 700, ...framePage({ x: 188, y: 0, w: PANEL_W, h: 170 }, 0) },
  { at: 4500, dur: 700, ...framePage({ x: 0, y: 169, w: PAGE.width - PANEL_W, h: 155 }, 0) },
  { at: 5450, dur: 200, ...framePage({ x: 1, y: 176.5, w: 186, h: 153.5 }, 0) },
  { at: 7550, dur: 1100, ...framePage({ x: 4, y: 125.5, w: 180, h: 148.5 }, 0) },
];

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

/** The Memo tab: its title bar with Upload, the table, and the drop overlay
    while a drag is over it. */
function MemoTab() {
  const t = useSceneTime();
  const { t: tr } = useTranslation();
  const over =
    t < MEMO.drop && t >= MEMO.path[0].at && pointAt(MEMO.path, t).x >= PAGE.width - PANEL_W;
  const uploading = t >= MEMO.drop && t < MEMO.uploaded;
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
        <div className="flex py-1 text-[0.4375rem] font-medium leading-none" style={iconStyle}>
          <span className={COL_NAME}>{tr('memoPanel.columns.name')}</span>
          <span className={COL_STATUS}>{tr('memoPanel.columns.status')}</span>
          <span>{tr('memoPanel.columns.description')}</span>
        </div>
        {MEMO.held.map((r) => (
          <MemoRow key={r.name} {...r} at={0} ready={0} />
        ))}
        {MEMO.rows.map((r) => (
          <MemoRow key={r.name} {...r} />
        ))}
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
  const t = useSceneTime();
  const { t: tr } = useTranslation();
  return (
    <Camera shots={MEMO_SHOTS} cursor={MEMO.path}>
      <ThreadPage
        tabs={
          <>
            <PanelTab icon={BookMarked} label={tr('filePanel.tabs.memory')} />
            <PanelTab icon={ScrollText} label={tr('filePanel.tabs.memo')} active />
          </>
        }
        actions={
          <>
            <ChromeIcon icon={BookMarked} />
            <ChromeIcon icon={ScrollText} />
          </>
        }
        title="Q2 guidance"
        stack="bottom"
        chat={
          <>
            <UserBubble at={0}>{MEMO.earlier.ask}</UserBubble>
            <Timeline>
              <ToolRow
                icon={FileBarChart}
                running={{ label: tr('toolArtifact.tool.financialStatements'), pill: 'NVDA' }}
                settled={{ label: tr('toolArtifact.tool.financialStatements'), pill: 'NVDA' }}
                at={0}
                done={0}
              />
            </Timeline>
            <Prose text={MEMO.earlier.answer} />
            <UserBubble at={MEMO.askAt}>{MEMO.ask}</UserBubble>
            <Timeline>
              {MEMO.reads.map((r) => (
                <ToolRow
                  key={r.slug}
                  icon={BookText}
                  running={{
                    label: tr('toolArtifact.inProgress.readingMemoSlug', { slug: r.slug }),
                  }}
                  settled={{ label: tr('toolArtifact.completed.readMemo'), pill: r.slug }}
                  at={r.at}
                  done={r.at + MEMO.read}
                />
              ))}
            </Timeline>
            <Prose text={MEMO.answer} at={MEMO.answerAt} cps={160} />
            <Prose text={MEMO.cite} at={MEMO.citeAt} />
          </>
        }
        panel={<MemoTab />}
        composer={
          t >= MEMO.typeAsk && t < MEMO.askAt ? (
            <Typed text={MEMO.ask} at={MEMO.typeAsk} cps={36} />
          ) : undefined
        }
        sendAt={[MEMO.askAt]}
      />
      <DragChip />
    </Camera>
  );
}

export const threadScenes = {
  memory: { Scene: Memory, length: MEM.length, anchor: 'right' },
  memo: { Scene: Memo, length: MEMO.length, anchor: 'right' },
} satisfies Partial<Record<IntroVisualId, IntroScene>>;
