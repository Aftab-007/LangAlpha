import type { CSSProperties } from 'react';
import { Eye, Newspaper, Paperclip, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocale } from '@/hooks/useLocale';
import { relativeTime } from '@/lib/format';
import type { IntroVisualId } from '../../registry';
import { ease, useSceneTime } from './clock';
import { Cursor, Frame, Typed, type Waypoint } from './kit';
import type { IntroScene } from './types';
import { WATCH, DashTopbar, PAGE, Floating, Composer, Widget } from './dashboardParts';
import { WatchRow, NEWS, NewsRow, AddSymbol } from './dashboardClassic';

/* The dashboard intro's last scene: clipping a row into the chat's context.
   Drawn after its real counterpart under pages/Dashboard (row paperclip,
   context deck), in miniature. */
/* eslint-disable react-refresh/only-export-components -- scene module:
   private scene components, one record export */

/* ── dashboard · step 3: clip a row into chat context ──────────────────── */

/** Clipping a row, played out: the pointer finds the news row's paperclip
    (it shows on hover), clicks, the row lands in the composer as a context
    card, then a question about it is typed and the pointer waits on send. */
const ATTACH = {
  hover: 850,
  click: 1200,
  leave: 1900,
  fly: 1280,
  flyDur: 520,
  focus: 2450,
  type: 2600,
  ask: 'Is this already priced in?',
  length: 5000,
};
const CLIP = { x: 225, y: 74 };
const COMPOSER = { x: 160, y: 285 };
const SEND = { x: 315, y: 302 };
/** The flying card's box: the clipped row, then its slot in the composer. */
const CARD_FROM = { x: 46, y: 63, w: 190 };
const CARD_TO = { x: 103, y: 245, w: 222 };
const ATTACH_PATH: Waypoint[] = [
  { at: 300, x: 320, y: 200 },
  { at: 1000, ...CLIP },
  { at: ATTACH.leave, ...CLIP },
  { at: 2400, ...COMPOSER },
  { at: 3700, ...COMPOSER },
  { at: 4300, ...SEND },
];

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
  const onClip = t >= 1000 && t < ATTACH.leave;
  const landed = t >= ATTACH.fly + ATTACH.flyDur;
  const fly = ease(t, ATTACH.fly, ATTACH.flyDur);
  return (
    <div className="relative w-full max-w-[400px]">
      <Frame topbar={<DashTopbar custom pencil />}>
        <div className={PAGE}>
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
        </div>
      </Frame>
      {/* the row on its way into the composer */}
      {t >= ATTACH.fly && !landed && (
        <ContextCard
          style={{
            position: 'absolute',
            pointerEvents: 'none',
            left: CARD_FROM.x + (CARD_TO.x - CARD_FROM.x) * fly,
            top: CARD_FROM.y + (CARD_TO.y - CARD_FROM.y) * fly,
            width: CARD_FROM.w + (CARD_TO.w - CARD_FROM.w) * fly,
            opacity: Math.min(fly * 4, 1),
          }}
        />
      )}
      <Cursor path={ATTACH_PATH} clicks={[ATTACH.click, ATTACH.focus]} />
    </div>
  );
}

export const dashboardAttachScenes = {
  dashboardAttach: { Scene: DashboardAttach, length: ATTACH.length, anchor: 'right' },
} satisfies Partial<Record<IntroVisualId, IntroScene>>;
