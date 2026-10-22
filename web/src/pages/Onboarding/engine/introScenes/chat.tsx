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
  Globe,
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
import { Finished, ease, useSceneTime } from './clock';
import { CLOSE, Camera, REST, type Shot } from './camera';
import { Appear, InputDock, Region, Tag, UserBubble, type Waypoint } from './kit';
import type { IntroScene } from './types';
import {
  type FlowAgent,
  type Icon,
  ActivityRow,
  ChartCard,
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
import { DASH_BUILD, DASH_META_CHIP, Dashboard, DashboardPanel } from './chatDashboard';
import { POPOVER_W, SharedFileBar, ShareDialog, SharePopover } from './shareParts';
import { ChatHeaderButtons } from './panelParts';

/* Scenes for the chat intro: the Chief of Staff answering a quick question
   itself and handing the deeper follow-up to an Analyst, who takes it up in
   its own workspace, the Chief of Staff's own thread coordinating
   Analysts, and an Analyst's thread running the work it was handed (with
   the thread intro's share scene, which opens on that thread). The
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

/** NVDA's closes over six months, for the Chief of Staff's quick answer:
    the high is the August print's gap to $186.90, as in the chart intro. */
const NVDA_6M = [
  141.6, 138.2, 133.9, 132.1, 136.8, 142.5, 147.3, 145.0, 151.2, 156.8, 153.4, 159.9, 164.1, 161.7,
  168.5, 172.3, 186.9, 179.8, 173.4, 171.2, 175.6, 178.9, 180.3, 182.42,
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
    { name: 'Research', at: 4650 },
    { name: 'Value', at: 5700 },
    { name: 'Review', at: 6650 },
  ],
  agents: [
    { label: 'Data-center demand', at: 4700, done: 5600, took: '2m 31s' },
    { label: 'DCF, three cases', at: 5750, done: 6550, took: '2m 05s' },
    { label: 'Model check', at: 6700, done: 7100, took: '44.1s' },
  ] satisfies FlowAgent[],
  logs: [
    { text: 'reading the Q2 call and consensus', at: 4700 },
    { text: 'building the DCF', at: 5750 },
    { text: 'checking the model', at: 6700 },
  ],
};

/** Split scene: the user asks the Chief of Staff (left) a quick question,
    which it answers itself, then a deeper follow-up, which it hands to an
    Analyst (right) in a new workspace. The Analyst takes the task, runs a
    workflow on it and answers at length, with a chart and its files; the
    Chief of Staff reports back to the user in a line. */
const MODES = {
  quick: 'NVDA, last 6 months?',
  ask: 100,
  fetch: 350,
  card: 700,
  answered: 1300,
  request: 'Is it still worth owning into earnings?',
  follow: 1900,
  workspace: 'NVDA deep dive',
  created: [2200, 2600],
  handoff: 2650,
  said: 2950,
  task: 4350,
  flow: 4600,
  flowDone: 7200,
  say: 7350,
  chart: 8100,
  files: [8600, 8800],
  report: 9450,
  reply: 9650,
  length: 12000,
};

/** The camera follows the work at rest, a pane whole with the edge of the
    other: the Chief of Staff answering the quick question, down its pane
    as the follow-up is handed off, across to the Analyst taking the task
    and starting the workflow, down to its answer, chart and files, back to
    the report, and out to both panes. */
const MODES_SHOTS: [Shot, ...Shot[]] = [
  shot(0, 160, 132, REST),
  shot(2800, 160, 198, REST, 700),
  shot(4300, 240, 132, REST, 800),
  shot(7500, 240, 198, REST, 700),
  shot(9500, 160, 198, REST, 600),
  wide(11400, 900),
];

