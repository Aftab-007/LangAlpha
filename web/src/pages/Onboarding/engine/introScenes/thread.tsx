import type { ReactNode } from 'react';
import { ArrowLeft, BookMarked, ChevronRight, FileText, Folder, Upload } from 'lucide-react';
import { useAgentNames } from '../introAgents';
import type { IntroVisualId } from '../../registry';
import { useSceneTime, useTween } from './clock';
import {
  Appear,
  Cursor,
  Frame,
  InputDock,
  Ln,
  Region,
  StreamLn,
  Tag,
  Typed,
  UserBubble,
  Working,
  pointAt,
  type Waypoint,
} from './kit';
import type { IntroScene } from './types';

/* Scenes for the thread intro: the chat column beside the tabbed right panel
   (files, memory, memos). */
/* eslint-disable react-refresh/only-export-components -- scene module:
   private scene components, one record export */

/* ── thread page base: chat column + tabbed right panel ────────────────── */

function PanelTabs({ active }: { active: 'files' | 'memory' | 'memos' }) {
  const tabs = ['files', 'memory', 'memos'] as const;
  return (
    <div className="flex items-center gap-1">
      {tabs.map((t) => (
        <span
          key={t}
          className="rounded px-1.5 py-0.5 font-mono text-[0.5rem] leading-none"
          style={
            t === active
              ? { background: 'var(--iv-accent-deep)', color: '#fff' }
              : { color: 'var(--iv-text-3)' }
          }
        >
          {t}
        </span>
      ))}
    </div>
  );
}

/** Small mono text in a scene row. */
function Mono({ children, dim = false }: { children: ReactNode; dim?: boolean }) {
  return (
    <span
      className="whitespace-nowrap font-mono text-[0.4375rem] leading-none"
      style={{ color: dim ? 'var(--iv-text-3)' : 'var(--iv-text-2)' }}
    >
      {children}
    </span>
  );
}

/** A row in the workspace file tree, shown from `at`. A folder opens at
    `openAt`; a new file carries the teal changed dot. */
function TreeRow({
  depth = 0,
  name,
  folder = false,
  openAt,
  at = 0,
  isNew = false,
}: {
  depth?: number;
  name: string;
  folder?: boolean;
  openAt?: number;
  at?: number;
  isNew?: boolean;
}) {
  const turn = useTween(openAt ?? 0, 220);
  const angle = openAt == null ? 0 : turn * 90;
  return (
    <Appear at={at} className="flex items-center gap-1" style={{ paddingLeft: depth * 8 }}>
      {folder ? (
        <>
          <ChevronRight
            className="h-2 w-2 shrink-0"
            style={{ color: 'var(--iv-text-3)', transform: `rotate(${angle}deg)` }}
          />
          <Folder className="h-2 w-2 shrink-0" style={{ color: 'var(--iv-text-3)' }} />
        </>
      ) : (
        <FileText className="h-2 w-2 shrink-0" style={{ color: 'var(--iv-text-3)' }} />
      )}
      <Mono>{name}</Mono>
      {isNew && (
        <span
          className="ml-auto h-1 w-1 shrink-0 rounded-full"
          style={{ background: 'var(--iv-teal)' }}
        />
      )}
    </Appear>
  );
}

/** One tool call in the agent's turn: icon · what it is doing · spinner,
    then the done label and ✓. */
function ToolRow({
  icon,
  label,
  doneLabel,
  at,
  done,
}: {
  icon: ReactNode;
  label: string;
  doneLabel: string;
  at: number;
  done: number;
}) {
  const t = useSceneTime();
  return (
    <Appear at={at} className="flex items-center gap-1">
      {icon}
      <Mono>{t < done ? label : doneLabel}</Mono>
      <span className="ml-auto flex">
        <Working at={at} done={done} />
      </span>
    </Appear>
  );
}

const toolIcon = (Icon: typeof FileText) => (
  <Icon className="h-2 w-2 shrink-0" style={{ color: 'var(--iv-text-3)' }} />
);

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

