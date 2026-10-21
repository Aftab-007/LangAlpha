import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowUpDown,
  BookMarked,
  CandlestickChart,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  FilePlus,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  HardDrive,
  Info,
  PanelRight,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  Settings,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBytes, paddedClockTime, shortMonthDay } from '@/lib/format';
import { useLocale } from '@/hooks/useLocale';
import { useAgentNames } from '../introAgents';
import type { IntroVisualId } from '../../registry';
import { useSceneTime, useTween } from './clock';
import {
  Appear,
  Cursor,
  Frame,
  InputDock,
  Ln,
  Loader,
  StreamLn,
  Tag,
  Typed,
  UserBubble,
  pointAt,
  type Waypoint,
} from './kit';
import type { IntroScene } from './types';

/* Scenes for the thread intro: the chat column beside the file panel, drawn
   the way the thread page draws them. The panel is a full-height column with
   its own tab strip, the tree beside a file or empty tab, and Memory and Memo
   opening as tabs of their own. Labels are the app's own strings. */
/* eslint-disable react-refresh/only-export-components -- scene module:
   private scene components, one record export */

/* ── thread page base: chat column + file panel ────────────────────────── */

/** The file panel's width in the 400px scene; the chat column takes the rest. */
const PANEL_W = 212;

const iconStyle = { color: 'var(--iv-text-3)' };

/** A tab in the panel's strip: the open one sits on a raised pill. */
function PanelTab({
  icon: Icon,
  label,
  active = false,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
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
      <span className="truncate">{label}</span>
    </span>
  );
}

/** An icon button in the panel or tree chrome. */
function ChromeIcon({ icon: Icon, on = false }: { icon: LucideIcon; on?: boolean }) {
  return (
    <Icon
      className="h-2 w-2 shrink-0"
      style={{ color: on ? 'var(--iv-text)' : 'var(--iv-text-3)' }}
    />
  );
}

/** Earlier turns in the thread, above whatever the scene plays out. */
function History() {
  return (
    <>
      <Ln w="70%" />
      <Ln w="86%" />
      <Ln w="52%" />
    </>
  );
}

/**
 * The thread page: the chat column with its header, and the file panel
 * beside it, its tab strip level with the chat header. `tabs` and `actions`
 * fill the strip; `panel` is everything under it.
 */
function ThreadFrame({
  tabs,
  actions,
  chat,
  panel,
  composer,
  sendAt,
}: {
  tabs: ReactNode;
  actions: ReactNode;
  chat: ReactNode;
  panel: ReactNode;
  composer?: ReactNode;
  sendAt?: number[];
}) {
  const { worker } = useAgentNames();
  return (
    <Frame
      topbar={
        <div className="-mx-2.5 flex h-full flex-1 items-stretch">
          <div className="flex min-w-0 flex-1 items-center gap-2 px-2.5">
            <ArrowLeft className="h-2.5 w-2.5 shrink-0" style={iconStyle} />
            <Ln w="30%" />
            <span className="ml-auto flex items-center gap-1.5">
              <Tag>{worker}</Tag>
              {/* the folder button that opens the panel, held while it is open */}
              <span
                className="flex h-3.5 w-3.5 items-center justify-center rounded"
                style={{ background: 'var(--color-border-muted)' }}
              >
                <FolderOpen className="h-2.5 w-2.5" style={{ color: 'var(--iv-text)' }} />
              </span>
            </span>
          </div>
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
        </div>
      }
    >
      <div className="-m-2.5 flex flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-2.5">
          {chat}
          <InputDock text={composer} sendAt={sendAt} />
        </div>
        <div
          className="flex shrink-0 flex-col border-l"
          style={{ width: PANEL_W, borderColor: 'var(--iv-border)' }}
        >
          {panel}
        </div>
      </div>
    </Frame>
  );
}

