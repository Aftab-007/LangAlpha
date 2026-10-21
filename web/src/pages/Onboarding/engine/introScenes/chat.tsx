import type { ReactNode } from 'react';
import {
  ChevronRight,
  Clock,
  FileText,
  Folder,
  Plus,
  Search,
  Upload,
  X,
} from 'lucide-react';
import { HomeRowIcon } from '@/hooks/useHomeWorkspace';
import { cn } from '@/lib/utils';
import { useAgentNames } from '../introAgents';
import type { IntroVisualId } from '../../registry';
import { progress, useSceneTime, useTween } from './clock';
import {
  Appear,
  Caret,
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
  rv,
} from './kit';
import type { IntroScene } from './types';

/* Scenes for the chat intro: the two agents, the Chief of Staff's turn, the
   Analyst's run, the workspace gallery, and creating a workspace. */
/* eslint-disable react-refresh/only-export-components -- scene module:
   private scene components, one record export */

/** Whether `t` falls in `[from, to)`. */
const during = (t: number, from: number, to: number) => t >= from && t < to;

/** A running label: a spinner and plain status text, as the app shows it. */
function Running({ label, color }: { label: string; color?: string }) {
  return (
    <span className="flex items-center gap-1">
      <span
        className="intro-spin"
        style={color ? { borderTopColor: color } : undefined}
        aria-hidden
      />
      <span
        className="font-mono text-[0.4375rem] leading-none"
        style={{ color: 'var(--iv-text-3)' }}
      >
        {label}
      </span>
    </span>
  );
}

/** A desk's last-updated line. With `run`, an agent works in the desk over
    `[from, to)` (spinner, status), then it reads as just updated. */
function DeskStatus({ run }: { run?: [number, number] }) {
  const t = useSceneTime();
  if (!run || t < run[0]) return <Ln w="32%" h={2} c="var(--iv-line-3)" />;
  if (t < run[1]) return <Running label="agent running" />;
  return (
    <span
      className="intro-rv block w-fit font-mono text-[0.4375rem] leading-none"
      style={{ ...rv(0), color: 'var(--iv-text-3)' }}
    >
      <span style={{ color: 'var(--iv-teal)' }}>✓</span> updated just now
    </span>
  );
}

/** A workspace card in the gallery wireframe: title, blurb, updated-at.
    The All workspaces card is fully color-filled, which is how users tell it
    apart from regular (unfilled) workspace cards in the real gallery. */
function WsCard({
  hot = false,
  home = false,
  delay,
  run,
  className = '',
}: {
  hot?: boolean;
  home?: boolean;
  delay?: number;
  run?: [number, number];
  className?: string;
}) {
  return (
    <Region
      hot={hot}
      delay={delay}
      className={`flex flex-col gap-1 p-2 ${className}`}
      style={
        home
          ? {
              background:
                'linear-gradient(135deg, hsl(var(--primary) / 0.22), hsl(var(--primary) / 0.08))',
              borderColor: 'hsl(var(--primary) / 0.3)',
            }
          : undefined
      }
    >
      <div className="flex items-center gap-1">
        {home && <HomeRowIcon className="h-2 w-2 shrink-0" style={{ color: 'var(--iv-accent)' }} />}
        <Ln w="52%" h={4} c="var(--iv-line-2)" />
      </div>
      <Ln w="88%" />
      <Ln w="64%" />
      <div className="mt-auto pt-0.5">
        <DeskStatus run={run} />
      </div>
    </Region>
  );
}

/* ── chat · step 1: the agent's two roles, side by side ────────────────── */

/** Split scene: the Chief of Staff (coordination) vs a workspace's Analyst
    (subagents → deliverable), both at work at once. The Chief of Staff's
    steps land quickly, one after another, then a quick answer; the Analyst's
    subagents grind through their tools for longer and end in a file. */