function ThreadFrame({
  tab,
  chat,
  panel,
  composer,
  sendAt,
}: {
  tab: 'files' | 'memory' | 'memos';
  chat: ReactNode;
  panel: ReactNode;
  composer?: ReactNode;
  sendAt?: number[];
}) {
  const { worker } = useAgentNames();
  return (
    <Frame
      topbar={
        <>
          <ArrowLeft className="h-2.5 w-2.5 shrink-0" style={{ color: 'var(--iv-text-3)' }} />
          <Ln w="24%" />
          <span className="ml-auto">
            <Tag>{worker}</Tag>
          </span>
        </>
      }
    >
      <div className="flex flex-1 gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {chat}
          <InputDock text={composer} sendAt={sendAt} />
        </div>
        {/* the panel is the subject — give it the wider column (the chat
            side bleeds off the left edge anyway) */}
        <Region hot delay={0.15} className="flex flex-[1.25] flex-col gap-1.5 p-1.5">
          <div className="flex items-center justify-between gap-1">
            <PanelTabs active={tab} />
            <span className="intro-pulse" style={{ width: 5, height: 5 }} />
          </div>
          {panel}
        </Region>
      </div>
    </Frame>
  );
}

/* ── thread · step 1: file panel ───────────────────────────────────────── */

/** The Analyst's turn: a line of narration, then each file it writes lands
    in the tree as its write finishes (notes at the root, then data/ opens on
    two more), and results/ is named as where deliverables go. Folders sort
    before files, as in the real tree. */
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
  tag: 4650,
  length: 5400,
};

function FilePanel() {
  const [notes, prices, model] = FILES.writes.map((w) => w.at + FILES.write);
  return (
    <ThreadFrame
      tab="files"
      chat={
        <>
          <History />
          {FILES.lead.map((l) => (
            <StreamLn key={l.at} w={l.w} at={l.at} />
          ))}
          {FILES.writes.map((w) => (
            <ToolRow
              key={w.name}
              icon={toolIcon(FileText)}
              label={`writing ${w.name}…`}
              doneLabel={w.name}
              at={w.at}
              done={w.at + FILES.write}
            />
          ))}
          {FILES.tail.map((l) => (
            <StreamLn key={l.at} w={l.w} at={l.at} />
          ))}
        </>
      }
      panel={
        <>
          <TreeRow name="results/" folder />
          <TreeRow name="data/" folder openAt={FILES.open} />
          <TreeRow depth={1} name="prices.csv" at={prices} isNew />
          <TreeRow depth={1} name="model.py" at={model} isNew />
          <TreeRow name="notes.md" at={notes} isNew />
          <Appear at={FILES.tag}>
            <Tag color="var(--iv-teal)">deliverables → results/</Tag>
          </Appear>
        </>
      }
    />
  );
}

/* ── thread · step 2: long-term memory ─────────────────────────────────── */

/** A preference typed and sent, the agent adding it to memory, and the
    memory list gaining it as an entry every thread reads. */
const MEM = {
  ask: "remember: I'm long NVDA",
  typeAsk: 450,
  sendAsk: 1500,
  save: 1950,
  saved: 2650,
  lines: [
    { w: '78%', at: 2900 },
    { w: '84%', at: 3220 },
    { w: '60%', at: 3540 },
  ],
  tag: 4200,
  length: 5000,
};

/** One entry in the memory list: teal bullet, then the remembered line. */
function MemoryEntry({ at = 0, children }: { at?: number; children: ReactNode }) {
  return (
    <Appear at={at} className="flex items-center gap-1.5">
      <span className="h-1 w-1 shrink-0 rounded-full" style={{ background: 'var(--iv-teal)' }} />
      {children}
    </Appear>
  );
}

function Memory() {
  const t = useSceneTime();
  const composer =
    t >= MEM.typeAsk && t < MEM.sendAsk ? <Typed text={MEM.ask} at={MEM.typeAsk} /> : undefined;
  return (
    <ThreadFrame
      tab="memory"
      composer={composer}
      sendAt={[MEM.sendAsk]}
      chat={
        <>
          <History />
          <UserBubble at={MEM.sendAsk + 80}>{MEM.ask}</UserBubble>
          <ToolRow
            icon={toolIcon(BookMarked)}
            label="adding memory…"
            doneLabel="added memory"
            at={MEM.save}
            done={MEM.saved}
          />
          {MEM.lines.map((l) => (
            <StreamLn key={l.at} w={l.w} at={l.at} />
          ))}
        </>
      }
      panel={
        <>
          <MemoryEntry>
            <Ln w="82%" />
          </MemoryEntry>
          <MemoryEntry>
            <Ln w="68%" />
          </MemoryEntry>
          {/* the new entry, stamped like the real list's modified time */}
          <MemoryEntry at={MEM.saved}>
            <Mono>user is long NVDA</Mono>
            <span className="ml-auto flex">
              <Mono dim>just now</Mono>
            </span>
          </MemoryEntry>
          <Appear at={MEM.tag}>
            <Tag color="var(--iv-teal)">applies to every thread</Tag>
          </Appear>
        </>
      }
    />
  );
}

