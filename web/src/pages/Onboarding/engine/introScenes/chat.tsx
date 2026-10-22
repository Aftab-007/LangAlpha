import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Bot,
  Brain,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Folder,
  Inbox,
  Search,
  Send,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { HomeRowIcon } from '@/hooks/useHomeWorkspace';
import { cn } from '@/lib/utils';
import { messagingAppName } from '@/pages/ChatAgent/components/messaging/messageDelivery';
import { useAgentNames } from '../introAgents';
import type { IntroVisualId } from '../../registry';
import { BarChart, StockPriceCard, type Bar } from './charts';
import { ease, useSceneTime } from './clock';
import { CLOSE, Camera, REST, type Shot } from './camera';
import { Appear, InputDock, Region, Tag, UserBubble } from './kit';
import type { IntroScene } from './types';
import {
  type FlowAgent,
  type Icon,
  ActivityRow,
  ChartCard,
  ColumnChart,
  DeliveryPill,
  FileStack,
  HandoffCard,
  PAGE,
  Pill,
  Provenance,
  Reply,
  ViaApp,
  WorkflowCard,
  WorkspaceLine,
  shot,
  wide,
} from './chatParts';
import { EV_SALES, SheetPanel } from './chatWorkbook';
import { ChatHeaderButtons } from './panelParts';

/* Scenes for the chat intro: the Chief of Staff handing work to an Analyst
   and both at work at once, the Chief of Staff's own thread coordinating
   Analysts, and an Analyst's thread running the work it was handed. The
   Chief of Staff stays brief and talks to the user; the Analyst runs a
   workflow and writes the long answer with its charts and files. Each part
   is a small copy of the component the app draws it with (named on each),
   in the same tokens and labels. The figures are invented, and agree with
   each other across the scenes. */
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

/** A chat column's transcript: from the top while it fits, then held on its
    newest lines with the oldest running off the top, as a thread scrolls
    with its replies. */
function Transcript({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden">
      <div className={cn('flex min-h-full shrink-0 flex-col gap-1.5', className)}>{children}</div>
    </div>
  );
}

/* ── chat · step 1: one hand-off, from both sides ──────────────────────── */

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

/** The Analyst's DCF: value per share by case, against spot. */
const DCF_CASES: Bar[] = [
  { label: 'Bear', value: 128, shown: '$128' },
  { label: 'Base', value: 171, shown: '$171', mark: true },
  { label: 'Bull', value: 226, shown: '$226' },
];

/** The NVDA valuation the Analyst's workflow runs: three phases, the agents
    each sends out, and the log line it prints as each phase starts. */
const NVDA_FLOW = {
  phases: [
    { name: 'Research', at: 1600 },
    { name: 'Value', at: 3400 },
    { name: 'Review', at: 4700 },
  ],
  agents: [
    { label: 'Data-center demand', at: 1650, done: 3250, took: '2m 31s' },
    { label: 'DCF, three cases', at: 3450, done: 4600, took: '2m 05s' },
    { label: 'Model check', at: 4750, done: 5300, took: '44.1s' },
  ] satisfies FlowAgent[],
  logs: [
    { text: 'reading the Q2 call and consensus', at: 1650 },
    { text: 'building the DCF', at: 3450 },
    { text: 'checking the model', at: 4750 },
  ],
};

/** Split scene: the Chief of Staff (left) hands a question to an Analyst
    (right) and stays free, taking a quick question itself while the
    Analyst's workflow runs. The Analyst answers at length, with a chart and
    its files; the Chief of Staff reports back to the user in a line. */
const MODES = {
  request: 'Is NVDA still worth owning into earnings?',
  workspace: 'NVDA deep dive',
  created: [350, 750],
  handoff: 800,
  started: 1250,
  said: 1400,
  task: 1300,
  flow: 1550,
  quick: 'AVGO, last 6 months?',
  ask: 3000,
  fetch: 3150,
  card: 3450,
  flowDone: 5400,
  say: 5550,
  chart: 6300,
  files: [6800, 7000],
  report: 7900,
  reply: 8150,
  length: 10600,
};

/** The camera follows the work at rest, a pane whole with the edge of the
    other: the Chief of Staff sending the question off, across to the
    Analyst taking it up, back as the Chief of Staff answers the quick
    question, across to the Analyst's answer, its chart and files, back to
    the report, and out to both panes. */
const MODES_SHOTS: [Shot, ...Shot[]] = [
  shot(0, 160, 132, REST),
  shot(2300, 240, 132, REST, 800),
  shot(3100, 160, 198, REST, 700),
  shot(4700, 240, 198, REST, 700),
  shot(7900, 160, 198, REST, 600),
  wide(9700, 900),
];

