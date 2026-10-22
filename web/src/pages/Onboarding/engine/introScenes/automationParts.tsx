import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Pause,
  Pencil,
  Plus,
  Trash2,
  Zap,
} from 'lucide-react';
import { useLocale } from '@/hooks/useLocale';
import { fixed2 } from '@/lib/format';
import { cn } from '@/lib/utils';
import { weekdayInitials } from '@/pages/Automations/utils/time';
import { BRIEF_EXCERPT, NVDA, on, useBook } from './automationBook';
import { VIEW } from './camera';
import { ease, useSceneTime } from './clock';

/* The Automations page's parts at scene scale, each a small copy of the
   component named on it, in the page's tokens and labels: the header, the
   cadence marks and price meter, the list row, the form's hairline rows,
   and the feed's run entry. Each scene draws the page at its own size and
   a camera (camera.tsx) shows the part a step is about. */
/* eslint-disable react-refresh/only-export-components -- scene parts: small
   components plus the timing and ink helpers */

/** Whether `t` falls in `[from, to)`. */
export const during = (t: number, from: number, to: number) => t >= from && t < to;

/** The transform of a control pressed at `at`. */
export const pressAt = (t: number, at: number) =>
  during(t, at, at + 160) ? 'scale(0.92)' : undefined;

/** The page's inks: three text weights and the hairline. */
export const INK = {
  text: 'var(--iv-text)',
  text2: 'var(--iv-text-2)',
  text3: 'var(--iv-text-3)',
  hair: 'var(--color-border-muted)',
} as const;

/** Monday to Friday, Monday first, as the week strip and day picker read it. */
export const WEEKDAYS = [true, true, true, true, true, false, false] as const;

/** A section's heading (`.automations-kicker`): small mono capitals, set
    tight in Chinese, with an optional count after it. */
export function Kicker({
  children,
  count,
  className,
}: {
  children: ReactNode;
  count?: number;
  className?: string;
}) {
  const zh = useLocale().startsWith('zh');
  return (
    <div
      className={cn(
        'font-mono text-[0.34375rem] font-medium uppercase leading-none',
        !zh && 'tracking-[0.08em]',
        className
      )}
      style={{ color: INK.text3 }}
    >
      {children}
      {count != null && (
        <span className="ml-[3px] tabular-nums" style={{ color: 'var(--color-text-quaternary)' }}>
          {count}
        </span>
      )}
    </div>
  );
}

/** A two-way switch (`SegmentedControl`): the chosen side in the accent's
    soft fill and ink. */
export function Segmented({ options, value }: { options: string[]; value: number }) {
  return (
    <span
      className="inline-flex shrink-0 overflow-hidden rounded-[5px] border"
      style={{ borderColor: INK.hair }}
    >
      {options.map((label, i) => (
        <span
          key={label}
          className="whitespace-nowrap px-[5px] py-[3px] text-[0.40625rem] font-medium leading-none"
          style={
            i === value
              ? { background: 'var(--color-accent-soft)', color: 'var(--color-accent-primary)' }
              : { color: INK.text2 }
          }
        >
          {label}
        </span>
      ))}
    </span>
  );
}

/** A header action (`HeaderButton`): primary fill, secondary hairline, or a
    ghost with no edge. `pressed` is its transform. */
export function Btn({
  variant = 'secondary',
  pressed,
  className,
  children,
}: {
  variant?: 'primary' | 'secondary' | 'ghost';
  pressed?: string;
  className?: string;
  children: ReactNode;
}) {
  const look: CSSProperties =
    variant === 'primary'
      ? {
          background: 'var(--color-btn-primary-bg)',
          color: 'var(--color-btn-primary-text)',
          borderColor: 'transparent',
        }
      : variant === 'secondary'
        ? { color: INK.text2, borderColor: INK.hair }
        : { color: INK.text3, borderColor: 'transparent' };
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-[3px] whitespace-nowrap rounded-[4px] border',
        'px-1.5 py-[3px] text-[0.375rem] leading-none transition-transform duration-150',
        className
      )}
      style={{ ...look, transform: pressed }}
    >
      {children}
    </span>
  );
}

/** The page header (`AutomationsHeader`): the title over the census, or over
    the tagline while nothing is set up; then, once something is, the
    Feed / Manage switch and New automation. */
