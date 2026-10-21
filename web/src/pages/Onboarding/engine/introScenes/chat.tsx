import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Brain,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Folder,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import { HomeRowIcon } from '@/hooks/useHomeWorkspace';
import { cn } from '@/lib/utils';
import { useAgentNames } from '../introAgents';
import type { IntroVisualId } from '../../registry';
import { BarChart, StockPriceCard, type Bar } from './charts';
import { useSceneTime } from './clock';
import { Appear, Frame, InputDock, Region, Tag, Typed, UserBubble } from './kit';
import type { IntroScene } from './types';
import {
  type Icon,
  toolCard,
  Pill,
  Reply,
  ActivityRow,
  WorkspaceLine,
  HandoffCard,
  SubagentCard,
  ChartCard,
  ColumnChart,
  FileCard,
} from './chatParts';

/* Scenes for the chat intro: the two agents, the Chief of Staff's turn, and
   the Analyst's run. Each part is a small copy of the component the app
   draws it with (named on each), in the same tokens and labels. The figures
   are invented, and agree with each other across the scenes. */
/* eslint-disable react-refresh/only-export-components -- scene module:
   private scene components, one record export */

/** The thread page's header: back, then the thread's title. */
function TopTitle({ children }: { children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <ArrowLeft className="h-2.5 w-2.5 shrink-0" style={{ color: 'var(--iv-text-3)' }} />
      <span
        className="truncate text-[0.5rem] font-medium leading-none"
        style={{ color: 'var(--iv-text)' }}
      >
        {children}
      </span>
    </span>
  );
}

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

/** AVGO's closes over six months, for the Chief of Staff's quick answer. */
const AVGO_6M = [
  252.8, 248.1, 241.6, 238.4, 246.9, 255.3, 262.7, 259.1, 268.4, 277.9, 274.2, 283.6, 291.8, 286.5,
  298.3, 309.7, 304.2, 317.5, 326.8, 321.4, 334.9, 356.2, 343.1, 349.8,
];

/** The valuation subagent's DCF: value per share by case, against spot. */
const DCF_CASES: Bar[] = [
  { label: 'Bear', value: 128, shown: '$128' },
  { label: 'Base', value: 171, shown: '$171', mark: true },
  { label: 'Bull', value: 226, shown: '$226' },
];

/** Split scene: the Chief of Staff (coordination) vs a workspace's Analyst
    (subagents → deliverable), both at work at once. The Chief of Staff's
    steps land quickly, one after another, then it answers a quick question
    itself; the Analyst's subagents grind through their tools for longer and
    end in a finding, its chart and a file, which is when the hand-off on the left reads
    completed and the Chief of Staff reports back. */
const MODES = {
  rows: [300, 1100],
  rowRun: 700,
  quick: 'AVGO, last 6 months?',
  ask: 2000,
  fetch: 2250,
  card: 2650,
  // the Analyst's subagents start as the hand-off goes out
  cards: [1250, 1500],
  cardsDone: [3500, 3900],
  say: 3950,
  chart: 4400,
  file: 4800,
  report: 4950,
  length: 5700,
};

