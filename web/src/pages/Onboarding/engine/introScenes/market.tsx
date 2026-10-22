import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, PenLine } from 'lucide-react';
import type { IntroVisualId } from '../../registry';
import { Camera, REST, VIEW, look, type Shot } from './camera';
import { Candles, EventBadge } from './candles';
import {
  CommentBox,
  Pin,
  Selection,
  SelectionCard,
  SelectionChip,
  besideRegion,
} from './chartTools';
import { useSceneTime } from './clock';
import { Appear, Loader, Typed, UserBubble, type Waypoint, pointAt } from './kit';
import { CHART, CHAT_X, MarketPage, PAGE, REGION_BTN, SEND } from './marketParts';
import { NVDA, NVDA_EVENTS, chartScale } from './nvdaSeries';
import { Prose, ToolRow } from './threadParts';
import type { IntroScene } from './types';

/* The market intro, on MarketView itself, framed by a camera that shows
   one side of the page at a time with an edge of the other. marketAsk: on
   the chart under the stock's header, the Region tool is armed and the
   September drop is taken and noted; across to the chat panel, where the
   selection goes out as a chip. The agent starts on it. marketDraw: on the
   chat panel as the agent pins the news behind each move to the chart;
   the pointer rests on its chip, then the camera crosses to the chart,
   where each move carries its event badge, and a click opens the story
   behind the drop. */
/* eslint-disable react-refresh/only-export-components -- scene module:
   private scene components, one record export */

const SCALE = chartScale(NVDA, CHART.w, CHART.h);
/** A point of the chart, in page px. */
const onPage = (x: number, y: number) => ({ x: CHART.x + x, y: CHART.y + y });

const NOTE = 'What drove this drop?';
const LEAD = 'Two pieces of news drove it. Marking them on your chart.';

/** The page's size, for `look`. */
const PAGE_SIZE = { width: PAGE.w, height: PAGE.h };
/** Where the metrics' third column (Low, Volume) ends, in page px. A view
    of the chat side from just past it to the page's right edge sits a
    touch wider than REST and cuts none of the metrics' figures. */
const METRICS_GAP = 137;
const CHAT_REST = VIEW.width / (PAGE.w - METRICS_GAP);

/** A native tooltip (a button's `title`), under the pointer. */
function Tip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <span
      className="intro-pop absolute z-10 whitespace-nowrap rounded-[2px] border px-[3px] py-[2px] text-[5px] leading-none"
      style={{
        left: x,
        top: y,
        background: 'var(--color-bg-elevated)',
        borderColor: 'var(--color-border-default)',
        color: 'var(--color-text-primary)',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.12)',
      }}
    >
      {children}
    </span>
  );
}

/** The user's message with its selection, as sent from the panel. */
function Sent({ at }: { at: number }) {
  return (
    <>
      <UserBubble at={at}>{NOTE}</UserBubble>
      <SelectionCard at={at + 60} note={NOTE} />
    </>
  );
}

/* ── marketAsk ─────────────────────────────────────────────────────────── */

const ASK = {
  tip: 900,
  arm: 1250,
  press: 2250,
  release: 2950,
  type: 3150,
  add: 4250,
  /** The comment box closes on Add, leaving the pin and the chip. */
  added: 4400,
  send: 5450,
  think: 5650,
  lead: 6250,
  length: 7600,
};

/** The September drop: from above the post-earnings high (Aug 28) to under
    the low it slid to (Sep 11). */
const REGION = {
  x0: SCALE.x(11) - SCALE.step / 2,
  y0: SCALE.y(187.6),
  x1: SCALE.x(20) + SCALE.step / 2,
  y1: SCALE.y(169.9),
};
const BOX = besideRegion(SCALE, REGION.x0, REGION.x1, REGION.y0);
const PIN = besideRegion(SCALE, REGION.x0, REGION.x1, REGION.y0, 10);

/** At rest on the chart while the Region tool is armed and the drop is
    taken and noted; across to the chat panel's foot as the selection goes
    out, then up the panel to the message as it lands. */
const ASK_SHOTS: [Shot, ...Shot[]] = [
  // the chart column whole under the stock's header, the toolbar's tools
  // on it, the chat panel's edge beside it
  { at: 0, ...look(0, 0, REST, PAGE_SIZE) },
  // the panel from the toolbar's line down to the composer, the chart's
  // right half beside it
  { at: 5150, dur: 800, ...look(PAGE.w, PAGE.h, CHAT_REST, PAGE_SIZE) },
  // the panel from its header down, the message on top
  { at: 6200, dur: 750, ...look(PAGE.w, 0, CHAT_REST, PAGE_SIZE) },
];