/* ── thread · step 3: memos ────────────────────────────────────────────── */

/** Two documents dragged in from the chat side and dropped on the memo drop
    zone: it uploads them, each memo generates its summary, then reads ready. */
const MEMO = {
  // pointer in px of the 400px scene; the drop zone spans x 200–382, y 64–88
  path: [
    { at: 350, x: 74, y: 236 },
    { at: 650, x: 74, y: 236 },
    { at: 1850, x: 236, y: 70 },
    { at: 2150, x: 236, y: 70 },
    { at: 2750, x: 318, y: 172 },
  ] satisfies Waypoint[],
  over: 1550,
  drop: 2050,
  uploaded: 2650,
  leave: 2550,
  rows: [
    { name: 'nvda-10q.pdf', at: 2650, ready: 3550 },
    { name: 'call-notes.md', at: 2750, ready: 4050 },
  ],
  length: 5000,
};

/** The file chip under the pointer while it drags, with the count badge
    the OS draws for a multi-file drag; it fades into the zone on drop. */
function DragChip() {
  const t = useSceneTime();
  const sink = useTween(MEMO.drop, 240);
  if (t < MEMO.path[0].at || sink >= 1) return null;
  const { x, y } = pointAt(MEMO.path, t);
  return (
    <div
      className="pointer-events-none absolute z-[9]"
      style={{
        left: x + 2,
        top: y + 9,
        opacity: 1 - sink,
        transform: `scale(${1 - 0.25 * sink})`,
      }}
    >
      <div
        className="flex items-center gap-1 rounded border px-1.5 py-1"
        style={{ background: 'var(--iv-mk-bg)', borderColor: 'var(--iv-mk-border)' }}
      >
        <FileText className="h-2 w-2 shrink-0" style={{ color: 'var(--iv-text-3)' }} />
        <Mono>{MEMO.rows[0].name}</Mono>
      </div>
      <span
        className="absolute -right-1.5 -top-1.5 flex h-2.5 w-2.5 items-center justify-center rounded-full font-mono text-[0.375rem] leading-none text-white"
        style={{ background: 'var(--iv-accent-deep)' }}
      >
        2
      </span>
    </div>
  );
}

/** One memo: icon square and name, "generating" with a spinner while its
    summary is written, then ready. */
function MemoRow({ name, at, ready }: { name: string; at: number; ready: number }) {
  const t = useSceneTime();
  return (
    <Appear at={at} className="flex items-center gap-1.5">
      <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: 'var(--iv-accent)' }} />
      <Mono>{name}</Mono>
      {/* fixed height: the ready tag stands taller than the spinner */}
      <span className="ml-auto flex h-3 items-center gap-1">
        {t < ready ? (
          <>
            <Mono dim>generating</Mono>
            <span className="intro-spin" aria-hidden />
          </>
        ) : (
          <Appear at={ready} pop>
            <Tag color="var(--iv-teal)">ready</Tag>
          </Appear>
        )}
      </span>
    </Appear>
  );
}

function Memo() {
  const t = useSceneTime();
  // the zone lights up while the chip is over it, then uploads
  const over = t >= MEMO.over && t < MEMO.drop;
  const uploading = t >= MEMO.drop && t < MEMO.uploaded;
  const away = useTween(MEMO.leave, 600);
  return (
    <div className="relative w-full max-w-[400px]">
      <ThreadFrame
        tab="memos"
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
        panel={
          <>
            <Region
              dashed
              className="flex h-6 items-center justify-center gap-1 px-1.5"
              style={
                over
                  ? {
                      borderColor: 'hsl(var(--primary) / 0.7)',
                      background: 'hsl(var(--primary) / 0.08)',
                    }
                  : undefined
              }
            >
              {uploading ? (
                <span className="intro-spin" aria-hidden />
              ) : (
                <Upload
                  className="h-2.5 w-2.5"
                  style={{ color: over ? 'var(--iv-accent)' : 'var(--iv-text-3)' }}
                />
              )}
              {/* the dragged chip covers the zone, so over it the zone only
                  changes color */}
              {uploading ? (
                <Mono dim>uploading…</Mono>
              ) : (
                <Ln w="42%" c={over ? 'hsl(var(--primary) / 0.45)' : undefined} />
              )}
            </Region>
            {MEMO.rows.map((r) => (
              <MemoRow key={r.name} {...r} />
            ))}
          </>
        }
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