function TwoModes() {
  const { t } = useTranslation();
  const names = useAgentNames();
  const [made, created] = MODES.created;
  return (
    <Camera shots={MODES_SHOTS}>
      <div className="flex gap-2 p-2" style={PAGE}>
        {/* the Chief of Staff: hands the work off, stays free to talk, and
            reports back in a line when the Analyst is done */}
        <Region delay={0.12} className="flex min-w-0 flex-1 flex-col gap-2 p-2">
          <PaneHeader icon={HomeRowIcon} name={names.home} />
          <Transcript>
            <UserBubble at={0}>{MODES.request}</UserBubble>
            <WorkspaceLine name={MODES.workspace} at={made} done={created} />
            <HandoffCard
              workspace={MODES.workspace}
              title="NVDA valuation into earnings"
              brief="Value it three ways into the Q3 print."
              at={MODES.handoff}
              started={MODES.started}
              finished={MODES.files[1]}
            />
            <Reply
              text="**An Analyst in NVDA deep dive is on it.** I'll report back when it's done."
              at={MODES.said}
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
            <Appear at={MODES.report} className="flex justify-end">
              <Provenance icon={Inbox}>
                {t('chat.provenance.reportFrom', { name: MODES.workspace })}
              </Provenance>
            </Appear>
            <Reply
              text="**NVDA looks fully priced.** Only the bull case clears today's $182; the base case is $171. The model is in valuation.xlsx."
              at={MODES.reply}
            />
          </Transcript>
        </Region>
        {/* the Analyst: takes the question, runs a workflow on it, and
            answers at length with a chart and its files */}
        <Region delay={0.28} className="flex min-w-0 flex-1 flex-col gap-2 p-2">
          <PaneHeader icon={Folder} name={names.worker} />
          <Transcript>
            <UserBubble
              at={MODES.task}
              caption={<Provenance icon={Bot}>{t('chat.provenance.fromChiefOfStaff')}</Provenance>}
            >
              Value NVDA three ways before Q3.
            </UserBubble>
            <WorkflowCard
              name="nvda-valuation"
              title="Is NVDA worth owning into earnings?"
              {...NVDA_FLOW}
              at={MODES.flow}
              done={MODES.flowDone}
              took="6m 48s"
              tokens={412_000}
            />
            <Reply
              text="**Base case $171 a share, 6% below spot.** Only the bull case clears $182, and it needs data-center revenue to compound 40% a year to 2028."
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
            <FileStack
              top={{ name: 'valuation.xlsx', kind: 'spreadsheet', icon: FileSpreadsheet }}
              under={{ name: 'nvda-earnings.pdf', kind: 'document', icon: FileText }}
              at={MODES.files[0]}
              next={MODES.files[1]}
            />
          </Transcript>
        </Region>
      </div>
    </Camera>
  );
}

/* ── chat · step 2: a Chief of Staff thread ────────────────────────────── */

/** The Chief of Staff's turn, played out under earlier quick answers, all in
    a thread the user writes to from iMessage: a request comes in from the
    phone, the work is handed to the workspace's Analyst, an automation set
    up, a line saying so; then the Analyst's report comes back and the Chief
    of Staff sends it on to iMessage, where the request came from, with the
    file. */
const COS = {
  app: 'imessage',
  ask: 'Refresh the semis comps, and brief me before earnings.',
  askAt: 1500,
  think: 1850,
  handoff: 2350,
  started: 2850,
  automation: [2950, 3450],
  say: 3650,
  finished: 5400,
  report: 5650,
  send: [5950, 6650],
  delivered: 6700,
  reply: 7000,
  length: 9800,
};

/** The chat column's width (px), centered on the page as the app sets it. */
const COS_COL = 240;

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
  { label: 'ARM', value: 0.3, shown: '+0.3%' },
];

/** The whole thread first, its header naming the Chief of Staff, then down
    to the newest lines as the request comes in and the turn builds, in on
    the send to iMessage as the report goes back out, and out again. */
const COS_SHOTS: [Shot, ...Shot[]] = [
  wide(0),
  shot(1300, 200, 198, REST, 900),
  shot(6700, 200, 220, CLOSE, 800),
  shot(9000, 200, 198, REST, 700),
];