const MODES = {
  rows: [300, 1100],
  rowRun: 700,
  quick: 2300,
  // the Analyst's subagents start as the hand-off goes out
  cards: [1250, 1500],
  cardsDone: [3900, 4300],
  file: 4700,
  length: 5500,
};

function TwoModes() {
  const names = useAgentNames();
  const [row1, row2] = MODES.rows;
  const [card1, card2] = MODES.cards;
  const [card1Done, card2Done] = MODES.cardsDone;
  return (
    <Frame topbar={<Ln w="26%" />}>
      <div className="flex flex-1 gap-2">
        {/* Chief of Staff half: coordinating the desk, with quick answers on the side */}
        <Region hot delay={0.12} className="flex flex-1 flex-col gap-1.5 p-2">
          <div className="flex items-center gap-1.5" style={{ color: 'var(--iv-accent)' }}>
            <HomeRowIcon className="h-2.5 w-2.5" />
            <span className="font-mono text-[0.5rem]">{names.home}</span>
          </div>
          <OrchRow
            icon={<Folder className="h-2 w-2 shrink-0" style={{ color: 'var(--iv-accent)' }} />}
            label="workspace created"
            at={row1}
            done={row1 + MODES.rowRun}
          />
          <OrchRow
            icon={<ChevronRight className="h-2 w-2 shrink-0" style={{ color: 'var(--iv-accent)' }} />}
            label={names.handoff}
            at={row2}
            done={row2 + MODES.rowRun}
          />
          <div className="grid grid-cols-2 gap-1.5 pt-0.5">
            <StreamLn w="90%" at={MODES.quick} h={2} c="var(--iv-line-3)" />
            <StreamLn w="74%" at={MODES.quick + 160} h={2} c="var(--iv-line-3)" />
          </div>
          <span className="mt-auto font-mono text-[0.4375rem]" style={{ color: 'var(--iv-text-3)' }}>
            coordination · quick answers
          </span>
        </Region>
        {/* Analyst half: subagents fanning out toward a deliverable. Plain
            region + teal tag, since the blue accent belongs to the Chief of Staff
            in this comparison */}
        <Region delay={0.28} className="flex flex-1 flex-col gap-1.5 p-2">
          <div className="flex items-center">
            <Tag color="var(--iv-teal)">{names.worker}</Tag>
          </div>
          <SubagentCard
            name="data-prep"
            tools={23}
            at={card1}
            done={card1Done}
            tone="var(--iv-teal)"
          />
          <SubagentCard
            name="valuation"
            tools={17}
            at={card2}
            done={card2Done}
            tone="var(--iv-teal)"
          />
          <Appear at={MODES.file} pop className="flex items-center gap-1">
            <FileText className="h-2 w-2 shrink-0" style={{ color: 'var(--iv-teal)' }} />
            <StreamLn w="48%" at={MODES.file + 120} h={2} c="var(--iv-line-3)" />
          </Appear>
          <span className="mt-auto font-mono text-[0.4375rem]" style={{ color: 'var(--iv-text-3)' }}>
            deep analysis &amp; deliverables
          </span>
        </Region>
      </div>
      <div className="mt-2.5 flex items-center gap-1.5 font-mono text-[0.5rem]" style={{ color: 'var(--iv-text-3)' }}>
        <span className="intro-pulse" style={{ width: 5, height: 5 }} />
        {names.footer}
      </div>
    </Frame>
  );
}

/* ── chat · step 4: the workspace gallery page ─────────────────────────── */

/** The gallery, kept calm: the desks come in, then agents at work in two of
    them, so it reads as desks that keep running, not folders. */
const GRID = {
  cards: [150, 270, 390, 510],
  runs: [
    [1300, 3300],
    [2000, 4200],
  ] as [number, number][],
  length: 4800,
};