function TwoModes() {
  const { t } = useTranslation();
  const names = useAgentNames();
  const [row1, row2] = MODES.rows;
  const [card1, card2] = MODES.cards;
  const [card1Done, card2Done] = MODES.cardsDone;
  return (
    <Frame topbar={<TopTitle>NVDA deep dive</TopTitle>}>
      <div className="flex flex-1 gap-2">
        {/* Chief of Staff half: coordinating the desk, answering quick
            questions itself, reporting back when the work is done */}
        <Region delay={0.12} className="flex min-w-0 flex-1 flex-col gap-2 p-2">
          <PaneHeader icon={HomeRowIcon} name={names.home} />
          <WorkspaceLine name="NVDA deep dive" at={row1} done={row1 + MODES.rowRun} />
          <HandoffCard
            heading={names.handoff}
            brief="Q3 print vs guidance, data-center demand"
            at={row2}
            started={row2 + MODES.rowRun}
            finished={MODES.file}
          />
          <UserBubble at={MODES.ask}>{MODES.quick}</UserBubble>
          <ActivityRow
            icon={TrendingUp}
            verb={t('toolArtifact.inProgress.fetchingSymbolPrices', { symbol: 'AVGO' })}
            title={t('toolArtifact.tool.stockPrices')}
            after={<Pill>AVGO</Pill>}
            at={MODES.fetch}
            done={MODES.card}
          />
          <Appear at={MODES.card} pop>
            <StockPriceCard
              sym="AVGO"
              price="$349.80"
              change={38.38}
              period="2026-04-20, 2026-10-20"
              series={AVGO_6M}
              high="$356.20"
              low="$238.40"
              vol="21.3M"
              at={MODES.card + 100}
            />
          </Appear>
          <Reply
            text="**The Analyst is done:** base case $171 a share, 6% below spot."
            at={MODES.report}
          />
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
          <Reply
            text="**Base case $171 a share,** 6% below spot; only the bull case clears it."
            at={MODES.say}
          />
          <Appear at={MODES.chart}>
            <ChartCard title="DCF value per share" legend="spot $182.42">
              <BarChart
                bars={DCF_CASES}
                max={240}
                median={182.42}
                at={MODES.chart + 120}
                per={90}
                labelWidth={18}
              />
            </ChartCard>
          </Appear>
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
      <div className="flex items-baseline gap-1 leading-none">
        <span className="text-[0.5rem] font-bold" style={{ color: 'var(--iv-text)' }}>
          NVDA
        </span>
        <span className="truncate text-[0.4375rem]" style={label}>
          NVIDIA Corp
        </span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span
          className="text-[0.6875rem] font-bold leading-none"
          style={{ color: 'var(--iv-text)' }}
        >
          $182.42
        </span>
        <span
          className="text-[0.4375rem] font-medium leading-none"
          style={{ color: 'var(--color-profit)' }}
        >
          +2.89 (+1.61%)
        </span>
      </div>
      {/* the day's range: low · the price on the strip · high */}
      <div className="flex items-center gap-1 text-[0.375rem] leading-none" style={label}>
        <span>{t('toolArtifact.low')} $180.15</span>
        <span
          className="relative h-0.5 flex-1 rounded-full"
          style={{ background: 'var(--color-border-muted)' }}
        >
          <span
            className="absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: '78%', background: 'var(--color-profit)' }}
          />
        </span>
        <span>{t('toolArtifact.high')} $183.05</span>
      </div>
      <div className="flex gap-2 text-[0.375rem] leading-none" style={label}>
        <span>
          {t('toolArtifact.open')} <b style={value}>$180.40</b>
        </span>
        <span>
          {t('toolArtifact.prevClose')} <b style={value}>$179.53</b>
        </span>
      </div>
    </div>
  );
}

/** The Chief of Staff's turn, played out: a request typed and sent, the
    agent orchestrating it step by step (workspace, hand-off to the Analyst,
    an automation) and saying so, then a quick price check answered in
    under a second, so fast QA reads as part of the job, not the whole job. */
const COS = {
  ask: 'Set up a deep dive on NVDA earnings',
  typeAsk: 400,
  sendAsk: 1750,
  think: 2000,
  rows: [2550, 3250, 3950],
  rowRun: 600,
  say: 4600,
  quick: 'NVDA price?',
  typeQuick: 5000,
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
          <TopTitle>NVDA earnings</TopTitle>
          <Tag>{names.home}</Tag>
        </>
      }
    >
      <div className="flex flex-1 flex-col gap-1.5">
        <UserBubble at={COS.sendAsk + 80} className="mr-24">
          {COS.ask}
        </UserBubble>
        {/* the turn sits on the page, as the app writes replies: reasoning,
            the workspace, the hand-off card, the automation, a line on it */}
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
            <HandoffCard
              heading={names.taskHandoff}
              brief="Q3 print vs guidance, data-center demand"
              at={row2}
              started={row2 + COS.rowRun}
            />
            <ActivityRow
              icon={Zap}
              verb={t('toolArtifact.inProgress.creatingName', { name: 'daily earnings brief' })}
              title={t('toolArtifact.tool.createAutomation')}
              after={<Pill>daily earnings brief</Pill>}
              at={row3}
              done={orchestrated}
            />
            <Reply text="**On it.** A brief lands each morning at 8:00." at={COS.say} />
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

