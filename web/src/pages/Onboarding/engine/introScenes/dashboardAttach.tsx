import type { CSSProperties } from 'react';
import { Eye, Newspaper, Paperclip, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocale } from '@/hooks/useLocale';
import { relativeTime } from '@/lib/format';
import type { IntroVisualId } from '../../registry';
import { CLOSE, Camera, VIEW, look, type Shot } from './camera';
import { progress, useSceneTime } from './clock';
import { Typed, type Waypoint } from './kit';
import type { IntroScene } from './types';
import { WATCH, DashPage, PAGE_W, fromCorner, Floating, Composer, Widget } from './dashboardParts';
import { WatchRow, NEWS, NewsRow, AddSymbol } from './dashboardClassic';

/* The dashboard intro's last scene: clipping a row into the chat's context.
   Drawn after its real counterpart under pages/Dashboard (row paperclip,
   context deck), in miniature. */
/* eslint-disable react-refresh/only-export-components -- scene module:
   private scene components, one record export */

/* ── dashboard · step 3: clip a row into chat context ──────────────────── */

/** Clipping a row, played out: the pointer finds the news row's paperclip
    (it shows on hover), clicks, the row flies into the composer and lands as
    a context card, then a question about it is typed. */
const ATTACH = {
  hover: 900,
  click: 1350,
  leave: 1900,
  fly: 1450,
  flyDur: 1000,
  focus: 2750,
  type: 2900,
  ask: 'Is this already priced in?',
  length: 5000,
};
/** The page's height (a window's, so the chat floats at its foot). */
const ATTACH_H = 300;
/** Page px, read off the layout: the first row and its paperclip, the
    card in the composer's open deck, and the line its text goes on. */
const ROW = { x: 17, y: 34, w: 208, h: 36 };
const CLIP = { x: 216, y: 52 };
const CARD = { x: 89, y: 216, w: 222 };
const TEXT = { x: 198, y: 257 };
/** Where the crops' edges fall, in page px: between the watchlist's
    symbols and its prices; across the rows' pictures, before their titles;
    the line under the feed's header; above the headers' text; the foot of
    the composer; and the widgets' left padding, which puts the right edge
    of a view at the last shot's zoom between the watchlist's prices and
    their changes. */
const WATCH_NAMES_END = 300;
const PICTURES = 33;
const UNDER_HEADER = 31;
const OVER_HEADER = 15;
const COMPOSER_FOOT = 290;
const WIDGET_PAD = 12;
/** The flying card's box: the clipped row, then its slot in the deck. It
    eases in and out over the camera's move, so it rides along in view. */
const CARD_FROM = { x: ROW.x, y: ROW.y + 5, w: ROW.w };
const CARD_TO = CARD;
const ATTACH_PATH: Waypoint[] = [
  { at: 300, x: 150, y: 140 },
  { at: 1150, ...CLIP },
  { at: ATTACH.leave, ...CLIP },
  { at: 2650, ...TEXT },
];
/** The feed under its header, out to the watchlist's symbols, a touch
    closer than REST; a short push in on the rows as the paperclip is
    clicked; then out with the card as it flies down to the composer, a
    touch wider than REST so both widgets' headers and the composer's foot
    are in: the card it lands as is whole, and the question under it
    reads. */
const ATTACH_SHOTS: [Shot, ...Shot[]] = [
  { at: 0, ...look(0, 0, VIEW.width / WATCH_NAMES_END, { width: PAGE_W, height: ATTACH_H }) },
  { at: 1150, ...fromCorner(PICTURES, UNDER_HEADER, CLOSE), dur: 900 },
  {
    at: ATTACH.fly + ATTACH.flyDur,
    ...fromCorner(WIDGET_PAD, OVER_HEADER, VIEW.height / (COMPOSER_FOOT - OVER_HEADER)),
    dur: ATTACH.flyDur,
  },
];
/** The camera's move, which the flying card keeps pace with. */
const inOut = (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);

/** The context card a clipped row becomes in the composer: the story's
    title, then its source and when it ran, as the row's snapshot labels
    it. */
function ContextCard({ style }: { style?: CSSProperties }) {
  const locale = useLocale();
  return (
    <div
      className="flex items-center gap-1.5 rounded-md border p-1"
      style={{ background: 'var(--color-bg-card)', borderColor: 'var(--iv-border)', ...style }}
    >
      <span
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded"
        style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent-primary)' }}
      >
        <Newspaper className="h-2 w-2" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span
          className="truncate text-[0.4375rem] font-medium leading-none"
          style={{ color: 'var(--iv-text)' }}
        >
          News: {NEWS[0].title}
        </span>
        <span
          className="truncate text-[0.3125rem] leading-none"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          {NEWS[0].source} · {relativeTime(-NEWS[0].hours * 3_600_000, locale, 0)}
        </span>
      </span>
      <X className="h-2 w-2 shrink-0" style={{ color: 'var(--iv-text-3)' }} />
    </div>
  );
}