function WorkspaceGrid() {
  const [home, desk1, desk2, desk3] = GRID.cards;
  const [run1, run2] = GRID.runs;
  return (
    <Frame topbar={<Ln w="20%" />}>
      <div className="flex flex-1 flex-col gap-2">
        {/* page title + new-workspace button */}
        <div className="intro-rv flex items-center justify-between" style={rv(0.08)}>
          <Ln w="22%" h={5} c="var(--iv-line-2)" />
          <span
            className="flex items-center gap-1 rounded px-1.5 py-1"
            style={{ background: 'var(--iv-accent-deep)' }}
          >
            <Plus className="h-2 w-2 text-white" />
            <Ln w="30px" h={3} c="rgba(255,255,255,0.8)" />
          </span>
        </div>
        {/* search */}
        <Region delay={0.16} className="flex items-center gap-1.5 p-1.5">
          <Search className="h-2 w-2 shrink-0" style={{ color: 'var(--iv-text-3)' }} />
          <Ln w="30%" c="var(--iv-line-3)" />
        </Region>
        {/* no hot card here — the step is about the gallery as a whole, and a
            highlighted card would read as a second All workspaces card */}
        <div className="grid flex-1 auto-rows-fr grid-cols-2 gap-2">
          <Appear at={home} reserve className="flex">
            <WsCard home className="flex-1" />
          </Appear>
          <Appear at={desk1} reserve className="flex">
            <WsCard run={run1} className="flex-1" />
          </Appear>
          <Appear at={desk2} reserve className="flex">
            <WsCard className="flex-1" />
          </Appear>
          <Appear at={desk3} reserve className="flex">
            <WsCard run={run2} className="flex-1" />
          </Appear>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-1.5 font-mono text-[0.5rem]" style={{ color: 'var(--iv-text-3)' }}>
        <span className="intro-pulse" style={{ width: 5, height: 5 }} />
        one desk per company, sector, or strategy
      </div>
    </Frame>
  );
}

/* ── chat · step 2: a Chief of Staff chat page ─────────────────────────── */

/** Compact live-quote card, echoing the real quote tool-result card. */
function QuoteCard({
  ticker,
  price,
  change,
  up,
}: {
  ticker: string;
  price: string;
  change: string;
  up: boolean;
}) {
  return (
    <Region className="flex flex-col gap-1 p-1.5">
      <div className="flex items-center gap-1">
        <span className="font-mono text-[0.5rem] leading-none" style={{ color: 'var(--iv-text)' }}>
          {ticker}
        </span>
        <Ln w="26%" h={2} c="var(--iv-line-3)" />
      </div>
      <div className="flex items-baseline gap-1">
        <span
          className="font-mono text-[0.5625rem] font-semibold leading-none"
          style={{ color: 'var(--iv-text)' }}
        >
          {price}
        </span>
        <span
          className="font-mono text-[0.4375rem] leading-none"
          style={{ color: up ? 'var(--iv-teal)' : 'var(--iv-red)' }}
        >
          {change}
        </span>
      </div>
      {/* open / range / volume stat grid stays skeleton */}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 pt-0.5">
        <Ln w="80%" h={2} c="var(--iv-line-3)" />
        <Ln w="64%" h={2} c="var(--iv-line-3)" />
        <Ln w="56%" h={2} c="var(--iv-line-3)" />
        <Ln w="72%" h={2} c="var(--iv-line-3)" />
      </div>
    </Region>
  );
}

/** One line of the Chief of Staff's orchestration run: icon · action ·
    spinner, then ✓. Shows up at `at`, finishes at `done`. */
function OrchRow({
  icon,
  label,
  at,
  done,
}: {
  icon: ReactNode;
  label: string;
  at: number;
  done: number;
}) {
  return (
    <Appear at={at} className="flex items-center gap-1.5">
      {icon}
      <span className="font-mono text-[0.5rem] leading-none" style={{ color: 'var(--iv-text-2)' }}>
        {label}
      </span>
      <span className="ml-auto flex">
        <Working at={at} done={done} />
      </span>
    </Appear>
  );
}