/** The Analyst mid-run, played out: two subagents in parallel, their tool
    counts ticking, while the file panel shows comps.xlsx being written row
    by row. The finding and the chart behind it come in as soon as data-prep
    returns, while report-builder is still writing; then the deliverables
    land. */
const PTC = {
  cards: [200, 450],
  cardsDone: [2000, 3600],
  panel: 500,
  sheet: 900,
  say: 2150,
  chart: 2600,
  bars: 2700,
  chips: [3800, 3950],
  length: 4800,
};

/** The spreadsheet viewer's paper and ink (`ExcelViewer.css`): a white sheet
    in either theme, every shade of its chrome mixed from the two. */
const SHEET = {
  paper: 'var(--color-sheet-paper)',
  ink: 'var(--color-sheet-ink)',
  rule: 'color-mix(in srgb, var(--color-sheet-ink) 12%, var(--color-sheet-paper))',
  chrome: 'color-mix(in srgb, var(--color-sheet-ink) 4%, var(--color-sheet-paper))',
  chromeStrong: 'color-mix(in srgb, var(--color-sheet-ink) 7%, var(--color-sheet-paper))',
  inkMuted: 'color-mix(in srgb, var(--color-sheet-ink) 55%, var(--color-sheet-paper))',
};

/** The workbook's own styling, as the xlsx skill writes it: section bands,
    column-header fill, and the font colour code (blue typed input, black
    formula, green link to another sheet). The viewer draws a file's fills
    and colours as authored, so these hold in either theme. */
const BOOK = {
  band: '#1F4E79',
  head: '#D9E1F2',
  input: '#0000FF',
  formula: '#000000',
  link: '#008000',
};

/** A cell the workbook holds: a typed value, or a formula with the value it
    caches. */
type SheetValue = string | { f: string; v: string };

/** A row of the sheet: merged across the table (the title, its note, a
    section band), a row of cells, or empty. */
type SheetRow =
  | { kind: 'title' | 'note' | 'band'; text: string }
  | { kind: 'head' | 'data' | 'stat'; cells: (SheetValue | null)[] }
  | { kind: 'blank' };

/** Columns the table spans; a merged row spans them all. */
const TABLE_COLS = 6;

/** One peer: ticker, price and market cap typed in, then its multiples and
    growth linked from the Data sheet (row `n` there). */
function peer(
  ticker: string,
  price: string,
  cap: string,
  evs: string,
  pe: string,
  growth: string,
  n: number
): SheetRow {
  const r = n + 4; // its row on this sheet
  return {
    kind: 'data',
    cells: [
      ticker,
      price,
      cap,
      { f: `=Data!D${n}/Data!E${n}`, v: evs },
      { f: `=B${r}/Data!F${n}`, v: pe },
      { f: `=Data!G${n}`, v: growth },
    ],
  };
}

/** The comps sheet report-builder writes, laid out as the comps skill lays
    one out: title and basis, the valuation band, nine peers, then the
    statistics on the comparable columns only (never price or size), and
    NVDA against the median. The statistics' cached values are the real
    results of their formulas over these rows (QUARTILE is inclusive). */