export function PageHeader({
  census,
  view,
  pressNew,
}: {
  census?: string;
  view?: 'feed' | 'manage';
  pressNew?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-[30px] shrink-0 items-end justify-between gap-2">
      <div className="min-w-0">
        <div
          className="text-[0.75rem] font-semibold leading-[1.2] tracking-[-0.01em]"
          style={{ color: INK.text }}
        >
          {t('automation.automations')}
        </div>
        {census ? (
          <div
            className="-mb-[0.75px] mt-[2.25px] truncate font-mono text-[0.375rem] leading-[1.25] tabular-nums"
            style={{ color: INK.text3 }}
          >
            {census}
          </div>
        ) : (
          <div className="mt-[3px] text-[0.4375rem] leading-none" style={{ color: INK.text2 }}>
            {t('automation.tagline')}
          </div>
        )}
      </div>
      {view && (
        <div className="flex shrink-0 items-center gap-[5px]">
          <Segmented
            options={[t('automation.viewFeed'), t('automation.viewManage')]}
            value={view === 'feed' ? 0 : 1}
          />
          <Btn variant="primary" pressed={pressNew} className="font-medium">
            <Plus className="h-[7px] w-[7px]" />
            {t('automation.newAutomation')}
            <ChevronDown className="h-[7px] w-[7px] opacity-70" />
          </Btn>
        </div>
      )}
    </div>
  );
}

/* ── cadence marks and the price meter ─────────────────────────────────── */

/** The days a schedule lands on (`WeekStrip`): weekday initials, the days it
    runs in full ink and the rest faded. */
export function WeekStrip({ days }: { days: readonly boolean[] }) {
  const initials = weekdayInitials(useLocale());
  return (
    <span
      className="grid grid-cols-[repeat(7,6px)] font-mono text-[0.34375rem] leading-[6px]"
      style={{ color: INK.text3 }}
      aria-hidden
    >
      {initials.map((initial, i) => (
        <span
          key={i}
          className="text-center"
          style={days[i] ? { color: INK.text } : { opacity: 0.45 }}
        >
          {initial}
        </span>
      ))}
    </span>
  );
}

/** The meter's track (`.automation-meter-track`): the line, the stretch still
    to travel dotted, the level in the accent, and the price as a dot knocked
    out of whatever it sits on. Positions are % of the track; `wash` is a
    tint the host lays over the page, which the knock-out takes too. */
function Track({
  cur,
  thr,
  gap,
  width,
  wash,
}: {
  cur?: number;
  thr?: number;
  gap?: [number, number];
  width?: number;
  wash?: string;
}) {
  return (
    <span className="relative block h-[6px]" style={{ width }} aria-hidden>
      <span className="absolute inset-x-0 top-[2.5px] h-px" style={{ background: INK.hair }} />
      {gap && gap[1] > 0 && (
        <span
          className="absolute top-[2.5px] h-0 border-t border-dotted"
          style={{ left: `${gap[0]}%`, width: `${gap[1]}%`, borderColor: INK.text3 }}
        />
      )}
      {thr != null && (
        <span
          className="absolute top-0 -ml-[0.5px] h-[6px] w-px"
          style={{ left: `${thr}%`, background: 'var(--color-accent-primary)' }}
        />
      )}
      {cur != null && (
        <span
          className="absolute top-px -ml-0.5 h-1 w-1 rounded-full"
          style={{
            left: `${cur}%`,
            background: INK.text,
            boxShadow: `0 0 0 1px ${wash ?? 'transparent'}, 0 0 0 1px var(--color-bg-page)`,
          }}
        />
      )}
    </span>
  );
}

/** A price watch's mark (`MeterMark`), at the week strip's width. */
export function MeterMark({ wash }: { wash?: string }) {
  return <Track width={42} cur={30} thr={72} gap={[30, 42]} wash={wash} />;
}

/** A one-time run's mark (`OnceMark`): one point on the track. */
export function OnceMark({ wash }: { wash?: string }) {
  return <Track width={42} cur={62} wash={wash} />;
}

/**
 * Where a price sits against the level that fires the run (`PriceMeter`),
 * on a scale fitted to the two with room either side, the numbers under each
 * end. The dotted stretch draws out from `at`.
 */