/** A turn's header: the agent, then what it is doing. `busy` shimmers the
    status the way the app marks work in progress; otherwise it reads plain. */
function TurnHeader({ status, busy }: { status: string; busy: boolean }) {
  const names = useAgentNames();
  return (
    <div className="flex items-center gap-1.5" style={{ color: 'var(--iv-accent)' }}>
      <HomeRowIcon className="h-2.5 w-2.5" />
      <span className="font-mono text-[0.5rem]">{names.homeRun} ·</span>
      <span className={cn('-ml-0.5 font-mono text-[0.5rem]', busy && 'intro-shimmer')}>
        {status}
      </span>
    </div>
  );
}

/** The Chief of Staff's turn, played out: a request typed and sent, the
    agent orchestrating it step by step (workspace, hand-off to the Analyst,
    an automation), then a quick price check answered in under a second, so
    fast QA reads as part of the job, not the whole job. */
const COS = {
  ask: 'Set up a deep dive on NVDA earnings',
  typeAsk: 400,
  sendAsk: 1750,
  think: 2000,
  rows: [2550, 3250, 3950],
  rowRun: 600,
  quick: 'NVDA price?',
  typeQuick: 4950,
  sendQuick: 5550,
  answer: 5800,
  cards: 6300,
  length: 7000,
};

function ChiefOfStaffAnswer() {
  const names = useAgentNames();
  const t = useSceneTime();
  const [row1, row2, row3] = COS.rows;
  const orchestrated = row3 + COS.rowRun;
  const composer =
    t >= COS.typeAsk && t < COS.sendAsk ? (
      <Typed text={COS.ask} at={COS.typeAsk} />
    ) : t >= COS.typeQuick && t < COS.sendQuick ? (
      <Typed text={COS.quick} at={COS.typeQuick} />
    ) : undefined;
  return (
    <Frame topbar={<><Ln w="22%" /><Tag>{names.home}</Tag></>}>
      <div className="flex flex-1 flex-col gap-2">
        <UserBubble at={COS.sendAsk + 80} className="mr-24">{COS.ask}</UserBubble>
        <Appear at={COS.think}>
          <Region hot className="flex flex-col gap-1.5 p-2">
            <TurnHeader
              status={t < row1 ? 'thinking' : 'orchestrating'}
              busy={t < orchestrated}
            />
            <OrchRow
              icon={<Folder className="h-2 w-2 shrink-0" style={{ color: 'var(--iv-accent)' }} />}
              label="workspace created · NVDA deep dive"
              at={row1}
              done={row1 + COS.rowRun}
            />
            <OrchRow
              icon={<ChevronRight className="h-2 w-2 shrink-0" style={{ color: 'var(--iv-accent)' }} />}
              label={names.taskHandoff}
              at={row2}
              done={row2 + COS.rowRun}
            />
            <OrchRow
              icon={<Clock className="h-2 w-2 shrink-0" style={{ color: 'var(--iv-accent)' }} />}
              label="automation · daily earnings brief"
              at={row3}
              done={orchestrated}
            />
          </Region>
        </Appear>
        {/* quick QA rides along below */}
        <UserBubble at={COS.sendQuick + 80} className="mr-24">{COS.quick}</UserBubble>
        <Appear at={COS.answer}>
          <Region className="flex flex-col gap-1.5 p-2">
            <TurnHeader status={t < COS.cards ? 'fetching quote' : '0.9s'} busy={t < COS.cards} />
            <div className="grid grid-cols-2 gap-1.5">
              <Appear at={COS.cards} pop>
                <QuoteCard ticker="NVDA" price="$142.10" change="+1.8%" up />
              </Appear>
              <Appear at={COS.cards + 140} pop>
                <QuoteCard ticker="AVGO" price="$310.51" change="-0.4%" up={false} />
              </Appear>
            </div>
          </Region>
        </Appear>
        <InputDock text={composer} sendAt={[COS.sendAsk, COS.sendQuick]} />
      </div>
    </Frame>
  );
}