/** On the Region button, clear of the pointer its own icon draws. */
const ON_REGION = { x: REGION_BTN.x + 2.5, y: REGION_BTN.y + 2.5 };

const ASK_PATH: Waypoint[] = [
  { at: 200, x: 238, y: 142 },
  { at: 850, ...ON_REGION },
  { at: 1450, ...ON_REGION },
  { at: 2150, ...onPage(REGION.x0, REGION.y0) },
  { at: 2250, ...onPage(REGION.x0, REGION.y0) },
  { at: 2950, ...onPage(REGION.x1, REGION.y1) },
  { at: 3200, ...onPage(REGION.x1 - 6, REGION.y1 + 8) },
  { at: 4100, ...onPage(BOX.left + 77, BOX.top + 8) },
  { at: 4450, ...onPage(BOX.left + 77, BOX.top + 8) },
  { at: 5250, ...SEND },
];

/** The drag in progress: the anchor corner to wherever the pointer is. */
function dragged(t: number) {
  if (t >= ASK.release) return REGION;
  const p = pointAt(ASK_PATH, Math.max(t, ASK.press));
  return { ...REGION, x1: p.x - CHART.x, y1: p.y - CHART.y };
}

function MarketAsk() {
  const { t: tr } = useTranslation();
  const t = useSceneTime();
  const sent = t >= ASK.send;
  const drawing = t >= ASK.press && !sent;
  return (
    <Camera shots={ASK_SHOTS} cursor={ASK_PATH} clicks={[ASK.arm, ASK.add, ASK.send]}>
      <MarketPage
        armed={t >= ASK.arm && t < ASK.release}
        chart={
          <Candles series={NVDA} scale={SCALE}>
            {drawing && t < ASK.added && <Selection {...dragged(t)} />}
            {drawing && t >= ASK.added && <Selection {...REGION} active={false} />}
            {t >= ASK.release && t < ASK.added && (
              <CommentBox
                left={BOX.left}
                top={BOX.top}
                pressed={t >= ASK.add}
                text={t >= ASK.type ? <Typed text={NOTE} at={ASK.type} cps={22} /> : undefined}
              />
            )}
            {t >= ASK.added && !sent && <Pin n={1} left={PIN.left} top={PIN.top} />}
          </Candles>
        }
        title={sent ? NOTE : undefined}
        chip={
          t >= ASK.added && !sent ? (
            <Appear at={ASK.added} pop className="flex min-w-0">
              <SelectionChip note={NOTE} />
            </Appear>
          ) : undefined
        }
        transcript={
          sent ? (
            <>
              <Sent at={ASK.send} />
              {t >= ASK.think && t < ASK.lead && (
                <Loader color="var(--color-icon-muted)" className="text-[10px]" />
              )}
              <Prose text={LEAD} at={ASK.lead} cps={60} />
            </>
          ) : undefined
        }
        composer={{ ready: t >= ASK.added && !sent, sendAt: [ASK.send] }}
      />
      {t >= ASK.tip && t < ASK.arm && (
        <Tip x={ON_REGION.x} y={REGION_BTN.y + 9}>
          {tr('marketView.selection.toolRegion')}
        </Tip>
      )}
    </Camera>
  );
}

/* ── marketDraw ────────────────────────────────────────────────────────── */

/** One `draw_chart_annotation` call: annotating while it runs, then the
    settled row naming the chart it drew on. */
function AnnotateRow({ at, done }: { at: number; done: number }) {
  const { t } = useTranslation();
  return (
    <ToolRow
      icon={PenLine}
      at={at}
      done={done}
      running={{ label: t('toolArtifact.inProgress.annotatingChart') }}
      settled={{ label: t('toolArtifact.tool.annotateChart'), pill: 'NVDA · 1D' }}
    />
  );
}

/** The chart's chip in the panel (`InlineChartAnnotationCard` beside the live
    chart): the first draw's place in the transcript, counting what is on the
    chart as later draws add to it. Hovered, its edge takes the accent. */
