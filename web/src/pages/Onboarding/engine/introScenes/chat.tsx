import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, ChevronRight, FileSpreadsheet, FileText, Folder, X, Zap } from 'lucide-react';
import { HomeRowIcon } from '@/hooks/useHomeWorkspace';
import { cn } from '@/lib/utils';
import { useAgentNames } from '../introAgents';
import type { IntroVisualId } from '../../registry';
import { useSceneTime, useTween } from './clock';
import { Appear, Frame, InputDock, Ln, Region, StreamLn, Tag, Typed, UserBubble } from './kit';
import type { IntroScene } from './types';
import {
  type Icon,
  toolCard,
  Pill,
  ActivityRow,
  WorkspaceLine,
  HandoffCard,
  SubagentCard,
  FileCard,
} from './chatParts';

/* Scenes for the chat intro: the two agents, the Chief of Staff's turn, and
   the Analyst's run. Each part is a small copy of the component the app
   draws it with (named on each), in the same tokens and labels. */
/* eslint-disable react-refresh/only-export-components -- scene module:
   private scene components, one record export */

/* ── chat · step 1: the agent's two roles, side by side ────────────────── */

/** A pane's heading, as the sidebar names a desk: its glyph, then its name. */
function PaneHeader({ icon: Glyph, name }: { icon: Icon; name: string }) {
  return (
    <div className="flex items-center gap-1">
      <Glyph className="h-2.5 w-2.5 shrink-0" style={{ color: 'var(--iv-text-3)' }} />
      <span className="text-[0.5rem] font-medium leading-none" style={{ color: 'var(--iv-text)' }}>
        {name}
      </span>
    </div>
  );
}

/** Split scene: the Chief of Staff (coordination) vs a workspace's Analyst
    (subagents → deliverable), both at work at once. The Chief of Staff's
    steps land quickly, one after another, then a quick answer; the Analyst's
    subagents grind through their tools for longer and end in a file, which
    is when the hand-off on the left reads completed. */
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
        <Region delay={0.12} className="flex min-w-0 flex-1 flex-col gap-2 p-2">
          <PaneHeader icon={HomeRowIcon} name={names.home} />
          <WorkspaceLine name="NVDA" at={row1} done={row1 + MODES.rowRun} />
          <HandoffCard
            heading={names.handoff}
            at={row2}
            started={row2 + MODES.rowRun}
            finished={MODES.file}
          />
          <div className="flex flex-col gap-1">
            <StreamLn w="90%" at={MODES.quick} />
            <StreamLn w="62%" at={MODES.quick + 160} />
          </div>
        </Region>
        {/* Analyst half: subagents fanning out toward a deliverable */}
        <Region delay={0.28} className="flex min-w-0 flex-1 flex-col gap-2 p-2">
          <PaneHeader icon={Folder} name={names.worker} />
          <SubagentCard
            name="data-prep"
            task="Clean the filings and estimates"
            tools={23}
            at={card1}
            done={card1Done}
          />
          <SubagentCard
            name="valuation"
            task="Build the DCF and comps"
            tools={17}
            at={card2}
            done={card2Done}
          />
          <Appear at={MODES.file} pop>
            <FileCard name="valuation.xlsx" kind="spreadsheet" icon={FileSpreadsheet} />
          </Appear>
        </Region>
      </div>
    </Frame>
  );
}

/* ── chat · step 2: a Chief of Staff chat page ─────────────────────────── */

/** A live quote for one symbol (`InlineQuoteCard`, its hero layout): symbol
    and name, price and change, the day's low and high either side of the
    range strip with the price marked on it, then open and previous close. */