/* ── chat · step 3: an Analyst thread page running code ────────────────── */

/** A subagent task card, echoing the real run cards (name · status · n
    tools). Shows up at `at` running, its tool count ticking up to `tools`,
    and lands on ✓ completed at `done`. `tone` colors the spinner. */
function SubagentCard({
  name,
  tools,
  at,
  done,
  tone,
}: {
  name: string;
  tools: number;
  at: number;
  done: number;
  tone?: string;
}) {
  const t = useSceneTime();
  const used = Math.floor(tools * progress(t, at, done - at));
  return (
    <Appear at={at}>
      <Region className="flex flex-col gap-1 p-1.5">
        <div className="flex items-center">
          <span
            className="font-mono text-[0.5rem] leading-none"
            style={{ color: 'var(--iv-text-2)' }}
          >
            {name}
          </span>
          <span className="ml-auto flex">
            {t < done ? (
              <Running label="running" color={tone} />
            ) : (
              <span
                className="intro-pop font-mono text-[0.4375rem] leading-none"
                style={{ ...rv(0), color: 'var(--iv-teal)' }}
              >
                ✓ completed
              </span>
            )}
          </span>
        </div>
        {/* the task line, held at its height while it streams in */}
        <div className="h-0.5">
          <StreamLn w="72%" at={at + 120} h={2} c="var(--iv-line-3)" />
        </div>
        <span
          className="font-mono text-[0.4375rem] leading-none"
          style={{ color: 'var(--iv-text-3)' }}
        >
          {used} {used === 1 ? 'tool' : 'tools'}
        </span>
      </Region>
    </Appear>
  );
}

/** One bar of an inline chart, growing from the baseline from `at`. */
function GrowBar({ h, at, color }: { h: number; at: number; color: string }) {
  const p = useTween(at, 600);
  return (
    <span
      className="flex-1 rounded-t-sm"
      style={{ height: `${h * p}%`, background: color, transition: 'height 90ms linear' }}
    />
  );
}

/** A deliverable chip: file name and a ✓. */
function FileChip({ name }: { name: string }) {
  return (
    <Region className="flex items-center gap-1 px-1.5 py-1">
      <FileText className="h-2 w-2 shrink-0" style={{ color: 'var(--iv-text-3)' }} />
      <span className="font-mono text-[0.4375rem] leading-none" style={{ color: 'var(--iv-text-2)' }}>
        {name}
      </span>
      <Tag color="var(--iv-teal)">✓</Tag>
    </Region>
  );
}

/** The Analyst mid-run, played out: two subagents in parallel, their tool
    counts ticking, while the file panel shows comps.xlsx being written row
    by row; then the narration, the inline chart growing, and the
    deliverables landing. */
const PTC = {
  cards: [200, 450],
  cardsDone: [2600, 3600],
  panel: 500,
  sheet: 1000,
  rowEvery: 330,
  written: 3400,
  say: 3700,
  chart: 4100,
  bars: 4250,
  chips: [5100, 5250],
  length: 6000,
};

/** One spreadsheet cell, its value written in at `at`. */
function SheetCell({ head, w, at }: { head: boolean; w: string; at: number }) {
  return (
    <span
      className="flex items-center px-1"
      style={{ background: head ? 'var(--iv-fill)' : 'var(--iv-mk-bg)' }}
    >
      <StreamLn w={w} at={at} dur={180} h={2} c="var(--iv-line-3)" />
    </span>
  );
}

/** No user bubble here — the scene is the agent mid-run: parallel subagents,
    an inline chart, deliverables, and the file panel previewing the Excel
    they produced (the panel bleeds off the cropped right edge). */