/** A turn's tool calls, threaded on the timeline's rule through their icons. */
function Timeline({ children }: { children: ReactNode }) {
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
function ToolRow({
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

/* ── thread · step 1: file panel ───────────────────────────────────────── */

/** The Analyst's turn: a line of narration, then each file it writes lands
    in the tree as its write finishes (notes at the root, then data/ opens on
    two more). The tree sorts as the app's does: root files first, then
    results/ and data/ ahead of other folders, names A to Z within. */
const FILES = {
  lead: [
    { w: '78%', at: 400 },
    { w: '60%', at: 760 },
  ],
  writes: [
    { name: 'notes.md', at: 1200 },
    { name: 'prices.csv', at: 2050 },
    { name: 'model.py', at: 2900 },
  ],
  write: 600,
  open: 2650,
  tail: [
    { w: '84%', at: 3750 },
    { w: '40%', at: 4100 },
  ],
  length: 5400,
};

/** What an empty tab shows beside the tree: where a file comes from, and that
    the tab can be a chart instead. Its dotted ground is the app's. */
function EmptyTab() {
  const { t } = useTranslation();
  return (
    <div
      className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-2 text-center"
      style={{
        backgroundImage: 'radial-gradient(var(--color-border-muted) 1px, transparent 0)',
        backgroundSize: '10px 10px',
      }}
    >
      <FolderOpen className="h-4 w-4" style={iconStyle} />
      <span
        className="text-[0.5rem] font-medium leading-none"
        style={{ color: 'var(--iv-text-2)' }}
      >
        {t('filePanel.openFile')}
      </span>
      <span
        className={cn(
          'mt-0.5 flex items-center gap-1 rounded border px-1.5 py-1',
          'text-[0.4375rem] font-medium leading-none'
        )}
        style={{
          background: 'var(--color-bg-card)',
          borderColor: 'var(--color-border-default)',
          color: 'var(--iv-text)',
        }}
      >
        <CandlestickChart className="h-[7px] w-[7px] shrink-0" />
        {t('filePanel.openChart')}
      </span>
      <span className="mt-0.5 flex w-full flex-col items-center gap-[3px]">
        <Ln w="84%" h={2.5} />
        <Ln w="58%" h={2.5} />
      </span>
    </div>
  );
}

/** The tree column: its toolbar, the search field, Memory and Memo pinned
    above the listing, then the listing. */
function TreeColumn({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex w-[116px] shrink-0 flex-col border-l"
      style={{ borderColor: 'var(--iv-border)' }}
    >
      <div className="flex items-center gap-[5px] px-1.5 pb-1 pt-1.5">
        {[CheckSquare, Upload, HardDrive, RefreshCw, ArrowUpDown].map((icon, i) => (
          <ChromeIcon key={i} icon={icon} />
        ))}
        <span className="ml-auto flex">
          <ChromeIcon icon={Settings} />
        </span>
      </div>
      <div className="px-1 pb-1">
        <div
          className="flex h-3.5 items-center gap-1 rounded border px-1"
          style={{ background: 'var(--color-bg-input)', borderColor: 'var(--color-border-muted)' }}
        >
          <Search className="h-[7px] w-[7px] shrink-0" style={iconStyle} />
          <span className="truncate text-[0.375rem] leading-none" style={iconStyle}>
            {t('filePanel.searchFiles')}
          </span>
        </div>
      </div>
      <div className="border-b pb-0.5" style={{ borderColor: 'var(--iv-border)' }}>
        <TreeFile icon={BookMarked} name={t('filePanel.tabs.memory')} />
        <TreeFile icon={ScrollText} name={t('filePanel.tabs.memo')} />
      </div>
      <div className="flex flex-col pt-0.5">{children}</div>
    </div>
  );
}

/** A file in the tree, listed from `at`: its type's icon, then the name. */
function TreeFile({
  icon: Icon = FileText,
  name,
  nested = false,
  at = 0,
}: {
  icon?: LucideIcon;
  name: string;
  nested?: boolean;
  at?: number;
}) {
  return (
    <Appear
      at={at}
      className="flex min-w-0 items-center gap-1 py-[3px] pr-1.5"
      style={{ paddingLeft: nested ? 10 : 6 }}
    >
      <Icon className="h-[7px] w-[7px] shrink-0" style={iconStyle} />
      <span className="truncate text-[0.4375rem] leading-none" style={{ color: 'var(--iv-text)' }}>
        {name}
      </span>
    </Appear>
  );
}

/** A folder in the tree: chevron, folder, `name/` and how many files it
    holds; it opens at `openAt`. */
function TreeFolder({ name, count, openAt }: { name: string; count: number; openAt?: number }) {
  const t = useSceneTime();
  const Chevron = openAt != null && t >= openAt ? ChevronDown : ChevronRight;
  return (
    <div className="flex min-w-0 items-center gap-[3px] py-[3px] pl-[9px] pr-1.5">
      <Chevron className="h-[7px] w-[7px] shrink-0" style={iconStyle} />
      <Folder className="h-[7px] w-[7px] shrink-0" style={iconStyle} />
      <span className="truncate text-[0.4375rem] font-medium leading-none" style={iconStyle}>
        {name}/
      </span>
      <span className="text-[0.4375rem] leading-none" style={{ color: 'var(--color-icon-muted)' }}>
        {count}
      </span>
    </div>
  );
}

function FilePanel() {
  const t = useSceneTime();
  const { t: tr } = useTranslation();
  const [notes, prices, model] = FILES.writes.map((w) => w.at + FILES.write);
  // data/ already holds one file; the two written into it count as they land
  const inData = 1 + Number(t >= prices) + Number(t >= model);
  return (
    <ThreadFrame
      tabs={<PanelTab icon={FolderOpen} label={tr('filePanel.openFile')} active />}
      actions={<ChromeIcon icon={PanelRight} on />}
      chat={
        <>
          <History />
          {FILES.lead.map((l) => (
            <StreamLn key={l.at} w={l.w} at={l.at} />
          ))}
          <Timeline>
            {FILES.writes.map((w) => (
              <ToolRow
                key={w.name}
                icon={FilePlus}
                running={{ label: tr('toolArtifact.running.write'), pill: w.name }}
                settled={{ label: tr('toolArtifact.tool.write'), pill: w.name }}
                at={w.at}
                done={w.at + FILES.write}
              />
            ))}
          </Timeline>
          {FILES.tail.map((l) => (
            <StreamLn key={l.at} w={l.w} at={l.at} />
          ))}
        </>
      }
      panel={
        <div className="flex flex-1">
          <EmptyTab />
          <TreeColumn>
            <TreeFile name="notes.md" at={notes} />
            <TreeFolder name="results" count={2} />
            <TreeFolder name="data" count={inData} openAt={FILES.open} />
            <TreeFile nested name="model.py" at={model} />
            <TreeFile nested icon={FileSpreadsheet} name="prices.csv" at={prices} />
            <TreeFile nested icon={FileSpreadsheet} name="universe.csv" at={FILES.open} />
          </TreeColumn>
        </div>
      }
    />
  );
}

/* ── thread · step 2: long-term memory ─────────────────────────────────── */

/** A preference typed and sent, the agent adding it to memory as a topic
    file, and the Memory tab's list gaining that file. */
const MEM = {
  ask: "remember: I'm long NVDA",
  typeAsk: 450,
  sendAsk: 1500,
  save: 1950,
  saved: 2650,
  topic: 'positions',
  lines: [
    { w: '78%', at: 2900 },
    { w: '84%', at: 3220 },
    { w: '60%', at: 3540 },
  ],
  length: 5000,
};

/** One file in the memory list: its name, then size and when it changed
    (the time of day when that was today). */
function MemoryFile({
  name,
  bytes,
  modified,
  today = false,
  at = 0,
}: {
  name: string;
  bytes: number;
  modified: Date;
  today?: boolean;
  at?: number;
}) {
  const locale = useLocale();
  const when = today ? paddedClockTime(modified, locale) : shortMonthDay(modified, locale);
  return (
    <Appear at={at} className="flex min-w-0 items-center gap-1.5 px-1.5 py-1">
      <FileText className="h-[9px] w-[9px] shrink-0" style={iconStyle} />
      <span className="flex min-w-0 flex-col gap-[3px]">
        <span className="truncate text-[0.5rem] leading-none" style={{ color: 'var(--iv-text)' }}>
          {name}
        </span>
        <span className="text-[0.375rem] leading-none" style={iconStyle}>
          {formatBytes(bytes, locale)} · {when}
        </span>
      </span>
    </Appear>
  );
}

/** The Memory tab: the User / Workspace switch, the folder it lists, and the
    files in it, memory.md first. */
function MemoryTab() {
  const { t } = useTranslation();
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
        bytes={184}
        modified={new Date(2026, 9, 21, 14, 5)}
        today
        at={MEM.saved}
      />
      <MemoryFile name="risk-preferences.md" bytes={640} modified={new Date(2026, 9, 12)} />
      <MemoryFile name="watchlist.md" bytes={412} modified={new Date(2026, 9, 9)} />
    </>
  );
}

function Memory() {
  const t = useSceneTime();
  const { t: tr } = useTranslation();
  const composer =
    t >= MEM.typeAsk && t < MEM.sendAsk ? <Typed text={MEM.ask} at={MEM.typeAsk} /> : undefined;
  return (
    <ThreadFrame
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
          <History />
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
          {MEM.lines.map((l) => (
            <StreamLn key={l.at} w={l.w} at={l.at} />
          ))}
        </>
      }
      panel={<MemoryTab />}
    />
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
    { name: 'nvda-10q.pdf', at: 2650, ready: 3550 },
    { name: 'call-notes.md', at: 2750, ready: 4050 },
  ],
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

/** One memo in the table, listed from `at`; its description fills in once
    it is ready. */
function MemoRow({ name, at, ready }: { name: string; at: number; ready: number }) {
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
      <Appear at={ready} className="flex flex-1 flex-col gap-[3px] pr-1.5">
        <Ln w="92%" h={2.5} />
        <Ln w="62%" h={2.5} />
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
        chat={
          <>
            <History />
            <Ln w="78%" />
            <Ln w="84%" />
            <Ln w="60%" />
            <Ln w="72%" />
            <Ln w="40%" />
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
  filePanel: { Scene: FilePanel, length: FILES.length, anchor: 'right' },
  memory: { Scene: Memory, length: MEM.length, anchor: 'right' },
  memo: { Scene: Memo, length: MEMO.length, anchor: 'right' },
} satisfies Partial<Record<IntroVisualId, IntroScene>>;