export function PriceMeter({
  symbol,
  current,
  threshold,
  at = 0,
}: {
  symbol: string;
  current: number;
  threshold: number;
  at?: number;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const p = ease(useSceneTime(), at, 700);
  const span = Math.abs(threshold - current);
  const pad = Math.max(span * 0.4, Math.abs(current) * 0.01);
  const lo = Math.min(current, threshold) - pad;
  const hi = Math.max(current, threshold) + pad;
  const pos = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const cur = pos(current);
  const thr = pos(threshold);
  const met = current >= threshold;
  return (
    <div>
      <Track
        cur={cur}
        thr={thr}
        gap={met ? undefined : [Math.min(cur, thr), Math.abs(thr - cur) * p]}
      />
      <div
        className={cn(
          'mt-[2px] flex justify-between gap-1 font-mono text-[0.34375rem] leading-none',
          'tabular-nums'
        )}
        style={{ color: INK.text3 }}
      >
        <span>
          <span style={{ color: INK.text2 }}>{symbol}</span> {fixed2(current, locale)}
        </span>
        <span>{t('automation.firesAt', { value: fixed2(threshold, locale) })}</span>
      </div>
    </div>
  );
}

/* ── the manage list ───────────────────────────────────────────────────── */

/** A row of the list (`AutomationList`): the name over its schedule line,
    what comes next at the end, the hover fill when chosen. */
export function ListRow({
  name,
  sub,
  trailing,
  selected = false,
}: {
  name: string;
  sub: string;
  trailing?: string;
  selected?: boolean;
}) {
  return (
    <div
      className="flex items-start gap-1 rounded-[4px] px-1 py-[4px] transition-colors duration-200"
      style={{ background: selected ? 'var(--color-bg-hover)' : undefined }}
    >
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-[0.40625rem] font-medium leading-[1.25]"
          style={{ color: INK.text }}
        >
          {name}
        </span>
        <span
          className="mt-px block truncate text-[0.34375rem] leading-[1.25]"
          style={{ color: INK.text3 }}
        >
          {sub}
        </span>
      </span>
      {trailing && (
        <span
          className="shrink-0 whitespace-nowrap pt-px text-[0.34375rem] leading-[1.25]"
          style={{ color: INK.text3 }}
        >
          {trailing}
        </span>
      )}
    </div>
  );
}

/* ── the form ──────────────────────────────────────────────────────────── */

/** One setting (`FormRow`), its name above its field the way the manage
    pane sets them; every row after the first opens on a hairline. */
export function FormRow({
  label,
  first = false,
  className,
  children,
}: {
  label: ReactNode;
  first?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn('flex flex-col gap-[4px] py-[5px]', !first && 'border-t', className)}
      style={{ borderColor: INK.hair }}
    >
      <div className="text-[0.4375rem] font-medium leading-[9px]" style={{ color: INK.text }}>
        {label}
      </div>
      {children}
    </div>
  );
}

/** A field on the form: the input fill on the page, the hairline edge, the
    accent edge while focused; `chevron` makes it a select. */
export function Field({
  focus = false,
  chevron = false,
  muted = false,
  className,
  style,
  children,
}: {
  focus?: boolean;
  chevron?: boolean;
  muted?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex h-4 min-w-0 items-center gap-[3px] rounded-[4px] border px-[5px]',
        'text-[0.4375rem] leading-none',
        className
      )}
      style={{
        background: 'var(--color-bg-input)',
        borderColor: focus ? 'var(--color-accent-primary)' : INK.hair,
        color: muted ? INK.text3 : INK.text,
        transition: 'border-color 120ms ease',
        ...style,
      }}
    >
      {/* a taller line than the field's, so the clip keeps descenders */}
      <span className="min-w-0 flex-1 truncate leading-[1.3]">{children}</span>
      {chevron && <ChevronDown className="h-[7px] w-[7px] shrink-0 opacity-60" />}
    </div>
  );
}

/** The kinds of trigger (`TriggerChoice`), each drawn with its cadence mark:
    the chosen one pressed, the others' marks faded. `days` is what the
    schedule's strip shows. */