function PtcSandbox() {
  const bars = [38, 56, 46, 86, 60, 70];
  const accent = 3;
  const { worker } = useAgentNames();
  const [card1, card2] = PTC.cards;
  const [card1Done, card2Done] = PTC.cardsDone;
  return (
    <Frame topbar={<><Ln w="22%" /><Tag>{worker}</Tag></>}>
      <div className="flex flex-1 gap-2">
        {/* chat column */}
        <div className="flex min-w-0 flex-[1.5] flex-col gap-2">
          {/* parallel subagents */}
          <SubagentCard name="data-prep" tools={23} at={card1} done={card1Done} />
          <SubagentCard name="report-builder" tools={10} at={card2} done={card2Done} />
          {/* narration, blurred */}
          <StreamLn w="58%" at={PTC.say} dur={500} />
          {/* inline visualization in the reply */}
          <Appear at={PTC.chart}>
            <Region hot className="flex flex-col gap-1 p-2">
              <Ln w="34%" h={2} c="var(--iv-line-3)" />
              <div className="mt-0.5 flex h-9 items-end gap-1">
                {bars.map((h, i) => (
                  <GrowBar
                    key={i}
                    h={h}
                    at={PTC.bars + i * 70}
                    color={i === accent ? 'var(--iv-teal)' : 'hsl(var(--primary) / 0.7)'}
                  />
                ))}
              </div>
            </Region>
          </Appear>
          {/* the deliverables */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Appear at={PTC.chips[0]} pop>
              <FileChip name="comps.xlsx" />
            </Appear>
            <Appear at={PTC.chips[1]} pop>
              <FileChip name="report.pdf" />
            </Appear>
          </div>
          <InputDock delay={0.6} />
        </div>
        {/* file panel previewing the Excel deliverable, written as it runs */}
        <Appear at={PTC.panel} reserve className="flex flex-1">
          <Region className="flex flex-1 flex-col gap-1.5 p-1.5">
            <div className="flex items-center gap-1">
              <FileText className="h-2 w-2 shrink-0" style={{ color: 'var(--iv-text-3)' }} />
              <span
                className="font-mono text-[0.4375rem] leading-none"
                style={{ color: 'var(--iv-text-2)' }}
              >
                comps.xlsx
              </span>
              <span className="ml-auto flex">
                <Working at={PTC.panel} done={PTC.written} />
              </span>
            </div>
            {/* sheet tabs */}
            <div className="flex gap-1">
              <Tag>AI Semi Comps</Tag>
              <Tag color="var(--iv-text-3)">Mega-Cap</Tag>
            </div>
            {/* spreadsheet grid: hairline-divided cells, filled a row at a time */}
            <div
              className="grid flex-1 auto-rows-fr grid-cols-3 gap-px overflow-hidden rounded border"
              style={{ background: 'var(--iv-border)', borderColor: 'var(--iv-border)' }}
            >
              {Array.from({ length: 21 }, (_, i) => (
                <SheetCell
                  key={i}
                  head={i < 3}
                  w={i < 3 ? '80%' : `${[64, 40, 52][i % 3]}%`}
                  at={PTC.sheet + Math.floor(i / 3) * PTC.rowEvery + (i % 3) * 70}
                />
              ))}
            </div>
          </Region>
        </Appear>
      </div>
    </Frame>
  );
}

/* ── chat · step 5: the new-workspace modal over the gallery ───────────── */

/** Creating a workspace, played out: the pointer clicks + New, the modal
    opens, the name and description type in, a click on the drop zone
    uploads two files, and the pointer clicks create. Pointer positions are
    px in the 400px scene, matched to the fixed-size mockup below. */
const NEW_WS = {
  name: 'NVDA earnings deep-dive',
  desc: 'Q1 print vs. guidance, data-center demand…',
  clickNew: 1000,
  modal: 1150,
  typeName: 1550,
  clickDesc: 2650,
  typeDesc: 2800,
  clickDrop: 4500,
  files: [4650, 4850],
  upload: 700,
  clickCreate: 6100,
  length: 6800,
};

/** + New, then the description's free space past its text, the drop
    zone, and create. */
const NEW_WS_PATH = [
  { at: 200, x: 232, y: 236 },
  { at: 950, x: 298, y: 47 },
  { at: 1800, x: 298, y: 47 },
  { at: 2600, x: 300, y: 152 },
  { at: 4000, x: 300, y: 152 },
  { at: 4450, x: 236, y: 196 },
  { at: 5500, x: 236, y: 196 },
  { at: 6050, x: 324, y: 259 },
];

/** A field's text typed in place: an invisible copy of the finished text
    holds the line's size, so nothing around it moves while it types. A
    focused field that has not started typing shows the caret. */
function TypedInPlace({ text, at, focus }: { text: string; at: number; focus: boolean }) {
  const t = useSceneTime();
  return (
    <span className="grid">
      <span className="invisible [grid-area:1/1]">{text}</span>
      <span className="[grid-area:1/1]">
        <Typed text={text} at={at} />
        {focus && t < at && <Caret />}
      </span>
    </span>
  );
}

/** A file queued for the new workspace: its upload bar fills from `at`,
    then it reads ready. Its space is held so the modal does not grow. */
function UploadRow({ w, at }: { w: string; at: number }) {
  const t = useSceneTime();
  const p = progress(t, at, NEW_WS.upload);
  return (
    <Appear at={at} reserve className="flex items-center gap-1.5">
      <FileText className="h-2 w-2 shrink-0" style={{ color: 'var(--iv-text-3)' }} />
      <Ln w={w} c="var(--iv-line-2)" />
      <span className="ml-auto flex h-3 items-center">
        {p < 1 ? (
          <span
            className="block h-0.5 w-8 overflow-hidden rounded-full"
            style={{ background: 'var(--iv-line-3)' }}
          >
            <span
              className="block h-full rounded-full"
              style={{
                width: `${p * 100}%`,
                background: 'var(--iv-teal)',
                transition: 'width 90ms linear',
              }}
            />
          </span>
        ) : (
          <Appear at={at + NEW_WS.upload} pop>
            <Tag color="var(--iv-teal)">ready</Tag>
          </Appear>
        )}
      </span>
    </Appear>
  );
}

function CreateWorkspace() {
  const t = useSceneTime();
  const open = t >= NEW_WS.modal;
  const press = (at: number) => (during(t, at, at + 160) ? 'scale(0.92)' : undefined);
  const nameFocus = during(t, NEW_WS.modal, NEW_WS.clickDesc);
  const descFocus = during(t, NEW_WS.clickDesc, NEW_WS.clickDrop);
  const overDrop = during(t, NEW_WS_PATH[5].at, NEW_WS_PATH[6].at);
  return (
    <div className="relative w-full max-w-[400px]">
      {/* this scene is center-anchored: the gallery fades into the panel at
          both edges instead of hard-cropping on one side, and dims behind
          the modal once it opens */}
      <div
        style={{
          opacity: open ? 0.45 : 1,
          transition: 'opacity 300ms ease',
          WebkitMaskImage:
            'linear-gradient(90deg, transparent 0, black 18%, black 82%, transparent 100%)',
          maskImage:
            'linear-gradient(90deg, transparent 0, black 18%, black 82%, transparent 100%)',
        }}
      >
        <Frame>
          <div className="flex flex-col gap-2">
            {/* the new-workspace button the pointer clicks */}
            <div className="flex items-center">
              <Ln w="22%" h={5} c="var(--iv-line-2)" />
              <span
                className={
                  'ml-auto mr-16 flex items-center gap-1 rounded px-1.5 py-1 ' +
                  'transition-transform duration-150'
                }
                style={{ background: 'var(--iv-accent-deep)', transform: press(NEW_WS.clickNew) }}
              >
                <Plus className="h-2 w-2 text-white" />
                <Ln w="30px" h={3} c="rgba(255,255,255,0.8)" />
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <WsCard home delay={0} />
              <WsCard delay={0} />
              <WsCard delay={0} />
              <WsCard delay={0} />
            </div>
          </div>
        </Frame>
      </div>
      {/* the modal the click opens: name, description, drop-zone, create.
          Centering transform lives on a static wrapper — the pop animates
          `transform` and would clobber translate utilities on itself. */}
      <div className="absolute left-1/2 top-1/2 w-[72%] -translate-x-1/2 -translate-y-1/2">
        <Appear at={NEW_WS.modal} pop className="intro-mk intro-mk--accent p-2.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[0.5625rem]">New workspace</span>
            <X className="h-2.5 w-2.5" style={{ color: 'var(--iv-text-3)' }} />
          </div>
          <div className="mt-2 flex flex-col gap-1.5">
            {/* name field, focused when the modal opens */}
            <span className="font-mono text-[0.5rem]" style={{ color: 'var(--iv-text-3)' }}>
              name
            </span>
            <Region
              className="flex items-center px-1.5 py-1"
              style={{
                borderRadius: 5,
                ...(nameFocus ? { borderColor: 'hsl(var(--primary) / 0.6)' } : null),
              }}
            >
              <span className="font-mono text-[0.5rem] leading-none" style={{ color: 'var(--iv-text)' }}>
                <TypedInPlace text={NEW_WS.name} at={NEW_WS.typeName} focus={nameFocus} />
              </span>
            </Region>
            {/* description */}
            <span className="font-mono text-[0.5rem]" style={{ color: 'var(--iv-text-3)' }}>
              description
            </span>
            <span className="font-mono text-[0.5rem]" style={{ color: 'var(--iv-text-2)' }}>
              <TypedInPlace text={NEW_WS.desc} at={NEW_WS.typeDesc} focus={descFocus} />
            </span>
            {/* files queued for the new workspace */}
            <span className="font-mono text-[0.5rem]" style={{ color: 'var(--iv-text-3)' }}>
              files
            </span>
            <Region
              dashed
              className="flex items-center justify-center gap-1.5 p-1.5"
              style={overDrop ? { borderColor: 'hsl(var(--primary) / 0.6)' } : undefined}
            >
              <Upload className="h-2.5 w-2.5" style={{ color: 'var(--iv-text-3)' }} />
              <Ln w="38%" />
            </Region>
            <UploadRow w="34%" at={NEW_WS.files[0]} />
            <UploadRow w="26%" at={NEW_WS.files[1]} />
            <div className="flex items-center justify-end gap-2">
              <span className="font-mono text-[0.5rem]" style={{ color: 'var(--iv-text-3)' }}>
                cancel
              </span>
              <span
                className="flex items-center px-2 py-1 transition-transform duration-150"
                style={{
                  background: 'var(--iv-accent-deep)',
                  borderRadius: 5,
                  transform: press(NEW_WS.clickCreate),
                }}
              >
                <span className="font-mono text-[0.5rem] leading-none text-white">create</span>
              </span>
            </div>
          </div>
        </Appear>
      </div>
      <Cursor
        path={NEW_WS_PATH}
        clicks={[NEW_WS.clickNew, NEW_WS.clickDesc, NEW_WS.clickDrop, NEW_WS.clickCreate]}
      />
    </div>
  );
}

export const chatScenes = {
  // centered: symmetric comparison, fades its own edges
  twoModes: { Scene: TwoModes, length: MODES.length, anchor: 'center' },
  chiefOfStaffAnswer: { Scene: ChiefOfStaffAnswer, length: COS.length, anchor: 'left' },
  ptcSandbox: { Scene: PtcSandbox, length: PTC.length, anchor: 'left' },
  workspaceGrid: { Scene: WorkspaceGrid, length: GRID.length, anchor: 'left' },
  // centered: the scene fades its own edges instead of bleeding one side
  createWorkspace: { Scene: CreateWorkspace, length: NEW_WS.length, anchor: 'center' },
} satisfies Partial<Record<IntroVisualId, IntroScene>>;
