import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Brain,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Folder,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { HomeRowIcon } from '@/hooks/useHomeWorkspace';
import { useAgentNames } from '../introAgents';
import type { IntroVisualId } from '../../registry';
import { BarChart, StockPriceCard, type Bar } from './charts';
import { useSceneTime } from './clock';
import { Camera, type Shot } from './camera';
import { Appear, InputDock, Region, Tag, Typed, UserBubble } from './kit';
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
  PAGE,
  shot,
  wide,
} from './chatParts';
import { EV_SALES, SheetPanel } from './chatWorkbook';

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
    steps on the request land quickly, one after another, then it answers a
    quick question itself; the Analyst's subagents grind through their tools
    for longer and end in a finding, its chart and a file. The hand-off on
    the left reads completed as the file lands, and the Chief of Staff
    reports back. */
const MODES = {
  request: 'Set up a deep dive on NVDA earnings',
  rows: [150, 500],
  rowRun: 350,
  quick: 'AVGO, last 6 months?',
  ask: 1300,
  fetch: 1450,
  card: 1700,
  // the Analyst's subagents start as the hand-off goes out
  cards: [950, 1200],
  cardsDone: [4500, 4900],
  say: 4950,
  chart: 5300,
  file: 5700,
  report: 7450,
  length: 8400,
};

/** The camera follows the work, a pane wide and held on what has landed:
    the Chief of Staff sending it off and taking the quick question, down to
    its answer, across to the Analyst's subagents finishing, down to the
    finding, its chart and the file, and back out to both panes as the
    report comes back. */
const MODES_SHOTS: [Shot, ...Shot[]] = [
  shot(0, { x: 8, y: 8, w: 188, h: 92 }, { pad: 6 }),
  shot(2100, { x: 8, y: 128, w: 188, h: 153 }, { pad: 6, dur: 600 }),
  shot(4400, { x: 204, y: 8, w: 188, h: 142 }, { pad: 6, dur: 900 }),
  shot(5500, { x: 204, y: 154, w: 188, h: 153 }, { pad: 6, dur: 600 }),
  wide(7400, 800),
];