function ChiefOfStaffAnswer() {
  const { t } = useTranslation();
  const names = useAgentNames();
  const now = useSceneTime();
  const [automate, automated] = COS.automation;
  const [send, sent] = COS.send;
  const via = <ViaApp app={COS.app} />;
  const app = messagingAppName(COS.app) ?? '';
  return (
    <Camera shots={COS_SHOTS}>
      <div className="flex flex-col" style={PAGE}>
        {/* the thread's header: back, its title, the agent it runs with */}
        <div
          className="flex h-6 shrink-0 items-center gap-2 border-b px-2.5"
          style={{ borderColor: 'var(--iv-border)' }}
        >
          <TopTitle>Semis this week</TopTitle>
          <Tag>{names.home}</Tag>
        </div>
        <div
          className="mx-auto flex min-h-0 flex-1 flex-col gap-1.5 pb-1 pt-[18px]"
          style={{ width: COS_COL }}
        >
          {/* the transcript settles on the composer, as a thread with history
              does: the newest lines just above it, the oldest running off the
              top as they come in */}
          <div className="flex min-h-0 flex-1 flex-col justify-end gap-1.5 overflow-hidden">
            {/* earlier today, from the phone: the week ahead, then a quick
                market question, both answered here and relayed back */}
            <UserBubble at={EARLIER} caption={via} className="ml-12">
              Morning. What&apos;s on this week?
            </UserBubble>
            <div className="mr-12 flex flex-col gap-1.5">
              <ActivityRow
                icon={Search}
                verb={t('toolArtifact.inProgress.searching')}
                title={t('toolArtifact.tool.webSearch')}
                after={<Pill>earnings this week</Pill>}
                at={EARLIER}
                done={EARLIER}
              />
              <Reply
                text="**A busy week.** CPI prints Wednesday at 8:30, and NVDA reports after Thursday's close. Your AI semis comps are a week old."
                at={EARLIER}
              />
            </div>
            <UserBubble at={EARLIER} caption={via} className="ml-12">
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
            {/* the request, texted in rather than typed here */}
            <UserBubble at={COS.askAt} caption={via} className="ml-8">
              {COS.ask}
            </UserBubble>
            {/* the turn: reasoning, the hand-off, the automation, a line on it */}
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
                  done={COS.handoff}
                />
                <HandoffCard
                  workspace="AI semis comps"
                  title="Refresh the nine-name comps"
                  brief="NTM multiples; flag what moved since last week."
                  at={COS.handoff}
                  started={COS.started}
                  finished={COS.finished}
                />
                <ActivityRow
                  icon={Zap}
                  verb={t('toolArtifact.inProgress.creatingName', { name: 'earnings-call brief' })}
                  title={t('toolArtifact.tool.createAutomation')}
                  after={<Pill>earnings-call brief</Pill>}
                  at={automate}
                  done={automated}
                />
                <Reply
                  text="**The AI semis comps Analyst is on it.** A brief will land the morning of each earnings call."
                  at={COS.say}
                />
              </div>
            )}
            {/* the Analyst's report comes back, and goes on to the phone the
                request came from, the workbook attached */}
            <Appear at={COS.report} className="flex justify-end">
              <Provenance icon={Inbox}>
                {t('chat.provenance.reportFrom', { name: 'AI semis comps' })}
              </Provenance>
            </Appear>
            {now >= send && (
              <div className="mr-12 flex flex-col gap-1.5">
                <ActivityRow
                  icon={Send}
                  verb={t('toolArtifact.inProgress.sendingTo', { app })}
                  title={t('toolArtifact.tool.sendMessage')}
                  after={<Pill>{app}</Pill>}
                  at={send}
                  done={sent}
                />
                <Appear at={COS.delivered} pop>
                  <DeliveryPill app={COS.app} files={1} />
                </Appear>
                <Reply
                  text="**Comps refreshed, and sent to your iMessage with comps.xlsx.** NVDA's premium widened to 2.5x the peer median on EV/Sales, from 2.2x. MU moved most."
                  at={COS.reply}
                />
              </div>
            )}
          </div>
          <InputDock />
        </div>
      </div>
    </Camera>
  );
}

/* ── chat · step 3: an Analyst thread running a workflow ───────────────── */

/** The comps refresh the Analyst's workflow runs: estimates pulled three
    names to an agent, the workbook built, then its formulas checked. */
const COMPS_FLOW = {
  phases: [
    { name: 'Pull', at: 300 },
    { name: 'Build', at: 1100 },
    { name: 'Check', at: 4000 },
  ],
  agents: [
    { label: 'NTM estimates: NVDA, AVGO, TSM', at: 350, done: 900, took: '41.2s' },
    { label: 'NTM estimates: AMD, ARM, QCOM', at: 400, done: 1000, took: '47.9s' },
    { label: 'NTM estimates: MU, MRVL, INTC', at: 450, done: 1050, took: '52.3s' },
    { label: 'Build comps.xlsx', at: 1150, done: 3900, took: '1m 38s' },
    { label: 'Check formulas', at: 4050, done: 4400, took: '21.6s' },
  ] satisfies FlowAgent[],
  logs: [
    { text: 'pulling NTM consensus for nine names', at: 350 },
    { text: 'writing comps.xlsx', at: 1150 },
    { text: 'checking 54 formulas', at: 4050 },
  ],
};