function QuoteCard() {
  const { t } = useTranslation();
  const label = { color: 'var(--iv-text-3)' };
  const value = { color: 'var(--iv-text-2)', fontWeight: 500 };
  return (
    <div
      className="flex flex-col gap-1.5 rounded-md border px-2 py-1.5 tabular-nums"
      style={toolCard}
    >
      <div className="flex items-baseline gap-1">
        <span className="text-[0.5rem] font-bold leading-none" style={{ color: 'var(--iv-text)' }}>
          NVDA
        </span>
        <Ln w="30%" h={2} c="var(--iv-line-3)" />
      </div>
      <div className="flex items-baseline gap-1.5">
        <span
          className="text-[0.6875rem] font-bold leading-none"
          style={{ color: 'var(--iv-text)' }}
        >
          $142.10
        </span>
        <span
          className="text-[0.4375rem] font-medium leading-none"
          style={{ color: 'var(--color-profit)' }}
        >
          +2.51 (+1.80%)
        </span>
      </div>
      {/* the day's range: low · the price on the strip · high */}
      <div className="flex items-center gap-1 text-[0.375rem] leading-none" style={label}>
        <span>{t('toolArtifact.low')} $139.20</span>
        <span
          className="relative h-0.5 flex-1 rounded-full"
          style={{ background: 'var(--color-border-muted)' }}
        >
          <span
            className="absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: '76%', background: 'var(--color-profit)' }}
          />
        </span>
        <span>{t('toolArtifact.high')} $143.05</span>
      </div>
      <div className="flex gap-2 text-[0.375rem] leading-none" style={label}>
        <span>
          {t('toolArtifact.open')} <b style={value}>$140.02</b>
        </span>
        <span>
          {t('toolArtifact.prevClose')} <b style={value}>$139.59</b>
        </span>
      </div>
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
  card: 6300,
  length: 7000,
};

function ChiefOfStaffAnswer() {
  const { t } = useTranslation();
  const names = useAgentNames();
  const now = useSceneTime();
  const [row1, row2, row3] = COS.rows;
  const orchestrated = row3 + COS.rowRun;
  const composer =
    now >= COS.typeAsk && now < COS.sendAsk ? (
      <Typed text={COS.ask} at={COS.typeAsk} />
    ) : now >= COS.typeQuick && now < COS.sendQuick ? (
      <Typed text={COS.quick} at={COS.typeQuick} />
    ) : undefined;
  return (
    <Frame
      topbar={
        <>
          <Ln w="22%" />
          <Tag>{names.home}</Tag>
        </>
      }
    >
      <div className="flex flex-1 flex-col gap-2">
        <UserBubble at={COS.sendAsk + 80} className="mr-24">
          {COS.ask}
        </UserBubble>
        {/* the turn sits on the page, as the app writes replies: reasoning,
            the workspace, the hand-off card, the automation */}
        {now >= COS.think && (
          <div className="mr-24 flex flex-col gap-1.5">
            <ActivityRow
              icon={Brain}
              verb={t('toolArtifact.thinkingFor', { duration: '1s' })}
              title={t('toolArtifact.thoughtFor', { duration: '1s' })}
              after={
                <ChevronRight
                  className="h-2 w-2 shrink-0"
                  style={{ color: 'var(--color-icon-muted)' }}
                />
              }
              at={COS.think}
              done={row1}
            />
            <WorkspaceLine name="NVDA deep dive" at={row1} done={row1 + COS.rowRun} />
            <HandoffCard heading={names.taskHandoff} at={row2} started={row2 + COS.rowRun} />
            <ActivityRow
              icon={Zap}
              verb={t('toolArtifact.inProgress.creatingName', { name: 'daily earnings brief' })}
              title={t('toolArtifact.tool.createAutomation')}
              after={<Pill>daily earnings brief</Pill>}
              at={row3}
              done={orchestrated}
            />
          </div>
        )}
        {/* quick QA rides along below */}
        <UserBubble at={COS.sendQuick + 80} className="mr-24">
          {COS.quick}
        </UserBubble>
        {now >= COS.answer && (
          <div className="mr-24 flex flex-col gap-1.5">
            <ActivityRow
              icon={Zap}
              verb={t('toolArtifact.inProgress.fetchingQuotes')}
              title={t('toolArtifact.tool.liveQuotes')}
              after={<Pill>NVDA</Pill>}
              at={COS.answer}
              done={COS.card}
            />
            <Appear at={COS.card} pop>
              <QuoteCard />
            </Appear>
          </div>
        )}
        <InputDock text={composer} sendAt={[COS.sendAsk, COS.sendQuick]} />
      </div>
    </Frame>
  );
}

/* ── chat · step 3: an Analyst thread page running code ────────────────── */

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

/** EPS by quarter, estimate then actual, as the earnings chart pairs them. */
const QUARTERS = [
  [40, 46],
  [52, 58],
  [62, 70],
  [74, 86],
];

/** The Analyst mid-run, played out: two subagents in parallel, their tool
    counts ticking, while the file panel shows comps.xlsx being written row
    by row; then the narration, the inline chart growing, and the
    deliverables landing. */
const PTC = {
  cards: [200, 450],
  cardsDone: [2600, 3600],
  panel: 500,
  sheet: 900,
  say: 3700,
  chart: 4100,
  bars: 4250,
  chips: [5100, 5250],
  length: 6000,
};

/** The spreadsheet viewer's paper and ink (`ExcelViewer.css`): a white sheet
    in either theme, every shade on it mixed from the two. */
const SHEET = {
  paper: 'var(--color-sheet-paper)',
  ink: 'var(--color-sheet-ink)',
  rule: 'color-mix(in srgb, var(--color-sheet-ink) 12%, var(--color-sheet-paper))',
  ruleStrong: 'color-mix(in srgb, var(--color-sheet-ink) 22%, var(--color-sheet-paper))',
  chrome: 'color-mix(in srgb, var(--color-sheet-ink) 4%, var(--color-sheet-paper))',
  chromeStrong: 'color-mix(in srgb, var(--color-sheet-ink) 7%, var(--color-sheet-paper))',
  inkMuted: 'color-mix(in srgb, var(--color-sheet-ink) 55%, var(--color-sheet-paper))',
};

/** A cell the workbook holds: a typed value, or a formula with the value it
    caches. */
type SheetValue = string | { f: string; v: string };

/** The comps sheet report-builder writes: nine names, then the peers'
    median and mean and NVDA's premium to the median, computed in the
    sheet (their cached values are the real results of those formulas over
    these rows). Figures are invented. */
const COMPS: (SheetValue | null)[][] = [
  ['Ticker', 'Price', 'Mkt cap', 'EV/S', 'P/E', 'Growth'],
  ['NVDA', '182.42', '4,452', '24.1x', '38.2x', '62%'],
  ['AVGO', '349.80', '1,646', '22.6x', '36.9x', '24%'],
  ['TSM', '292.15', '1,515', '10.4x', '22.8x', '31%'],
  ['AMD', '236.10', '383', '9.8x', '31.5x', '27%'],
  ['ARM', '151.60', '160', '30.2x', '72.4x', '21%'],
  ['QCOM', '168.25', '184', '4.3x', '15.6x', '9%'],
  ['MU', '201.30', '225', '4.2x', '11.9x', '38%'],
  ['MRVL', '88.40', '76', '9.1x', '29.7x', '34%'],
  ['INTC', '37.85', '166', '2.9x', '34.1x', '-2%'],
  [],
  [
    'Median',
    null,
    { f: '=MEDIAN(C2:C10)', v: '225' },
    { f: '=MEDIAN(D2:D10)', v: '9.8x' },
    { f: '=MEDIAN(E2:E10)', v: '31.5x' },
    { f: '=MEDIAN(F2:F10)', v: '27%' },
  ],
  [
    'Mean',
    null,
    { f: '=AVERAGE(C2:C10)', v: '979' },
    { f: '=AVERAGE(D2:D10)', v: '13.1x' },
    { f: '=AVERAGE(E2:E10)', v: '32.6x' },
    { f: '=AVERAGE(F2:F10)', v: '27%' },
  ],
  [],
  ['NVDA vs median', null, null, { f: '=D2/D12-1', v: '146%' }, { f: '=E2/E12-1', v: '21%' }],
];

const SHEET_COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
/** Column widths (px). The empty columns run off the panel's edge, as a
    sheet does. */
const SHEET_COL_W = [20, 24, 23, 20, 20, 21, 24, 24, 24, 24];
/** Rows drawn: the data, then empty rows to the panel's foot. */
const SHEET_ROWS = 26;

/** When each written cell lands: rows a beat apart, each row left to right;
    the computed rows take a little longer, as their formulas do. */
const SHEET_WRITES: { r: number; c: number; at: number }[] = (() => {
  const writes: { r: number; c: number; at: number }[] = [];
  let at = PTC.sheet;
  COMPS.forEach((row, r) => {
    if (row.length === 0) return;
    row.forEach((cell, c) => {
      if (cell != null) writes.push({ r, c, at: at + c * 30 });
    });
    at += typeof row[2] === 'object' && row[2] !== null ? 230 : 170;
  });
  return writes;
})();

/** A row or column heading in the sheet's margin; `active` = it holds the
    focused cell. */
function SheetHeading({ active = false, children }: { active?: boolean; children?: ReactNode }) {
  return (
    <span
      className="flex items-center justify-center font-mono text-[0.25rem] leading-none"
      style={{
        background: active ? SHEET.chromeStrong : SHEET.chrome,
        color: active ? SHEET.ink : SHEET.inkMuted,
      }}
    >
      {children}
    </span>
  );
}

/** One cell as the grid prints it: text in the content font from the left,
    numbers in mono from the right, a formula's value with its dotted rule,
    the focused cell outlined in ink. Text runs on into an empty neighbour. */
function SheetCell({
  value,
  r,
  c,
  focus,
}: {
  value: SheetValue | null;
  r: number;
  c: number;
  focus: boolean;
}) {
  const text = typeof value === 'string' && (c === 0 || r === 0);
  const formula = value != null && typeof value === 'object';
  const strong = r === 0 || (c === 0 && r > 10);
  return (
    <span
      className={cn(
        'relative flex items-center whitespace-nowrap px-[2px] text-[0.3125rem] leading-none',
        text && c === 0 ? 'justify-start' : 'justify-end',
        text && c === 0 && 'z-[1]'
      )}
      style={{
        background: SHEET.paper,
        color: SHEET.ink,
        fontFamily: text ? 'var(--font-content)' : 'var(--font-mono)',
        fontWeight: strong ? 600 : 400,
        boxShadow: focus
          ? `inset 0 0 0 1px ${SHEET.ink}`
          : r === 0
            ? `inset 0 -1px 0 ${SHEET.ruleStrong}`
            : undefined,
      }}
    >
      {value != null && (
        <span
          style={
            formula
              ? {
                  textDecoration: `underline dotted ${SHEET.inkMuted}`,
                  textUnderlineOffset: 1,
                }
              : undefined
          }
        >
          {typeof value === 'string' ? value : value.v}
        </span>
      )}
    </span>
  );
}

/** A sheet's tab under the grid. */
function SheetTab({ active = false, children }: { active?: boolean; children: ReactNode }) {
  return (
    <span
      className="rounded-[3px] border px-1 py-0.5 text-[0.375rem] leading-none"
      style={
        active
          ? {
              background: 'var(--color-bg-elevated)',
              borderColor: 'var(--color-border-default)',
              color: 'var(--iv-text)',
            }
          : { borderColor: 'var(--color-border-muted)', color: 'var(--iv-text-3)' }
      }
    >
      {children}
    </span>
  );
}

/** The file panel open on the workbook (`FilePanel`, `ExcelViewer`): the
    file's tab, the formula bar, the sheet, and the sheet tabs. The cells
    fill in as report-builder writes them, the focus following the last
    write, and the formula bar reading the focused cell: its formula and
    cached value, or the value typed there. */
function SheetPanel() {
  const t = useSceneTime();
  const written = SHEET_WRITES.filter((w) => w.at <= t);
  const shown = new Set(written.map((w) => `${w.r}:${w.c}`));
  const focus = written.at(-1);
  const focused = focus ? COMPS[focus.r][focus.c] : null;
  const ref = focus ? `${SHEET_COLS[focus.c]}${focus.r + 1}` : 'A1';
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* tab strip */}
      <div
        className="flex h-[18px] shrink-0 items-center border-b px-1"
        style={{ borderColor: 'var(--color-border-muted)' }}
      >
        <span
          className="flex h-3 min-w-0 items-center gap-0.5 rounded-[3px] border px-1"
          style={{
            background: 'var(--color-bg-elevated)',
            borderColor: 'var(--color-border-muted)',
            color: 'var(--iv-text)',
          }}
        >
          <FileSpreadsheet className="h-2 w-2 shrink-0" />
          <span className="truncate text-[0.4375rem] leading-none">comps.xlsx</span>
        </span>
        <X className="ml-auto h-2 w-2 shrink-0" style={{ color: 'var(--iv-text-3)' }} />
      </div>
      {/* formula bar: the focused cell's reference, formula and cached value */}
      <div
        className="flex h-3 shrink-0 items-stretch border-b font-mono text-[0.3125rem] leading-none"
        style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border-muted)' }}
      >
        <span
          className="flex w-5 items-center border-r px-1 font-medium"
          style={{ borderColor: 'var(--color-border-muted)', color: 'var(--iv-text)' }}
        >
          {ref}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1 px-1">
          <span className="shrink-0 italic" style={{ color: 'var(--iv-text-3)' }}>
            fx
          </span>
          {focused != null && (
            <span className="truncate" style={{ color: 'var(--iv-text-2)' }}>
              {typeof focused === 'string' ? focused : focused.f}
            </span>
          )}
          {focused != null && typeof focused === 'object' && (
            <span className="ml-auto shrink-0 font-medium" style={{ color: 'var(--iv-text)' }}>
              {focused.v}
            </span>
          )}
        </span>
      </div>
      {/* the sheet: lettered columns, numbered rows, hairline rules */}
      <div className="relative min-h-0 flex-1 overflow-hidden" style={{ background: SHEET.rule }}>
        <div
          className="absolute left-0 top-0 grid gap-px"
          style={{
            gridTemplateColumns: `9px ${SHEET_COL_W.map((w) => `${w}px`).join(' ')}`,
            gridTemplateRows: `7px repeat(${SHEET_ROWS}, 9px)`,
          }}
        >
          <span style={{ background: SHEET.chromeStrong }} />
          {SHEET_COLS.map((col, c) => (
            <SheetHeading key={col} active={focus?.c === c}>
              {col}
            </SheetHeading>
          ))}
          {Array.from({ length: SHEET_ROWS }, (_, r) => [
            <SheetHeading key={`n${r}`} active={focus?.r === r}>
              {r + 1}
            </SheetHeading>,
            ...SHEET_COLS.map((col, c) => (
              <SheetCell
                key={`${r}${col}`}
                value={shown.has(`${r}:${c}`) ? (COMPS[r]?.[c] ?? null) : null}
                r={r}
                c={c}
                focus={focus?.r === r && focus.c === c}
              />
            )),
          ])}
        </div>
      </div>
      {/* sheet tabs */}
      <div
        className="flex shrink-0 items-center gap-0.5 border-t px-1 py-1"
        style={{ borderColor: 'var(--color-border-muted)' }}
      >
        <SheetTab active>AI Semi Comps</SheetTab>
        <SheetTab>Mega-Cap</SheetTab>
      </div>
    </div>
  );
}