function ChartChip({ count, hover }: { count: number; hover: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className="intro-pop flex w-fit items-center gap-[4px] rounded-full border px-[5px] py-[3px] text-[6.5px] leading-none transition-colors"
      style={{
        background: 'var(--color-bg-tool-card)',
        borderColor: hover ? 'var(--color-accent-primary)' : 'var(--color-border-muted)',
        color: 'var(--color-text-tertiary)',
      }}
    >
      <Check className="h-[7px] w-[7px] shrink-0" style={{ color: 'var(--color-profit)' }} />
      <span className="whitespace-nowrap">
        <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          NVDA
        </span>
        {' · 1D · '}
        {t('chat.chartAnnotationCard.chipShownCount', { count })}
      </span>
    </span>
  );
}

/** Four draws, one per event, issued together and landing one by one: the
    first becomes the chip, the rest settle as rows under it. Each lands on
    the chart as it settles. */
const DRAW = {
  run: 250,
  dones: [1000, 1250, 1500, 1750],
  answer: 2000,
  hover: 3950,
  tip: 4250,
  leave: 4700,
  click: 6000,
  length: 8000,
};

const ANSWER =
  'A **new export rule** on Sep 8 took 3% off in a day, and the slide ran to **170.60**. The **Fed cut** on Sep 16 ended it.';

const EVENTS = [
  NVDA_EVENTS.earnings,
  NVDA_EVENTS.exportRule,
  NVDA_EVENTS.fedCut,
  NVDA_EVENTS.upgrade,
];
const DROP = NVDA_EVENTS.exportRule;

/** On the chip, in page px, and the bottom of it. */
const CHIP_AT = { x: CHAT_X + 46, y: 126 };
const CHIP_BOTTOM = 134;
/** The drop's badge, centered over its anchor. */
const BADGE = onPage(SCALE.x(DROP.i), SCALE.y(DROP.price) - 10.5);

/** On the chat panel the whole time the reply comes in, its message on top
    and the chart's right half beside it; then across to rest on the chart
    under the stock's header, where each move carries its badge, and the
    drop's story opens over the toolbar. */
const DRAW_SHOTS: [Shot, ...Shot[]] = [
  { at: 0, ...look(PAGE.w, 0, CHAT_REST, PAGE_SIZE) },
  // a quick pan, settled before the reply's last words can trail at the edge
  { at: 5300, dur: 600, ...look(0, 0, REST, PAGE_SIZE) },
];

const DRAW_PATH: Waypoint[] = [
  { at: 3300, x: CHAT_X + 120, y: 238 },
  { at: DRAW.hover, ...CHIP_AT },
  { at: DRAW.leave, ...CHIP_AT },
  { at: 5800, ...BADGE },
];

function MarketDraw() {
  const { t: tr } = useTranslation();
  const t = useSceneTime();
  const [first] = DRAW.dones;
  const count = DRAW.dones.filter((d) => t >= d).length;
  const hover = t >= DRAW.hover && t < DRAW.leave;
  return (
    <Camera shots={DRAW_SHOTS} cursor={DRAW_PATH} clicks={[DRAW.click]}>
      <MarketPage
        clear={t >= first}
        title={NOTE}
        chart={
          <Candles series={NVDA} scale={SCALE}>
            {EVENTS.map((ev, i) => (
              <EventBadge
                key={ev.title}
                scale={SCALE}
                ev={ev}
                at={DRAW.dones[i]}
                hover={ev === DROP && t >= 5800}
                open={ev === DROP && t >= DRAW.click + 60}
              />
            ))}
          </Candles>
        }
        transcript={
          <>
            <Sent at={-1} />
            <Prose text={LEAD} />
            {t < first ? (
              <AnnotateRow at={DRAW.run} done={first} />
            ) : (
              <ChartChip count={count} hover={hover} />
            )}
            <div className="flex flex-col">
              {DRAW.dones.slice(1).map((done) => (
                <AnnotateRow key={done} at={DRAW.run} done={done} />
              ))}
            </div>
            <Prose text={ANSWER} at={DRAW.answer} cps={80} />
          </>
        }
      />
      {t >= DRAW.tip && t < DRAW.leave && (
        <Tip x={CHIP_AT.x + 2} y={CHIP_BOTTOM + 3}>
          {tr('chat.chartAnnotationCard.chipShownTitle')}
        </Tip>
      )}
    </Camera>
  );
}

export const marketScenes = {
  marketAsk: { Scene: MarketAsk, length: ASK.length, anchor: 'center' },
  marketDraw: { Scene: MarketDraw, length: DRAW.length, anchor: 'center' },
} satisfies Partial<Record<IntroVisualId, IntroScene>>;