const COMPS: SheetRow[] = [
  { kind: 'title', text: 'AI semis: comparable company analysis' },
  { kind: 'note', text: 'Prices as of 2026-10-20 · USD bn · NTM estimates' },
  { kind: 'blank' },
  { kind: 'band', text: 'VALUATION' },
  { kind: 'head', cells: ['Ticker', 'Price', 'Mkt cap', 'EV/S', 'P/E', 'Growth'] },
  peer('NVDA', '182.42', '4,452', '24.1x', '38.2x', '62%', 2),
  peer('AVGO', '349.80', '1,646', '22.6x', '36.9x', '24%', 3),
  peer('TSM', '292.15', '1,515', '10.4x', '22.8x', '31%', 4),
  peer('AMD', '236.10', '383', '9.8x', '31.5x', '27%', 5),
  peer('ARM', '151.60', '160', '30.2x', '72.4x', '21%', 6),
  peer('QCOM', '168.25', '184', '4.3x', '15.6x', '9%', 7),
  peer('MU', '201.30', '225', '4.2x', '11.9x', '38%', 8),
  peer('MRVL', '88.40', '76', '9.1x', '29.7x', '34%', 9),
  peer('INTC', '37.85', '166', '2.9x', '34.1x', '-2%', 10),
  { kind: 'blank' },
  {
    kind: 'stat',
    cells: [
      '75th pctl',
      null,
      null,
      { f: '=QUARTILE(D6:D14,3)', v: '22.6x' },
      { f: '=QUARTILE(E6:E14,3)', v: '36.9x' },
      { f: '=QUARTILE(F6:F14,3)', v: '34%' },
    ],
  },
  {
    kind: 'stat',
    cells: [
      'Median',
      null,
      null,
      { f: '=MEDIAN(D6:D14)', v: '9.8x' },
      { f: '=MEDIAN(E6:E14)', v: '31.5x' },
      { f: '=MEDIAN(F6:F14)', v: '27%' },
    ],
  },
  {
    kind: 'stat',
    cells: [
      '25th pctl',
      null,
      null,
      { f: '=QUARTILE(D6:D14,1)', v: '4.3x' },
      { f: '=QUARTILE(E6:E14,1)', v: '22.8x' },
      { f: '=QUARTILE(F6:F14,1)', v: '21%' },
    ],
  },
  { kind: 'blank' },
  {
    kind: 'stat',
    cells: [
      'NVDA vs median',
      null,
      null,
      { f: '=D6/D17-1', v: '146%' },
      { f: '=E6/E17-1', v: '21%' },
      { f: '=F6-F17', v: '35%' },
    ],
  },
];

/** The chart in the reply, from the same rows: EV/Sales, high to low. */
const EV_SALES: Bar[] = COMPS.flatMap((row) => {
  if (row.kind !== 'data') return [];
  const [ticker, , , evs] = row.cells as [string, string, string, { v: string }];
  return [{ label: ticker, value: parseFloat(evs.v), shown: evs.v, mark: ticker === 'NVDA' }];
}).sort((a, b) => b.value - a.value);

const SHEET_COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
/** Column widths (px): labels wide in A, as the skill sets it; the empty
    columns run off the panel's edge, as a sheet does. */
const SHEET_COL_W = [49, 23, 24, 19, 19, 22, 24, 24, 24, 24];
/** Rows drawn: the table, then empty rows to the panel's foot. */
const SHEET_ROWS = 26;

/** When each written cell lands: rows a beat apart, each row left to right;
    the computed rows take a little longer, as their formulas do. */