/** No user bubble here — the scene is the agent mid-run: parallel subagents,
    an inline chart, deliverables, and the file panel previewing the Excel
    they produced, docked at the window's right edge as the app docks it and
    at the share of the window a file preview opens to (wider than the chat). */
function PtcSandbox() {
  const { worker } = useAgentNames();
  const now = useSceneTime();
  const [card1, card2] = PTC.cards;
  const [card1Done, card2Done] = PTC.cardsDone;
  const stacked = now >= PTC.chips[1];
  return (
    <Frame
      topbar={
        <>
          <Ln w="22%" />
          <Tag>{worker}</Tag>
        </>
      }
    >
      <div className="flex flex-1 gap-2.5">
        {/* chat column */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* parallel subagents */}
          <SubagentCard
            name="data-prep"
            task="Pull NTM estimates for 9 AI semis"
            tools={23}
            at={card1}
            done={card1Done}
          />
          <SubagentCard
            name="report-builder"
            task="Write comps.xlsx and the report"
            tools={10}
            at={card2}
            done={card2Done}
          />
          {/* narration, blurred */}
          <StreamLn w="58%" at={PTC.say} dur={500} />
          {/* inline chart in the reply: EPS estimate vs actual by quarter */}
          <Appear at={PTC.chart}>
            <div className="flex flex-col gap-1.5 rounded-md border p-2" style={toolCard}>
              <Ln w="34%" h={3} c="var(--iv-line-2)" />
              <div
                className="flex h-9 items-end gap-2.5 border-b px-1.5"
                style={{ borderColor: 'var(--color-border-default)' }}
              >
                {QUARTERS.map(([estimate, actual], i) => (
                  <div key={i} className="flex h-full flex-1 items-end gap-0.5">
                    <GrowBar h={estimate} at={PTC.bars + i * 100} color="var(--color-icon-muted)" />
                    <GrowBar h={actual} at={PTC.bars + i * 100 + 40} color="var(--color-profit)" />
                  </div>
                ))}
              </div>
            </div>
          </Appear>
          {/* the deliverables, stacked as the app stacks a turn's files */}
          <Appear at={PTC.chips[0]}>
            <div className="relative" style={{ height: stacked ? 27 : 24 }}>
              {stacked && (
                <div
                  className="absolute inset-x-0 top-0"
                  style={{ transform: 'translateY(3px) scale(0.98)' }}
                >
                  <FileCard name="report.pdf" kind="document" icon={FileText} />
                </div>
              )}
              <div className="absolute inset-x-0 top-0">
                <FileCard
                  name="comps.xlsx"
                  kind="spreadsheet"
                  icon={FileSpreadsheet}
                  count={stacked ? 2 : 1}
                />
              </div>
            </div>
          </Appear>
          <InputDock delay={0.6} />
        </div>
        {/* file panel previewing the Excel deliverable, written as it runs */}
        <Appear
          at={PTC.panel}
          reserve
          className="-my-2.5 -mr-2.5 flex min-w-0 flex-[1.3] border-l"
          style={{ background: 'var(--color-bg-page)', borderColor: 'var(--color-border-muted)' }}
        >
          <SheetPanel />
        </Appear>
      </div>
    </Frame>
  );
}

export const chatScenes = {
  // centered: symmetric comparison, fades its own edges
  twoModes: { Scene: TwoModes, length: MODES.length, anchor: 'center' },
  chiefOfStaffAnswer: { Scene: ChiefOfStaffAnswer, length: COS.length, anchor: 'left' },
  ptcSandbox: { Scene: PtcSandbox, length: PTC.length, anchor: 'left' },
} satisfies Partial<Record<IntroVisualId, IntroScene>>;