/** The deck over the composer's text: the count, then the card on top. */
function ContextDeck({ shown }: { shown: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-col gap-1 border-b border-dashed pb-1"
      style={{ borderColor: 'var(--iv-border)', visibility: shown ? 'visible' : 'hidden' }}
    >
      <span
        className={
          'flex items-center gap-1 px-0.5 font-mono text-[0.3125rem] uppercase leading-none ' +
          'tracking-[0.18em]'
        }
        style={{ color: 'var(--color-accent-primary)' }}
      >
        <span
          className="h-[3px] w-[3px] rounded-full"
          style={{ background: 'var(--color-accent-primary)' }}
        />
        {t('chat.widgetContext.inContext', { count: 1 })}
      </span>
      <ContextCard />
    </div>
  );
}

function DashboardAttach() {
  const { t: tr } = useTranslation();
  const t = useSceneTime();
  const hovered = t >= ATTACH.hover && t < ATTACH.leave + 150;
  const onClip = t >= 1150 && t < ATTACH.leave;
  const landed = t >= ATTACH.fly + ATTACH.flyDur;
  const fly = inOut(progress(t, ATTACH.fly, ATTACH.flyDur));
  return (
    <Camera shots={ATTACH_SHOTS} cursor={ATTACH_PATH} clicks={[ATTACH.click, ATTACH.focus]}>
      <DashPage height={ATTACH_H}>
        <div className="flex min-h-0 flex-1 gap-1.5">
          {/* news widget: the paperclip shows on the hovered row */}
          <Widget
            icon={Newspaper}
            title={tr('dashboard.widgets.newsFeed.header', {
              label: tr('dashboard.widgets.newsFeed.tab_market'),
            })}
            count="24"
            delay={0.12}
            className="flex-[1.5]"
          >
            {NEWS.map((item, i) => (
              <NewsRow key={item.title} item={item} hovered={i === 0 && hovered}>
                {i === 0 && (
                  <span
                    className={
                      'absolute right-0.5 top-1/2 flex h-3.5 w-3.5 -translate-y-1/2 ' +
                      'items-center justify-center rounded-full ' +
                      'transition-[opacity,background-color,color] duration-150'
                    }
                    style={{
                      opacity: hovered ? 1 : 0,
                      background: onClip ? 'var(--color-accent-soft)' : 'transparent',
                      color: onClip ? 'var(--color-accent-primary)' : 'var(--iv-text-3)',
                    }}
                  >
                    <Paperclip className="h-2 w-2" />
                  </span>
                )}
              </NewsRow>
            ))}
          </Widget>
          <Widget
            icon={Eye}
            title={tr('dashboard.widgets.watchlist.header')}
            count="5"
            delay={0.24}
            className="flex-1"
          >
            {WATCH.map((row) => (
              <WatchRow key={row.sym} row={row} />
            ))}
            <AddSymbol />
          </Widget>
        </div>
        {/* the floating chat: takes the clipped row, then the question */}
        <Floating>
          <Composer
            focused={t >= ATTACH.focus}
            delay={0.36}
            chip={
              /* opens while the card is on its way, so it lands in place */
              <div
                className="grid"
                style={{ gridTemplateRows: `${fly}fr`, marginBottom: (fly - 1) * 6 }}
              >
                <div className="min-h-0 overflow-hidden">
                  <ContextDeck shown={landed} />
                </div>
              </div>
            }
            text={t >= ATTACH.type ? <Typed text={ATTACH.ask} at={ATTACH.type} /> : undefined}
          />
        </Floating>
        {/* the row on its way into the composer */}
        {t >= ATTACH.fly && !landed && (
          <ContextCard
            style={{
              position: 'absolute',
              pointerEvents: 'none',
              left: CARD_FROM.x + (CARD_TO.x - CARD_FROM.x) * fly,
              top: CARD_FROM.y + (CARD_TO.y - CARD_FROM.y) * fly,
              width: CARD_FROM.w + (CARD_TO.w - CARD_FROM.w) * fly,
              // lifted off the row: solid at once, with the shadow a
              // carried card takes
              opacity: Math.min(fly * 12, 1),
              boxShadow: '0 6px 14px -6px rgba(0, 0, 0, 0.3)',
            }}
          />
        )}
      </DashPage>
    </Camera>
  );
}

export const dashboardAttachScenes = {
  dashboardAttach: { Scene: DashboardAttach, length: ATTACH.length, anchor: 'right' },
} satisfies Partial<Record<IntroVisualId, IntroScene>>;