const SHEET_WRITES: { r: number; c: number; at: number }[] = (() => {
  const writes: { r: number; c: number; at: number }[] = [];
  let at = PTC.sheet;
  COMPS.forEach((row, r) => {
    if (row.kind === 'blank') return;
    if (!('cells' in row)) {
      writes.push({ r, c: 0, at });
      at += 120;
      return;
    }
    row.cells.forEach((cell, c) => {
      if (cell != null) writes.push({ r, c, at: at + c * 30 });
    });
    at += row.kind === 'stat' ? 200 : 150;
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

/** The focused cell's outline, in ink as the viewer draws it. */
const focusRing = (on: boolean): CSSProperties =>
  on ? { boxShadow: `inset 0 0 0 1px ${SHEET.ink}` } : {};

/** A row merged across the table: the title, its note, or a section band. */
function MergedCell({
  kind,
  text,
  focus,
}: {
  kind: 'title' | 'note' | 'band';
  text: string;
  focus: boolean;
}) {
  return (
    <span
      className={cn(
        'flex items-center overflow-hidden whitespace-nowrap px-[2px] leading-none',
        kind === 'title' ? 'text-[0.40625rem] font-bold' : 'text-[0.3125rem]',
        kind === 'band' && 'font-bold tracking-[0.04em]',
        kind === 'note' && 'italic'
      )}
      style={{
        gridColumn: `span ${TABLE_COLS}`,
        fontFamily: 'var(--font-content)',
        background: kind === 'band' ? BOOK.band : SHEET.paper,
        color: kind === 'band' ? '#FFFFFF' : kind === 'note' ? SHEET.inkMuted : SHEET.ink,
        ...focusRing(focus),
      }}
    >
      {text}
    </span>
  );
}

/** One cell as the grid prints it: labels in the content font from the left,
    numbers in mono from the right in the workbook's colour code, a formula's
    value over its dotted rule, the header row on its fill. */
function SheetCell({
  value,
  kind,
  c,
  focus,
}: {
  value: SheetValue | null;
  kind?: 'head' | 'data' | 'stat';
  c: number;
  focus: boolean;
}) {
  const label = c === 0 && typeof value === 'string';
  const formula = value != null && typeof value === 'object';
  const ink = !value
    ? SHEET.ink
    : formula
      ? value.f.includes('!')
        ? BOOK.link
        : BOOK.formula
      : kind === 'data' && !label
        ? BOOK.input
        : SHEET.ink;
  return (
    <span
      className={cn(
        'relative flex items-center overflow-hidden whitespace-nowrap px-[2px] text-[0.3125rem] leading-none',
        label ? 'justify-start' : 'justify-end'
      )}
      style={{
        background: kind === 'head' && c < TABLE_COLS ? BOOK.head : SHEET.paper,
        color: ink,
        fontFamily: label || kind === 'head' ? 'var(--font-content)' : 'var(--font-mono)',
        fontWeight: kind === 'head' || (label && value === 'NVDA vs median') ? 700 : 400,
        ...focusRing(focus),
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

/** The value a cell holds, if the script has written it by now. */
function cellAt(r: number, c: number): SheetValue | null {
  const row = COMPS[r];
  if (!row || row.kind === 'blank') return null;
  if ('cells' in row) return row.cells[c] ?? null;
  return c === 0 ? row.text : null;
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
  const focused = focus ? cellAt(focus.r, focus.c) : null;
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
          {Array.from({ length: SHEET_ROWS }, (_, r) => {
            const row = COMPS[r];
            const merged = row && 'text' in row;
            const isFocus = (c: number) => focus?.r === r && focus.c === c;
            return [
              <SheetHeading key={`n${r}`} active={focus?.r === r}>
                {r + 1}
              </SheetHeading>,
              merged && shown.has(`${r}:0`) ? (
                <MergedCell key={`${r}m`} kind={row.kind} text={row.text} focus={isFocus(0)} />
              ) : merged ? (
                <span
                  key={`${r}m`}
                  style={{ gridColumn: `span ${TABLE_COLS}`, background: SHEET.paper }}
                />
              ) : null,
              ...SHEET_COLS.slice(merged ? TABLE_COLS : 0).map((col, i) => {
                const c = merged ? i + TABLE_COLS : i;
                return (
                  <SheetCell
                    key={`${r}${col}`}
                    value={shown.has(`${r}:${c}`) ? cellAt(r, c) : null}
                    kind={row && 'cells' in row ? row.kind : undefined}
                    c={c}
                    focus={isFocus(c)}
                  />
                );
              }),
            ];
          })}
        </div>
      </div>
      {/* sheet tabs */}
      <div
        className="flex shrink-0 items-center gap-0.5 border-t px-1 py-1"
        style={{ borderColor: 'var(--color-border-muted)' }}
      >
        <SheetTab active>Comps</SheetTab>
        <SheetTab>Data</SheetTab>
        <SheetTab>Checks</SheetTab>
      </div>
    </div>
  );
}

/** No user bubble here — the scene is the agent mid-run: parallel subagents,
    the finding with its chart, deliverables, and the file panel previewing
    the Excel they produced, docked at the window's right edge as the app
    docks it and at the share of the window a file preview opens to (wider
    than the chat). */
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
          <TopTitle>AI semis comps</TopTitle>
          <Tag>{worker}</Tag>
        </>
      }
    >
      <div className="flex flex-1 gap-2.5">
        {/* chat column */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
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
          {/* the finding, then the chart behind it */}
          <Reply
            text="NVDA trades at **2.5x** the peer median on EV/Sales, and **21%** above it on P/E."
            at={PTC.say}
          />
          <Appear at={PTC.chart}>
            <ChartCard title="AI semis, EV/Sales NTM" legend="median 9.8x">
              <ColumnChart bars={EV_SALES} max={31} median={9.8} at={PTC.bars} />
            </ChartCard>
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