/** The task from the Chief of Staff arriving, the workflow running it while
    the file panel shows comps.xlsx being written row by row, then the
    Analyst's long answer, the chart behind it, and its files. */
const PTC = {
  task: 100,
  flow: 300,
  panel: 1100,
  sheet: 1300,
  flowDone: 4500,
  say: 4700,
  chart: 5700,
  bars: 5800,
  files: [6300, 6500],
  length: 8300,
};

/** The chat's width (px) once the file panel opens beside it and takes the
    rest of the page, wider than the chat, as a file preview opens. Until
    then the chat has the page, its column held to `COS_COL`. */
const PTC_CHAT = 176;

/** The chat header's height, which the panel's tab strip keeps level with. */
const PTC_HEADER_H = 24;

/** The camera rests on the chat as the task arrives and the workflow starts,
    drifts across to the sheet as the file panel opens and the workflow's
    build step writes it, the panel whole from its tab strip, pushes in on
    the peers and their statistics, then comes back down the chat for the
    answer, its chart and files, and out to the whole page. */
const PTC_SHOTS: [Shot, ...Shot[]] = [
  shot(0, 160, 132, REST),
  shot(1800, 240, 132, REST, 700),
  shot(2900, 272, 175, CLOSE, 900),
  shot(4900, 160, 198, REST, 800),
  wide(7400, 900),
];

function PtcSandbox() {
  const { t } = useTranslation();
  const names = useAgentNames();
  const now = useSceneTime();
  const open = ease(now, PTC.panel, 450);
  return (
    <Camera shots={PTC_SHOTS}>
      <div className="flex" style={PAGE}>
        {/* the chat: header, the transcript, the composer; it gives way to
            the file panel when the workbook opens */}
        <div
          className="flex shrink-0 flex-col"
          style={{ width: PAGE.width - (PAGE.width - PTC_CHAT) * open }}
        >
          {/* the header's share and panel toggle at its right; the toggle
              moves to the panel's corner once the panel is open */}
          <div
            className="flex shrink-0 items-center gap-1.5 border-b pl-2 pr-[9px]"
            style={{ height: PTC_HEADER_H, borderColor: 'var(--iv-border)' }}
          >
            <TopTitle>Refresh the comps</TopTitle>
            <Tag>{names.worker}</Tag>
            <span className="ml-auto flex">
              <ChatHeaderButtons panelOpen={now >= PTC.panel} />
            </span>
          </div>
          <div
            className="mx-auto flex min-h-0 w-full flex-1 flex-col gap-1.5 p-2.5"
            style={{ maxWidth: COS_COL }}
          >
            <Transcript>
              <UserBubble
                at={PTC.task}
                caption={
                  <Provenance icon={Bot}>{t('chat.provenance.fromChiefOfStaff')}</Provenance>
                }
              >
                Refresh the comps; flag what moved.
              </UserBubble>
              <WorkflowCard
                name="semis-comps"
                title="Refresh nine AI semis comps"
                {...COMPS_FLOW}
                at={PTC.flow}
                done={PTC.flowDone}
                took="3m 41s"
                tokens={268_000}
              />
              {/* the long answer, then the chart behind it, then the files */}
              <Reply
                text="**NVDA trades at 24.1x NTM sales, 2.5x the 9.8x median,** up from 2.2x last week. MU moved most, down to 4.2x as memory prices reset. On P/E, NVDA's premium is 21%. All 54 formulas check out."
                at={PTC.say}
              />
              <Appear at={PTC.chart}>
                <ChartCard title="AI semis, EV/Sales NTM" legend="median 9.8x">
                  <ColumnChart bars={EV_SALES} max={31} median={9.8} at={PTC.bars} />
                </ChartCard>
              </Appear>
              <FileStack
                top={{ name: 'comps.xlsx', kind: 'spreadsheet', icon: FileSpreadsheet }}
                under={{ name: 'comps-note.pdf', kind: 'document', icon: FileText }}
                at={PTC.files[0]}
                next={PTC.files[1]}
              />
            </Transcript>
            <InputDock delay={0.6} />
          </div>
        </div>
        {/* file panel previewing the workbook, written as the workflow runs;
            it slides in at its full width, so the sheet never reflows */}
        {now >= PTC.panel && (
          <div
            className="flex min-w-0 flex-1 overflow-hidden border-l"
            style={{ background: 'var(--color-bg-page)', borderColor: 'var(--color-border-muted)' }}
          >
            <div className="flex shrink-0" style={{ width: PAGE.width - PTC_CHAT }}>
              <SheetPanel at={PTC.sheet} headerH={PTC_HEADER_H} />
            </div>
          </div>
        )}
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