function TwoModes() {
  const { t } = useTranslation();
  const names = useAgentNames();
  const [row1, row2] = MODES.rows;
  const [card1, card2] = MODES.cards;
  const [card1Done, card2Done] = MODES.cardsDone;
  return (
    <Camera shots={MODES_SHOTS}>
      <div className="flex gap-2 p-2" style={PAGE}>
        {/* Chief of Staff half: coordinating the desk, answering quick
            questions itself, reporting back when the work is done */}
        <Region delay={0.12} className="flex min-w-0 flex-1 flex-col gap-2 p-2">
          <PaneHeader icon={HomeRowIcon} name={names.home} />
          <UserBubble at={0}>{MODES.request}</UserBubble>
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
    </Camera>
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
  rows: [2500, 3100, 3700],
  rowRun: 500,
  say: 4250,
  quick: 'NVDA price?',
  typeQuick: 5400,
  sendQuick: 5900,
  answer: 6150,
  card: 6600,
  length: 8500,
};

/** The chat column's width (px), centered on the page as the app sets it. */
const COS_COL = 240;
const COS_X = (PAGE.width - COS_COL) / 2;

/** When the thread's earlier exchange happened: long before the scene, so it
    is on the page, settled, from the first frame. */
const EARLIER = -60_000;

/** The earlier exchange's chart: today's move in the names it was asked
    about, against the index. */
const SEMIS: Bar[] = [
  { label: 'AVGO', value: 2.3, shown: '+2.3%' },
  { label: 'NVDA', value: 1.6, shown: '+1.6%', mark: true },
  { label: 'TSM', value: 1.4, shown: '+1.4%' },
  { label: 'AMD', value: 0.9, shown: '+0.9%' },
  { label: 'MU', value: 0.6, shown: '+0.6%' },
];

/** The camera stays low, where a thread with history moves: the composer
    whole as the request is typed and sent, with the earlier exchange above
    it, the turn building up from the composer in the same frame, then down
    to the quick question and the quote it gets back, then the whole page. */
const COS_SHOTS: [Shot, ...Shot[]] = [
  shot(0, { x: COS_X, y: 118, w: COS_COL, h: 208 }),
  shot(5300, { x: COS_X, y: 138, w: COS_COL, h: 195 }, { dur: 700, onPage: false }),
  wide(7700, 800),
];

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
    <Camera shots={COS_SHOTS}>
      <div className="flex flex-col" style={PAGE}>
        {/* the thread's header: back, its title, the agent it runs with */}
        <div
          className="flex h-6 shrink-0 items-center gap-2 border-b px-2.5"
          style={{ borderColor: 'var(--iv-border)' }}
        >
          <TopTitle>Semis today</TopTitle>
          <Tag>{names.home}</Tag>
        </div>
        <div
          className="mx-auto flex min-h-0 flex-1 flex-col gap-1.5 pb-1 pt-[18px]"
          style={{ width: COS_COL }}
        >
          {/* the transcript settles on the composer, as a thread with history
              does: the newest lines just above it, the oldest running off the
              top as they come in, the earlier exchange gone by the end */}
          <div className="flex min-h-0 flex-1 flex-col justify-end gap-1.5 overflow-hidden">
            {/* earlier today: a market question, answered with a chart */}
            <UserBubble at={EARLIER} className="ml-12">
              What&apos;s moving in semis?
            </UserBubble>
            <div className="mr-12 flex flex-col gap-1.5">
              <ActivityRow
                icon={Zap}
                verb={t('toolArtifact.inProgress.fetchingQuotes')}
                title={t('toolArtifact.tool.liveQuotes')}
                after={<Pill>SOXX, AVGO, NVDA, TSM, AMD, MU</Pill>}
                at={EARLIER}
                done={EARLIER}
              />
              <ChartCard title="Semis today, % change" legend="SOXX +1.2%">
                <BarChart bars={SEMIS} max={2.6} median={1.2} at={EARLIER} labelWidth={22} />
              </ChartCard>
              <Reply
                text="**SOXX is up 1.2%.** AVGO leads; NVDA holds above $182 into earnings."
                at={EARLIER}
              />
            </div>
            <UserBubble at={COS.sendAsk + 80} className="ml-12">
              {COS.ask}
            </UserBubble>
            {/* the turn sits on the page, as the app writes replies: reasoning,
              the workspace, the hand-off card, the automation, a line on it */}
            {now >= COS.think && (
              <div className="mr-12 flex flex-col gap-1.5">
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
            <UserBubble at={COS.sendQuick + 80} className="ml-12">
              {COS.quick}
            </UserBubble>
            {now >= COS.answer && (
              <div className="mr-12 flex flex-col gap-1.5">
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
          </div>
          <InputDock text={composer} sendAt={[COS.sendAsk, COS.sendQuick]} />
        </div>
      </div>
    </Camera>
  );
}

/* ── chat · step 3: an Analyst thread page running code ────────────────── */

/** The Analyst mid-run, played out: two subagents in parallel, their tool
    counts ticking, while the file panel shows comps.xlsx being written row
    by row. The finding and the chart behind it come in once the sheet is
    written, and the deliverables land as report-builder returns. */
const PTC = {
  cards: [200, 450],
  cardsDone: [2000, 6000],
  panel: 600,
  sheet: 1500,
  say: 5100,
  chart: 5500,
  bars: 5600,
  chips: [6150, 6300],
  length: 8400,
};

/** The chat column's width (px); the file panel takes the rest of the page,
    wider than the chat, as a file preview opens. */
const PTC_CHAT = 176;

/** The camera rides the run: the subagents starting, across to the sheet as
    report-builder writes it (down the peers to the statistics), back to the
    finding, its chart and the files, then out to the whole page. */
const PTC_SHOTS: [Shot, ...Shot[]] = [
  shot(0, { x: 10, y: 10, w: PTC_CHAT - 20, h: 108 }),
  shot(2100, { x: PTC_CHAT + 9, y: 18, w: 172, h: 120 }, { dur: 900 }),
  shot(3800, { x: PTC_CHAT + 9, y: 116, w: 172, h: 124 }, { dur: 1300 }),
  shot(5100, { x: 0, y: 118, w: PTC_CHAT - 2, h: 140 }, { pad: 0, dur: 800 }),
  wide(7500, 900),
];

/** No user bubble here — the scene is the agent mid-run: parallel subagents,
    the finding with its chart, deliverables, and the file panel previewing
    the Excel they produced, docked at the page's right edge as the app
    docks it. */
function PtcSandbox() {
  const now = useSceneTime();
  const [card1, card2] = PTC.cards;
  const [card1Done, card2Done] = PTC.cardsDone;
  const stacked = now >= PTC.chips[1];
  return (
    <Camera shots={PTC_SHOTS}>
      <div className="flex" style={PAGE}>
        {/* chat column */}
        <div className="flex shrink-0 flex-col gap-1 p-2.5" style={{ width: PTC_CHAT }}>
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
          className="flex min-w-0 flex-1 border-l"
          style={{ background: 'var(--color-bg-page)', borderColor: 'var(--color-border-muted)' }}
        >
          <SheetPanel at={PTC.sheet} />
        </Appear>
      </div>
    </Camera>
  );
}

export const chatScenes = {
  // centered: symmetric comparison, fades its own edges
  twoModes: { Scene: TwoModes, length: MODES.length, anchor: 'center' },
  chiefOfStaffAnswer: { Scene: ChiefOfStaffAnswer, length: COS.length, anchor: 'center' },
  ptcSandbox: { Scene: PtcSandbox, length: PTC.length, anchor: 'center' },
} satisfies Partial<Record<IntroVisualId, IntroScene>>;