export function TriggerChips({
  value,
  days,
}: {
  value: 'cron' | 'once' | 'price';
  days: readonly boolean[];
}) {
  const { t } = useTranslation();
  const kinds = [
    { id: 'cron', label: t('automation.triggerSchedule') },
    { id: 'once', label: t('automation.once') },
    { id: 'price', label: t('automation.triggerPrice') },
  ] as const;
  return (
    <div className="flex gap-1">
      {kinds.map((kind) => {
        const on = kind.id === value;
        const wash = on ? 'var(--color-bg-hover)' : undefined;
        return (
          <div
            key={kind.id}
            className={cn(
              'flex min-w-max max-w-[92px] flex-1 flex-col items-start gap-[4px] rounded-[4px]',
              'border px-1.5 py-[4px]'
            )}
            style={
              on
                ? { borderColor: INK.text2, background: 'var(--color-bg-hover)', color: INK.text }
                : { borderColor: INK.hair, color: INK.text2 }
            }
          >
            <span style={{ opacity: on ? 1 : 0.6 }}>
              {kind.id === 'cron' ? (
                <WeekStrip days={days} />
              ) : kind.id === 'once' ? (
                <OnceMark wash={wash} />
              ) : (
                <MeterMark wash={wash} />
              )}
            </span>
            <span className="text-[0.4375rem] font-medium leading-none">{kind.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/** What the trigger as set adds up to, read back under it. */
export function Readout({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('text-[0.4375rem] leading-[1.3]', className)} style={{ color: INK.text3 }}>
      {children}
    </div>
  );
}

/** The form's Create (or Save changes) and Cancel. */
export function FormActions({ label, pressed }: { label: string; pressed?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1 pt-[6px]">
      <span
        className={cn(
          'inline-flex h-[15px] items-center rounded-[4px] px-2 text-[0.4375rem] font-medium',
          'leading-none transition-transform duration-150'
        )}
        style={{
          background: 'var(--color-btn-primary-bg)',
          color: 'var(--color-btn-primary-text)',
          transform: pressed,
        }}
      >
        {label}
      </span>
      <span
        className="inline-flex h-[15px] items-center px-2 text-[0.4375rem] font-medium leading-none"
        style={{ color: INK.text }}
      >
        {t('common.cancel')}
      </span>
    </div>
  );
}

/** A dropdown's surface: the popover fill, a hairline, the menu shadow. */
export function MenuSurface({
  className,
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      className={cn('rounded-[5px] border p-[3px] shadow-md', className)}
      style={{ background: 'hsl(var(--popover))', borderColor: INK.hair, ...style }}
    >
      {children}
    </div>
  );
}

/* ── the feed ──────────────────────────────────────────────────────────── */

/** A link out of a run (`.automation-link`): Open thread, or Watch live. */
export function LinkOut({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-[2px] text-[0.375rem] leading-none"
      style={{ color: INK.text2 }}
    >
      {children}
      <ArrowUpRight className="h-[6px] w-[6px]" />
    </span>
  );
}

/** One run in the feed (`RunEntry` + `RunReport`): its time, the status
    glyph and name, the meta line, the start of what it said, and its links. */
export function RunEntry({
  time,
  glyph,
  name,
  meta,
  excerpt,
  actions,
}: {
  time: string;
  glyph?: ReactNode;
  name: string;
  meta: ReactNode;
  excerpt?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex gap-2 border-b py-[7px]" style={{ borderColor: INK.hair }}>
      <div
        className="w-[30px] shrink-0 whitespace-nowrap pt-px font-mono text-[0.375rem] leading-none tabular-nums"
        style={{ color: INK.text3 }}
      >
        {time}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-[4px]">
          {glyph && (
            <span className="inline-flex h-[8px] w-[7px] shrink-0 items-center justify-center">
              {glyph}
            </span>
          )}
          <span
            className="-my-px truncate text-[0.5rem] font-medium leading-[1.25]"
            style={{ color: INK.text }}
          >
            {name}
          </span>
        </div>
        <div
          className="mt-[3px] font-mono text-[0.34375rem] leading-[1.3] tabular-nums"
          style={{ color: INK.text3 }}
        >
          {meta}
        </div>
        {excerpt}
        {actions && <div className="mt-[5px] flex flex-wrap items-center gap-1">{actions}</div>}
      </div>
    </div>
  );
}

/** The start of what a run said (`.automation-run-excerpt`), up to three lines. */
export function Excerpt({ children }: { children: ReactNode }) {
  return (
    <p
      className="mt-[4px] line-clamp-3 text-[0.4375rem] leading-[1.5]"
      style={{ color: INK.text2 }}
    >
      {children}
    </p>
  );
}

/** Content that opens to its height as `p` goes 0 to 1, pushing what is
    below it down rather than landing on it. */
export function Grow({ p, children }: { p: number; children: ReactNode }) {
  return (
    <div className="grid" style={{ gridTemplateRows: `${p}fr`, opacity: Math.min(1, p * 1.5) }}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/* ── the page and its manage view ──────────────────────────────────────── */

/** The page at its own size under the camera: the Automations page alone,
    no app around it. `height` runs past the view for a pane the camera
    pans down, as the page's own scroller would. */
export function Page({ height = VIEW.height, children }: { height?: number; children: ReactNode }) {
  return (
    <div className="relative flex flex-col p-[12px]" style={{ width: VIEW.width, height }}>
      {children}
    </div>
  );
}

/** The manage view (`ManageView`): the list on the left, what it lists on
    the right, under a hairline; both columns clip as their scrollers do. */
export function ManageLayout({ list, pane }: { list: ReactNode; pane: ReactNode }) {
  return (
    <div
      className="mt-[10px] grid min-h-0 flex-1 grid-cols-[112px_minmax(0,1fr)] border-t"
      style={{ borderColor: INK.hair }}
    >
      <div
        className="min-h-0 overflow-hidden border-r pr-[6px] pt-[6px]"
        style={{ borderColor: INK.hair }}
      >
        {list}
      </div>
      <div className="relative min-h-0 overflow-hidden pl-[12px] pt-[10px]">{pane}</div>
    </div>
  );
}

/** The list: the brief and the review under Scheduled and, once it
    exists, the alert under Watching. */
export function AutomationRows({
  chosen,
  alert,
}: {
  chosen: 'brief' | 'alert' | null;
  alert: ReactNode;
}) {
  const { t } = useTranslation();
  const B = useBook();
  return (
    <div className="flex flex-col gap-[9px]">
      <div>
        <Kicker count={2} className="px-1 pb-[4px] pt-[2px]">
          {t('automation.groupScheduled')}
        </Kicker>
        <ListRow
          name={B.brief}
          sub={B.briefLine}
          trailing={B.nextBrief}
          selected={chosen === 'brief'}
        />
        <ListRow name={B.review} sub={B.reviewLine} trailing={B.nextReview} />
      </div>
      {alert}
    </div>
  );
}

export function AlertGroup({ selected }: { selected: boolean }) {
  const { t } = useTranslation();
  const B = useBook();
  return (
    <div>
      <Kicker count={1} className="px-1 pb-[4px] pt-[2px]">
        {t('automation.groupWatching')}
      </Kicker>
      <ListRow name={B.alert} sub={B.alertLine} trailing={B.away} selected={selected} />
    </div>
  );
}

/** One automation in the pane (`AutomationInspector`): the state and place,
    the name, the schedule in a sentence, the meter for a price watch, the
    actions, and the latest run: the brief's report, none yet for the new
    alert. `pressEdit` presses Edit. */
export function Inspector({ which, pressEdit }: { which: 'brief' | 'alert'; pressEdit?: string }) {
  const { t } = useTranslation();
  const B = useBook();
  const brief = which === 'brief';
  const icon = 'h-[6px] w-[6px]';
  return (
    <div>
      <Kicker>
        {[
          t(brief ? 'automation.stateScheduled' : 'automation.stateWatching'),
          t('agents.allWorkspaces'),
        ].join(' · ')}
      </Kicker>
      <div
        className="mt-[5px] text-[0.75rem] font-semibold leading-[1.2] tracking-[-0.01em]"
        style={{ color: INK.text }}
      >
        {brief ? B.brief : B.alert}
      </div>
      {/* two lines held, so the actions sit level in every language */}
      <p
        className="mt-[4px] min-h-[22px] text-[0.4375rem] leading-[1.55]"
        style={{ color: INK.text2 }}
      >
        {brief ? B.briefSentence : B.alertSentence}
      </p>
      {/* as wide a share of the pane as the app's meter takes of its own */}
      {!brief && (
        <div className="mt-[7px] max-w-[140px]">
          <div
            className="mb-[3px] font-mono text-[0.34375rem] leading-none tabular-nums"
            style={{ color: INK.text3 }}
          >
            {B.away}
          </div>
          <PriceMeter symbol="NVDA" current={NVDA.price} threshold={190} />
        </div>
      )}
      <div className="mt-[9px] flex flex-wrap items-center gap-1">
        <Btn>
          <Zap className={icon} />
          {t('automation.runNow')}
        </Btn>
        <Btn>
          <Pause className={icon} />
          {t('automation.pause')}
        </Btn>
        <Btn pressed={pressEdit}>
          <Pencil className={icon} />
          {t('automation.edit')}
        </Btn>
        <Btn variant="ghost" className="ml-auto">
          <Trash2 className={icon} />
          {t('common.delete')}
        </Btn>
      </div>
      {!brief && (
        <div className="mt-[14px]">
          <Kicker className="mb-[5px]">{t('automation.latestRun')}</Kicker>
          <p className="text-[0.4375rem] leading-[1.55]" style={{ color: INK.text3 }}>
            {t('automation.noRunsForThis')}
          </p>
        </div>
      )}
      {brief && (
        <div className="mt-[14px]">
          <Kicker className="mb-[5px]">{t('automation.latestRun')}</Kicker>
          <div
            className="rounded-[5px] border px-2 py-[7px]"
            style={{ background: 'var(--color-bg-card)', borderColor: INK.hair }}
          >
            <div
              className="font-mono text-[0.34375rem] leading-none tabular-nums"
              style={{ color: INK.text3 }}
            >
              {[t('automation.runCompleted'), B.moment(on(21, 8, 0)), B.took(252_000)].join(' · ')}
            </div>
            <Excerpt>{BRIEF_EXCERPT}</Excerpt>
            <div className="mt-[5px] flex">
              <LinkOut>{t('automation.openThread')}</LinkOut>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** The form's title, one step under the page's. */
export function FormTitle({ children }: { children: ReactNode }) {
  return (
    <div className="text-[0.5625rem] font-semibold leading-none" style={{ color: INK.text }}>
      {children}
    </div>
  );
}

/** The instruction box: the input fill, the text cut to two lines. */
export function InstructionBox({ text }: { text: string }) {
  return (
    <div
      className="rounded-[4px] border px-[5px] py-[3px] text-[0.40625rem] leading-[1.35]"
      style={{ background: 'var(--color-bg-input)', borderColor: INK.hair, color: INK.text }}
    >
      {/* clamped inside the padding, so a third line cannot show through it */}
      <p className="line-clamp-2">{text}</p>
    </div>
  );
}

/** The folded options' row (`MoreOptions`): its name and chevron, and while
    folded what they are set to, under it as the narrow pane sets it. */
export function MoreToggle({ open, summary }: { open: boolean; summary: string }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-col gap-[3px] border-t pb-[5px] pt-[5px]"
      style={{ borderColor: INK.hair }}
    >
      <span
        className="inline-flex items-center gap-[2px] text-[0.4375rem] font-medium leading-[9px]"
        style={{ color: open ? INK.text : INK.text2 }}
      >
        {t('automation.moreOptions')}
        <ChevronRight
          className="h-[7px] w-[7px] transition-transform duration-200"
          style={{ transform: open ? 'rotate(90deg)' : undefined }}
        />
      </span>
      {!open && (
        <span className="truncate text-[0.40625rem] leading-[9px]" style={{ color: INK.text3 }}>
          {summary}
        </span>
      )}
    </div>
  );
}

/** What the folded options say, as `MoreOptions` joins it. */
export function useSummary(delivery: string | null): string {
  const { t } = useTranslation();
  return [
    t('agents.allWorkspaces'),
    t('automation.continueExisting'),
    delivery ? t('automation.deliversTo', { method: delivery }) : t('automation.noDelivery'),
    t('automation.stopsAfter', { count: 3 }),
  ].join(' · ');
}

/** The schedule's days (`DayPicker`): seven squares, Monday to Friday pressed. */
export function WeekPicker({ className }: { className: string }) {
  const initials = weekdayInitials(useLocale());
  return (
    <div className="flex gap-[2px]">
      {initials.map((initial, i) => (
        <span
          key={i}
          className={className}
          style={
            WEEKDAYS[i]
              ? { borderColor: INK.text2, background: 'var(--color-bg-hover)', color: INK.text }
              : { borderColor: INK.hair, color: INK.text3 }
          }
        >
          {initial}
        </span>
      ))}
    </div>
  );
}