function TwoModes() {
  const { t } = useTranslation();
  const names = useAgentNames();
  const [made, created] = MODES.created;
  return (
    <Camera shots={MODES_SHOTS}>
      <div className="flex gap-2 p-2" style={PAGE}>
        {/* the Chief of Staff: answers the quick question itself, hands the
            deeper follow-up off, and reports back in a line when the Analyst
            is done */}
        <Region delay={0.12} className="flex min-w-0 flex-1 flex-col gap-2 p-2">
          <PaneHeader icon={HomeRowIcon} name={names.home} />
          <Transcript>
            <UserBubble at={MODES.ask}>{MODES.quick}</UserBubble>
            <ActivityRow
              icon={TrendingUp}
              verb={t('toolArtifact.inProgress.fetchingSymbolPrices', { symbol: 'NVDA' })}
              title={t('toolArtifact.tool.stockPrices')}
              after={<Pill>NVDA</Pill>}
              at={MODES.fetch}
              done={MODES.card}
            />
            <Appear at={MODES.card} pop>
              <StockPriceCard
                sym="NVDA"
                price="$182.42"
                change={28.83}
                period="2026-04-20, 2026-10-20"
                series={NVDA_6M}
                high="$186.90"
                low="$132.10"
                vol="176.8M"
                at={MODES.card + 100}
              />
            </Appear>
            <Reply text="**Up 29% in six months,** 2% off its August high." at={MODES.answered} />
            <UserBubble at={MODES.follow}>{MODES.request}</UserBubble>
            <WorkspaceLine name={MODES.workspace} at={made} done={created} />
            <HandoffCard
              workspace={MODES.workspace}
              title="NVDA valuation into earnings"
              brief="Value it three ways into the Q3 print."
              at={MODES.handoff}
              started={MODES.task}
              finished={MODES.files[1]}
            />
            <Reply
              text="**An Analyst in NVDA deep dive is on it.** I'll report back when it's done."
              at={MODES.said}
            />
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
        {/* the Analyst: takes the task, runs a workflow on it, and answers
            at length with a chart and its files */}
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
    phone, the work is handed to the workspace's Analyst, a line saying so;
    then the Analyst's report comes back and the Chief
    of Staff sends it on to iMessage, where the request came from, with the
    file. */
const COS = {
  app: 'imessage',
  ask: 'Build me a capex tracker before NVDA reports.',
  askAt: 1500,
  think: 1850,
  handoff: 2350,
  started: 2850,
  say: 3150,
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
                text="**A busy week.** CPI prints Wednesday at 8:30, and NVDA reports after Thursday's close. Its guide rests on hyperscaler capex."
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
            {/* the turn: reasoning, the hand-off, a line on it */}
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
                  workspace="AI capex"
                  title="Build a hyperscaler capex tracker"
                  brief="Four hyperscalers, eight calls each."
                  at={COS.handoff}
                  started={COS.started}
                  finished={COS.finished}
                />
                <Reply
                  text="**The AI capex Analyst is on it.** I'll send you the tracker once it's built."
                  at={COS.say}
                />
              </div>
            )}
            {/* the Analyst's report comes back, and goes on to the phone the
                request came from, the dashboard attached */}
            <Appear at={COS.report} className="flex justify-end">
              <Provenance icon={Inbox}>
                {t('chat.provenance.reportFrom', { name: 'AI capex' })}
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
                  text="**The capex tracker is on your iMessage.** Spending hit $149bn last quarter, up 55% on a year ago, and all four raised their outlook in July."
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

/** The calls the Analyst's workflow reads: the four hyperscalers' last
    eight earnings calls, a quarter at a time. */
const CALLS = [
  'Oct 2024',
  'Jan 2025',
  'Apr 2025',
  'Jul 2025',
  'Oct 2025',
  'Jan 2026',
  'Apr 2026',
  'Jul 2026',
].flatMap((month) => ['MSFT', 'GOOGL', 'AMZN', 'META'].map((sym) => `${sym} ${month} call`));

/** The workflow runs eight agents at once and queues the rest. */
const FLOW_SLOTS = 8;

/** The read step: an agent per call, each sent as one of the eight running
    finishes, so the run works through the calls in waves. The times are
    the scene's; `took` is what each row reads once it settles. */
function readAgents(start: number): FlowAgent[] {
  const free = Array.from({ length: FLOW_SLOTS }, (_, i) => start + i * 50);
  return CALLS.map((label, i) => {
    const at = Math.min(...free);
    const done = at + 300 + ((i * 89) % 130);
    free[free.indexOf(at)] = done + 20;
    const secs = 52 + ((i * 37) % 70);
    const took =
      secs < 60 ? `${secs}.${(i * 7) % 10}s` : `1m ${String(secs - 60).padStart(2, '0')}s`;
    return { label, at, done, took };
  });
}

/** The task from the Chief of Staff arriving, the Analyst saying what it
    will run, the workflow reading the calls eight at a time, then building
    the dashboard as the file panel shows it written and checking it; the
    dashboard's META filter clicked; then the Analyst's answer and files. */
const PTC = {
  task: 100,
  plan: 300,
  flow: 800,
  read: 850,
  build: 2750,
  panel: 2850,
  dash: 3050,
  check: 5450,
  flowDone: 5950,
  filter: 6400,
  say: 7400,
  files: [8200, 8400],
  length: 10000,
};

/** The capex tracker's run: read every call, build the page, check its
    figures and quotes against the sources. */
const CAPEX_FLOW = {
  phases: [
    { name: 'Read', at: PTC.read },
    { name: 'Build', at: PTC.build },
    { name: 'Check', at: PTC.check },
  ],
  agents: [
    ...readAgents(PTC.read),
    {
      label: 'Build capex-tracker.html',
      at: PTC.build,
      done: PTC.dash + DASH_BUILD,
      took: '3m 12s',
    },
    {
      label: 'Check figures and quotes',
      at: PTC.check + 50,
      done: PTC.flowDone - 100,
      took: '58.4s',
    },
  ] satisfies FlowAgent[],
  logs: [
    { text: 'reading 32 calls, 8 at a time', at: PTC.read },
    { text: 'writing capex-tracker.html', at: PTC.build },
    { text: 'checking 96 figures and 14 quotes', at: PTC.check + 50 },
  ],
};

/** The chat's width (px) once the file panel opens beside it and takes the
    rest of the page, wider than the chat, as a file preview opens. */
const PTC_CHAT = 176;

/** The chat's width (px) before the panel opens: what the resting camera
    shows. At this width the app's centred column (max-w-3xl) fills the chat,
    so the transcript runs edge to edge in it and the agent's cards start at
    its left; the panel then slides in from the frame's right edge. */
const PTC_CHAT_START = PAGE.width / REST;

/** The chat header's height, which the panel's tab strip keeps level with. */
const PTC_HEADER_H = 24;

/** The META chip on the page, where the pointer clicks it. */
const PTC_CHIP = { x: PTC_CHAT + DASH_META_CHIP.x, y: DASH_META_CHIP.y };

/** The pointer comes in from the page's right edge, above the tiles, once
    the page is written, clicks the META chip, and rests at the empty end of
    the chip row so the filtered page shows whole. */
const PTC_POINTER: Waypoint[] = [
  { at: 5900, x: PAGE.width - 8, y: PTC_CHIP.y - 18 },
  { at: 6350, x: PTC_CHIP.x, y: PTC_CHIP.y },
  { at: 6900, x: PTC_CHIP.x + 36, y: PTC_CHIP.y + 2 },
];

/** The camera rests on the chat as the task arrives and the workflow works
    through the calls, and holds as the file panel opens beside it. Once the
    build step writes the page it pushes in on the totals and the chart,
    then down to the calls' timeline as it fills, back out to the whole page
    for the click on META, then back to the chat for the answer and its
    files, and out to the whole page. */
const PTC_SHOTS: [Shot, ...Shot[]] = [
  shot(0, 160, 132, REST),
  shot(4100, 267, 140, CLOSE, 900),
  shot(5300, 267, 215, CLOSE, 700),
  shot(6100, 240, 175, REST, 600),
  shot(7700, 160, 198, REST, 700),
  wide(9600, 900),
];

/** The Analyst's thread on the capex tracker: the chat, and the file panel
    that opens beside it on the dashboard, filtered to META at `filterAt`.
    The share scene opens on it finished and unfiltered, and draws the
    header's share button `sharing` while its popover is open and `shared`
    once the conversation is. */
function CapexThread({
  filterAt,
  sharing = false,
  shared = false,
}: {
  filterAt?: number;
  sharing?: boolean;
  shared?: boolean;
}) {
  const { t } = useTranslation();
  const names = useAgentNames();
  const now = useSceneTime();
  const open = ease(now, PTC.panel, 450);
  return (
    <div className="flex" style={PAGE}>
      {/* the chat: header, the transcript, the composer; it gives way to
            the file panel when the dashboard opens */}
      <div
        className="flex shrink-0 flex-col"
        style={{ width: PTC_CHAT_START - (PTC_CHAT_START - PTC_CHAT) * open }}
      >
        {/* the header's share and panel toggle at its right; the toggle
              moves to the panel's corner once the panel is open */}
        <div
          className="flex shrink-0 items-center gap-1.5 border-b pl-2 pr-[9px]"
          style={{ height: PTC_HEADER_H, borderColor: 'var(--iv-border)' }}
        >
          <TopTitle>Capex tracker</TopTitle>
          <Tag>{names.worker}</Tag>
          <span className="ml-auto flex">
            <ChatHeaderButtons panelOpen={now >= PTC.panel} sharing={sharing} shared={shared} />
          </span>
        </div>
        <div className="flex min-h-0 w-full flex-1 flex-col gap-1.5 p-2.5">
          <Transcript>
            <UserBubble
              at={PTC.task}
              caption={<Provenance icon={Bot}>{t('chat.provenance.fromChiefOfStaff')}</Provenance>}
            >
              Build a capex tracker from the hyperscaler calls.
            </UserBubble>
            {/* the Analyst's turn opens with a line saying what it will run,
                  so the run card reads as part of that turn */}
            <Reply
              text="I'll read all 32 calls, eight at a time, then build the tracker."
              at={PTC.plan}
            />
            <WorkflowCard
              name="capex-tracker"
              title="Hyperscaler capex, 32 earnings calls"
              {...CAPEX_FLOW}
              at={PTC.flow}
              done={PTC.flowDone}
              took="14m 22s"
              tokens={1_340_000}
            />
            {/* the long answer, then the files */}
            <Reply
              text="**Capex hit $149bn last quarter, up 55% on a year ago.** All four raised their outlook in July; 2026 guidance now sums to about $610bn, with GOOGL up most, to $140bn. Every figure checks against the filings."
              at={PTC.say}
            />
            <FileStack
              top={{ name: 'capex-tracker.html', kind: 'page', icon: Globe }}
              under={{ name: 'capex-calls.csv', kind: 'spreadsheet', icon: FileSpreadsheet }}
              at={PTC.files[0]}
              next={PTC.files[1]}
            />
          </Transcript>
          <InputDock delay={0.6} />
        </div>
      </div>
      {/* file panel previewing the dashboard, written as the workflow runs;
            it slides in at its full width, so the page never reflows */}
      {now >= PTC.panel && (
        <div
          className="flex min-w-0 flex-1 overflow-hidden border-l"
          style={{ background: 'var(--color-bg-page)', borderColor: 'var(--color-border-muted)' }}
        >
          <div className="flex shrink-0" style={{ width: PAGE.width - PTC_CHAT }}>
            <DashboardPanel at={PTC.dash} filterAt={filterAt} headerH={PTC_HEADER_H} />
          </div>
        </div>
      )}
    </div>
  );
}

function PtcSandbox() {
  return (
    <Camera shots={PTC_SHOTS} cursor={PTC_POINTER} clicks={[PTC.filter]}>
      <CapexThread filterAt={PTC.filter} />
    </Camera>
  );
}

/* ── thread intro · share the conversation, or the one file ───────────── */

/* It plays in the thread intro, not this one, and lives here for the
   Analyst's thread it opens on. */

/** The share scene's script (ms): the conversation's popover, opened, its
    link switched on, file browsing allowed and the link copied; then the
    dashboard's own share dialog, opened from the file's header, its file
    list back, switched on, its link copied; then that link as a visitor
    opens it. */
const SHARE = {
  popover: 900,
  on: 1650,
  files: 2350,
  copied: 2950,
  dialog: 3850,
  listed: 4350,
  fileOn: 5350,
  fileCopied: 6000,
  visitor: 6750,
  length: 10600,
};

/** The header's share button, and where the popover hangs from it: its
    right edge on the button's, just under the header. */
const SHARE_BUTTON = { x: PTC_CHAT - 9 - 8, y: PTC_HEADER_H / 2 };
const SHARE_POPOVER = { right: PTC_CHAT - 9, top: PTC_HEADER_H + 1 };

/** The file header's share link button (`Link2`), second of its four. */
const FILE_LINK = { x: PAGE.width - 4.5 - 16 * 2.5 - 4.5 * 2, y: PTC_HEADER_H + 9.5 };

/** The pointer: up to the header's share button, then the popover's
    switch, the file browsing box and the copy button; across to the
    dashboard's share link, whose press also closes the popover; then the
    dialog's switch, its copy button, and the visitor's view. */
const SHARE_POINTER: Waypoint[] = [
  { at: 300, x: 96, y: 170 },
  { at: SHARE.popover - 50, ...SHARE_BUTTON },
  { at: SHARE.on - 50, x: SHARE_POPOVER.right - 8 - 9.5, y: SHARE_POPOVER.top + 8 + 5 },
  { at: SHARE.files - 50, x: SHARE_POPOVER.right - POPOVER_W + 8 + 3, y: 83 },
  { at: SHARE.copied - 50, x: SHARE_POPOVER.right - 8 - 7, y: SHARE_POPOVER.top + 32 },
  { at: SHARE.dialog - 50, ...FILE_LINK },
  { at: SHARE.fileOn - 50, x: 307, y: 154 },
  { at: SHARE.fileCopied - 50, x: 310, y: 124 },
  { at: SHARE.visitor - 50, x: 100, y: 231 },
  { at: SHARE.visitor + 900, x: 372, y: 300 },
];

/** The camera pushes in on the popover as it opens, steps back to take in
    the file's header and the dialog over the page, closes on the dialog,
    then rests on the visitor's page and pulls out to all of it. */
const SHARE_SHOTS: [Shot, ...Shot[]] = [
  shot(0, 160, 132, REST),
  shot(1300, 134, 110, CLOSE, 600),
  shot(3800, 200, 150, REST, 700),
  shot(4700, 200, 165, 1.4, 600),
  shot(7350, 160, 132, REST, 600),
  wide(9500, 900),
];

function ShareThread() {
  const now = useSceneTime();
  const sharing = now >= SHARE.popover && now < SHARE.dialog;
  const visitor = ease(now, SHARE.visitor + 150, 350);
  return (
    <Camera
      shots={SHARE_SHOTS}
      cursor={SHARE_POINTER}
      clicks={[
        SHARE.popover,
        SHARE.on,
        SHARE.files,
        SHARE.copied,
        SHARE.dialog,
        SHARE.fileOn,
        SHARE.fileCopied,
        SHARE.visitor,
      ]}
    >
      <div className="relative" style={PAGE}>
        {/* the thread as the Analyst left it */}
        <Finished>
          <CapexThread sharing={sharing} shared={now >= SHARE.on} />
        </Finished>
        {sharing && (
          <SharePopover
            at={SHARE.popover}
            on={SHARE.on}
            files={SHARE.files}
            copied={SHARE.copied}
            style={{ left: SHARE_POPOVER.right - POPOVER_W, top: SHARE_POPOVER.top }}
          />
        )}
        {now >= SHARE.dialog && visitor < 1 && (
          <ShareDialog
            at={SHARE.dialog}
            listed={SHARE.listed}
            on={SHARE.fileOn}
            copied={SHARE.fileCopied}
          />
        )}
        {/* the file's link as a visitor opens it: the page alone, under the
            shared file's bar */}
        {visitor > 0 && (
          <div
            className="absolute inset-0 flex flex-col"
            style={{ background: 'var(--color-bg-page)', opacity: visitor }}
          >
            <SharedFileBar name="capex-tracker.html" />
            <Dashboard at={EARLIER} />
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
  shareThread: { Scene: ShareThread, length: SHARE.length, anchor: 'right' },
} satisfies Partial<Record<IntroVisualId, IntroScene>>;
