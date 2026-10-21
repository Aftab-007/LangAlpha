import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  CalendarSearch,
  Plus,
  Sun,
  TrendingUp,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { IntroVisualId } from '../../registry';
import { ease, useSceneTime } from './clock';
import { Appear, Caret, Cursor, Frame, Loader, Typed } from './kit';
import {
  AlertGroup,
  ALERT_INSTRUCTION,
  AutomationRows,
  BRIEF_EXCERPT,
  BRIEF_INSTRUCTION,
  Btn,
  DEFAULT_DAYS,
  during,
  Excerpt,
  FAILED,
  Field,
  FIRED,
  FormActions,
  FormRow,
  FormTitle,
  Grow,
  INK,
  Inspector,
  InstructionBox,
  Kicker,
  LinkOut,
  ManageLayout,
  MenuSurface,
  MoreToggle,
  NEXT_EXCERPT,
  NEXT_MORNING,
  NVDA,
  on,
  PageHeader,
  pressAt,
  PriceMeter,
  Readout,
  RunEntry,
  Segmented,
  TriggerChips,
  useBook,
  useSummary,
  WEEKDAYS,
  WeekPicker,
} from './automationParts';
import type { IntroScene } from './types';

/* Scenes for the Automations page: making a price alert beside a weekday
   brief, the feed its runs land in, and sending a run's results to a chat
   app. Each part is a small copy of the page's own (automationParts.tsx);
   schedule lines, distances and times come from the page's formatters. */
/* eslint-disable react-refresh/only-export-components -- scene module:
   private scene components, one record export */

/* ── automations · step 1: a trigger, on a schedule or a price ──────────── */

/** Making the price alert, played out over the manage view with the two
    schedules already in the list: New automation, the price template, NVDA typed in
    and the quote coming back, the level typed and the meter drawn, Create,
    and the alert taking its place under Watching. */
const TRIG = {
  clickNew: 950,
  menu: 1030,
  clickTemplate: 1800,
  form: 1880,
  clickSymbol: 2400,
  typeSymbol: 2480,
  asking: 2780,
  quote: 3050,
  clickLevel: 3450,
  typeLevel: 3560,
  meter: 3800,
  clickCreate: 4650,
  saved: 4950,
  length: 6300,
};

/** New automation, the price template, the symbol, the level, Create: where
    the pointer's tip lands on each. */
const TRIG_PATH = [
  { at: 200, x: 250, y: 300 },
  { at: 900, x: 352, y: 61 },
  { at: 1150, x: 352, y: 61 },
  { at: 1750, x: 296, y: 137 },
  { at: 1950, x: 296, y: 137 },
  { at: 2350, x: 183, y: 202 },
  { at: 3150, x: 183, y: 202 },
  { at: 3400, x: 326, y: 202 },
  { at: 4150, x: 326, y: 202 },
  { at: 4600, x: 180, y: 338 },
];

/** One item of the New menu: the template's icon, name and one line on it. */
function MenuItem({
  icon: Glyph,
  name,
  desc,
  hovered = false,
}: {
  icon: LucideIcon;
  name: string;
  desc: string;
  hovered?: boolean;
}) {
  return (
    <div
      className="flex items-start gap-[6px] rounded-[3px] px-[6px] py-[4px]"
      style={{ background: hovered ? 'var(--color-bg-hover)' : undefined }}
    >
      <Glyph className="mt-px h-2 w-2 shrink-0" style={{ color: INK.text3 }} />
      <span className="flex min-w-0 flex-col gap-[2px]">
        <span className="text-[0.4375rem] leading-[1.2]" style={{ color: INK.text }}>
          {name}
        </span>
        <span className="text-[0.375rem] leading-[1.3]" style={{ color: INK.text3 }}>
          {desc}
        </span>
      </span>
    </div>
  );
}

/** The New automation menu (`NewAutomationMenu`): a blank start, then the
    templates. `hover` lights the price template under the pointer. */
function NewMenu({ hover }: { hover: boolean }) {
  const { t } = useTranslation();
  const templates: [LucideIcon, string][] = [
    [TrendingUp, 'PriceAlert'],
    [Sun, 'MorningBriefing'],
    [BarChart3, 'WeeklyReview'],
    [CalendarSearch, 'EarningsWatch'],
  ];
  return (
    <MenuSurface className="w-[150px]">
      <MenuItem
        icon={Plus}
        name={t('automation.blankAutomation')}
        desc={t('automation.blankAutomationDesc')}
      />
      <div className="-mx-[3px] my-[3px] h-px" style={{ background: INK.hair }} />
      <Kicker className="px-[6px] pb-[3px] pt-[3px]">{t('automation.fromTemplate')}</Kicker>
      {templates.map(([icon, id], i) => (
        <MenuItem
          key={id}
          icon={icon}
          name={t(`automation.template${id}`)}
          desc={t(`automation.template${id}Desc`)}
          hovered={hover && i === 0}
        />
      ))}
    </MenuSurface>
  );
}

/** The price trigger's readout (`PriceReadout`): a hint, then the ticker
    while its quote is asked for, the quote, and with a level the meter. */
function PriceReadout() {
  const { t } = useTranslation();
  const B = useBook();
  const now = useSceneTime();
  const mono = 'font-mono tabular-nums';
  if (now >= TRIG.meter) {
    return (
      <Appear at={TRIG.meter} className="max-w-[190px]">
        <div
          className={cn('mb-[3px] text-[0.34375rem] leading-none', mono)}
          style={{ color: INK.text3 }}
        >
          {B.away}
        </div>
        <PriceMeter symbol="NVDA" current={NVDA.price} threshold={190} at={TRIG.meter} />
      </Appear>
    );
  }
  if (now < TRIG.asking) return <Readout>{t('automation.priceHint')}</Readout>;
  return (
    <Readout className="flex items-baseline gap-[4px]">
      <span className={mono} style={{ color: INK.text2 }}>
        NVDA
      </span>
      {now < TRIG.quote ? (
        <span>…</span>
      ) : (
        <>
          <span className={mono} style={{ color: INK.text }}>
            {B.price}
          </span>
          <span>
            <span className={mono} style={{ color: 'var(--color-profit)' }}>
              {B.move}%
            </span>{' '}
            {t('automation.quoteToday')}
          </span>
        </>
      )}
    </Readout>
  );
}

/** The new automation's form, filled in from the price template. */
function PriceForm() {
  const { t } = useTranslation();
  const B = useBook();
  const now = useSceneTime();
  const summary = useSummary(null);
  const symbolFocus = during(now, TRIG.clickSymbol, TRIG.clickLevel);
  const levelFocus = during(now, TRIG.clickLevel, TRIG.clickCreate);
  const saving = now >= TRIG.clickCreate + 120;
  const quiet = { color: INK.text3 };
  return (
    <div>
      <FormTitle>{t('automation.newAutomation')}</FormTitle>
      <div className="mt-[6px] border-b" style={{ borderColor: INK.hair }}>
        <FormRow first className="border-t" label={t('common.name')}>
          <Field>{B.alert}</Field>
        </FormRow>
        <FormRow label={t('automation.fieldWhen')}>
          <TriggerChips value="price" days={DEFAULT_DAYS} />
          <div className="flex items-center gap-1">
            <Field focus={symbolFocus} className="w-[44px] font-mono">
              {now >= TRIG.typeSymbol ? (
                <Typed text="NVDA" at={TRIG.typeSymbol} cps={16} />
              ) : symbolFocus ? (
                <Caret />
              ) : (
                <span style={quiet}>{t('automation.priceSymbol')}</span>
              )}
            </Field>
            <Field chevron className="w-[86px]">
              {t('automation.priceConditionAbove')}
            </Field>
            <Field focus={levelFocus} className="w-[52px] font-mono tabular-nums">
              <span style={quiet}>$</span>{' '}
              {now >= TRIG.typeLevel ? (
                <Typed text="190" at={TRIG.typeLevel} cps={14} />
              ) : (
                <span style={quiet}>150.00</span>
              )}
            </Field>
          </div>
          <div className="h-[24px]">
            <PriceReadout />
          </div>
        </FormRow>
        <FormRow label={t('automation.instruction')}>
          <InstructionBox text={ALERT_INSTRUCTION} />
        </FormRow>
        <MoreToggle open={false} summary={summary} />
      </div>
      <FormActions
        label={t(saving ? 'common.saving' : 'common.create')}
        pressed={pressAt(now, TRIG.clickCreate)}
      />
    </div>
  );
}

function AutomationTrigger() {
  const { t } = useTranslation();
  const now = useSceneTime();
  const saved = now >= TRIG.saved;
  const census = [
    t('automation.censusScheduled', { count: 2 }),
    ...(saved ? [t('automation.censusWatching', { count: 1 })] : []),
  ].join(' · ');
  const pane =
    now < TRIG.form ? (
      <Inspector which="brief" />
    ) : !saved ? (
      <Appear at={TRIG.form}>
        <PriceForm />
      </Appear>
    ) : (
      <Appear at={TRIG.saved}>
        <Inspector which="alert" />
      </Appear>
    );
  return (
    <div className="relative w-full max-w-[400px]">
      <Frame topbar={<span />}>
        <PageHeader census={census} view="manage" pressNew={pressAt(now, TRIG.clickNew)} />
        <ManageLayout
          list={
            <AutomationRows
              chosen={now < TRIG.form ? 'brief' : null}
              alert={
                <Appear at={TRIG.saved + 120}>
                  <AlertGroup selected />
                </Appear>
              }
            />
          }
          pane={pane}
        />
      </Frame>
      {/* the menu drops from New, its right edge on the button's */}
      <div className="absolute right-[11px] top-[73px] z-[5]">
        {during(now, TRIG.menu, TRIG.clickTemplate + 80) && (
          <Appear at={TRIG.menu} pop>
            <NewMenu hover={now >= TRIG_PATH[3].at - 150} />
          </Appear>
        )}
      </div>
      <Cursor
        path={TRIG_PATH}
        clicks={[
          TRIG.clickNew,
          TRIG.clickTemplate,
          TRIG.clickSymbol,
          TRIG.clickLevel,
          TRIG.clickCreate,
        ]}
      />
    </div>
  );
}

/* ── automations · step 2: the feed ────────────────────────────────────── */

/** The feed as runs land in it: the $180 alert fires and its run slides in
    at the top, works, and finishes with what it found. The rail beside it
    holds the failed run, the next scheduled times, and the alert still
    watching. */
const FEED = {
  land: 600,
  done: 2900,
  length: 4600,
};

/** The run the $180 alert started: live, then finished with its excerpt. */
function FiredRun() {
  const { t } = useTranslation();
  const B = useBook();
  const now = useSceneTime();
  const live = now < FEED.done;
  const place = t('agents.allWorkspaces');
  return (
    <Grow p={ease(now, FEED.land, 450)}>
      <RunEntry
        time={B.time(10, 12)}
        glyph={
          live ? (
            <Loader color="var(--color-accent-primary)" className="text-[0.5625rem]" />
          ) : undefined
        }
        name={FIRED.name}
        meta={
          live
            ? [
                t('automation.runRunning'),
                place,
                t('automation.startedAgo', { when: B.ago(on(21, 10, 13)) }),
              ].join(' · ')
            : [place, B.took(138_000)].join(' · ')
        }
        excerpt={
          !live && (
            <Grow p={ease(now, FEED.done, 450)}>
              <Excerpt>{FIRED.excerpt}</Excerpt>
            </Grow>
          )
        }
        actions={<LinkOut>{t(live ? 'automation.watchLive' : 'automation.openThread')}</LinkOut>}
      />
    </Grow>
  );
}

/** A run of the brief; `delivered` adds where it was sent, from `at`. */
function BriefRun({
  excerpt = BRIEF_EXCERPT,
  delivered,
  at = 0,
}: {
  excerpt?: string;
  delivered?: string;
  at?: number;
}) {
  const { t } = useTranslation();
  const B = useBook();
  const shown = useSceneTime() >= at;
  return (
    <RunEntry
      time={B.time(8, 0)}
      name={B.brief}
      meta={
        <>
          {[t('agents.allWorkspaces'), B.took(252_000)].join(' · ')}
          {delivered && (
            <span style={{ opacity: shown ? 1 : 0, transition: 'opacity 300ms ease' }}>
              {' · '}
              <span style={{ color: INK.text2 }}>
                {t('automation.deliveredVia', { method: delivered })}
              </span>
            </span>
          )}
        </>
      }
      excerpt={<Excerpt>{excerpt}</Excerpt>}
      actions={<LinkOut>{t('automation.openThread')}</LinkOut>}
    />
  );
}

/** The earnings preview's failed run, with its error and a Retry. */
function FailedRun() {
  const { t } = useTranslation();
  const B = useBook();
  return (
    <RunEntry
      time={B.time(6, 30)}
      glyph={
        <AlertCircle className="h-[6px] w-[6px]" style={{ color: 'var(--color-icon-danger)' }} />
      }
      name={FAILED.name}
      meta={[t('automation.runFailed'), FAILED.place, B.took(64_000)].join(' · ')}
      excerpt={
        <p
          className="mt-[4px] font-mono text-[0.375rem] leading-[1.5]"
          style={{ color: INK.text2 }}
        >
          {FAILED.error}
        </p>
      }
      actions={
        <>
          <Btn>{t('common.retry')}</Btn>
          <LinkOut>{t('automation.openThread')}</LinkOut>
        </>
      }
    />
  );
}

/** A section of the rail (`FeedRail`): its kicker over a hairline. */
function RailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <Kicker className="border-b pb-[4px]">{title}</Kicker>
      {children}
    </div>
  );
}

/** The rail: what needs attention, Up next, and what is watching. */
function FeedRail({ attention = true, now }: { attention?: boolean; now?: number }) {
  const { t } = useTranslation();
  const B = useBook(now);
  const rowLine = { borderColor: INK.hair };
  return (
    <div className="flex min-w-0 flex-col gap-[12px]">
      {attention && (
        <RailSection title={t('automation.groupAttention')}>
          <div className="flex items-start gap-[5px] border-b py-[5px]" style={rowLine}>
            <AlertCircle
              className="mt-px h-[6px] w-[6px] shrink-0"
              style={{ color: 'var(--color-icon-danger)' }}
            />
            <div className="min-w-0">
              <div className="text-[0.4375rem] leading-[1.25]" style={{ color: INK.text }}>
                {FAILED.name}
              </div>
              <div className="mt-px text-[0.34375rem] leading-[1.3]" style={{ color: INK.text3 }}>
                {t('automation.lastRunFailedAgo', { when: B.ago(on(21, 6, 31)) })}
              </div>
              <div className="mt-[5px] flex flex-wrap items-center gap-[3px]">
                <Btn>{t('common.retry')}</Btn>
                <Btn>{t('automation.pause')}</Btn>
                <Btn variant="ghost">{t('automation.dismiss')}</Btn>
              </div>
              <div className="mt-[4px] flex">
                <LinkOut>{t('automation.openThread')}</LinkOut>
              </div>
            </div>
          </div>
        </RailSection>
      )}
      <RailSection title={t('automation.upNext')}>
        <div className="grid grid-cols-[max-content_minmax(0,1fr)]">
          {B.upNext.map(([when, name]) => (
            <div
              key={name}
              className="col-span-2 grid grid-cols-subgrid gap-x-[8px] border-b py-[5px]"
              style={rowLine}
            >
              <span
                className="whitespace-nowrap font-mono text-[0.375rem] leading-[1.4] tabular-nums"
                style={{ color: INK.text2 }}
              >
                {B.upcoming(when)}
              </span>
              <span className="text-[0.4375rem] leading-[1.25]" style={{ color: INK.text }}>
                {name}
              </span>
            </div>
          ))}
        </div>
      </RailSection>
      <RailSection title={t('automation.groupWatching')}>
        <div className="border-b py-[6px]" style={rowLine}>
          <div className="flex items-baseline justify-between gap-1">
            <span className="truncate text-[0.4375rem] leading-[1.25]" style={{ color: INK.text }}>
              {B.alert}
            </span>
            <span
              className="shrink-0 font-mono text-[0.34375rem] tabular-nums"
              style={{ color: INK.text3 }}
            >
              {B.away}
            </span>
          </div>
          <div className="mt-[5px]">
            <PriceMeter symbol="NVDA" current={NVDA.price} threshold={190} />
          </div>
        </div>
      </RailSection>
      <span
        className="inline-flex items-center gap-[3px] text-[0.375rem] leading-none"
        style={{ color: INK.text2 }}
      >
        {t('automation.manageAll', { count: attention ? 4 : 3 })}
        <ArrowRight className="h-[6px] w-[6px]" />
      </span>
    </div>
  );
}

/** One day of the feed: its heading over a hairline, then its runs. */
function Day({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="[&+&]:mt-[10px]">
      <Kicker className="border-b pb-[4px]">{label}</Kicker>
      {children}
    </section>
  );
}

/** The feed view (`FeedView`): runs by day on the left, the rail on the
    right; the column clips at the window's edge, faded as a page runs on. */
function FeedLayout({ runs, rail }: { runs: ReactNode; rail: ReactNode }) {
  return (
    <div className="mt-[10px] grid h-[270px] grid-cols-[minmax(0,1fr)_124px] gap-[14px]">
      <div
        className="min-h-0 overflow-hidden"
        style={{
          WebkitMaskImage: 'linear-gradient(180deg, black 82%, transparent 100%)',
          maskImage: 'linear-gradient(180deg, black 82%, transparent 100%)',
        }}
      >
        {runs}
      </div>
      {rail}
    </div>
  );
}

function AutomationFeed() {
  const { t } = useTranslation();
  const census = [
    t('automation.censusScheduled', { count: 2 }),
    t('automation.censusWatching', { count: 1 }),
    t('automation.censusAttention', { count: 1 }),
  ].join(' · ');
  return (
    <Frame topbar={<span />}>
      <PageHeader census={census} view="feed" />
      <FeedLayout
        runs={
          <Day label={t('automation.today')}>
            <FiredRun />
            <BriefRun />
            <FailedRun />
          </Day>
        }
        rail={<FeedRail />}
      />
    </Frame>
  );
}

/* ── automations · step 3: delivery to a chat app ──────────────────────── */

/** Sending the brief's results to Slack: Edit on the brief, More options
    opened and the pane scrolled to it, the place and thread rows passed,
    Add on Delivery and Slack DM picked, Save changes; then the next
    morning's run in the feed, sent to Slack DM. */
const DLV = {
  clickEdit: 900,
  form: 980,
  clickMore: 1750,
  scroll: 1900,
  clickAdd: 2800,
  popover: 2880,
  clickDm: 3550,
  scrollMore: 3700,
  clickSave: 4500,
  feed: 4900,
  sent: 5500,
  length: 6900,
};

/** How far the pane scrolls: to the opened options, then on to Save. */
const DLV_SCROLL = [200, 26];

/** Edit, More options, Add, Slack DM, Save changes. */
const DLV_PATH = [
  { at: 200, x: 230, y: 310 },
  { at: 850, x: 278, y: 156 },
  { at: 1150, x: 278, y: 156 },
  { at: 1700, x: 182, y: 308 },
  { at: 2350, x: 182, y: 308 },
  { at: 2750, x: 177, y: 233 },
  { at: 3000, x: 177, y: 233 },
  { at: 3500, x: 196, y: 276 },
  { at: 3950, x: 196, y: 276 },
  { at: 4450, x: 186, y: 336 },
];

/** The Add list (`DeliveryPicker`): each app's Default and its chats, the
    DM first. App marks are left out; the app's name heads its section. */
function DeliveryList({ pick }: { pick: boolean }) {
  const { t } = useTranslation();
  const B = useBook();
  const heading = 'px-[5px] pb-[2px] pt-[2px] font-mono text-[0.34375rem] leading-none';
  const item =
    'flex items-center gap-1 rounded-[3px] px-[5px] py-[3px] text-[0.40625rem] leading-none';
  const slack: { label: string; tag?: string }[] = [
    {
      label: t('automation.deliveryDefaultOptionLands', { name: '#markets' }),
      tag: t('automation.deliveryViaPreferred'),
    },
    { label: B.deliverTo },
    { label: '#markets' },
  ];
  return (
    <MenuSurface className="w-[140px]">
      <div className={heading} style={{ color: INK.text3 }}>
        {t('automation.deliverToSlack')}
      </div>
      {slack.map(({ label, tag }, i) => (
        <div
          key={label}
          className={item}
          style={{
            color: INK.text,
            background: pick && i === 1 ? 'var(--color-bg-hover)' : undefined,
          }}
        >
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {tag && (
            <span className="shrink-0 text-[0.34375rem]" style={{ color: INK.text3 }}>
              {tag}
            </span>
          )}
        </div>
      ))}
      <div className="mt-[2px] border-t pt-[2px]" style={{ borderColor: INK.hair }}>
        <div className={heading} style={{ color: INK.text3 }}>
          {t('automation.deliverToDiscord')}
        </div>
        <div className={item} style={{ color: INK.text }}>
          {t('automation.deliveryDefaultOption')}
        </div>
      </div>
    </MenuSurface>
  );
}

/** The brief's edit form: its schedule, the instruction, and More options
    opened onto the place, the thread, and Delivery. */
function EditForm() {
  const { t } = useTranslation();
  const B = useBook();
  const now = useSceneTime();
  const open = now >= DLV.clickMore;
  const added = now >= DLV.clickDm + 60;
  const summary = useSummary(null);
  const scroll =
    DLV_SCROLL[0] * ease(now, DLV.scroll, 550) + DLV_SCROLL[1] * ease(now, DLV.scrollMore, 400);
  const day =
    'flex h-[15px] w-[15px] items-center justify-center rounded-[3px] border font-mono text-[0.375rem]';
  return (
    <div style={{ transform: `translateY(${-scroll}px)` }}>
      <FormTitle>{t('automation.editAutomation')}</FormTitle>
      <div className="mt-[6px] border-b" style={{ borderColor: INK.hair }}>
        <FormRow first className="border-t" label={t('common.name')}>
          <Field>{B.brief}</Field>
        </FormRow>
        <FormRow label={t('automation.fieldWhen')}>
          <TriggerChips value="cron" days={WEEKDAYS} />
          <div className="flex items-center gap-1 text-[0.4375rem]" style={{ color: INK.text2 }}>
            <Field chevron className="shrink-0">
              {t('automation.freqDays')}
            </Field>
            <span className="leading-none">{t('automation.atTime')}</span>
            <Field className="shrink-0 tabular-nums">{B.time(8, 0)}</Field>
            <span className="leading-none">{t('automation.inZone')}</span>
            <Field chevron className="min-w-0 flex-1">
              {B.zone}
            </Field>
          </div>
          <WeekPicker className={day} />
          <Readout>{B.briefReadout}</Readout>
        </FormRow>
        <FormRow label={t('automation.instruction')}>
          <InstructionBox text={BRIEF_INSTRUCTION} />
        </FormRow>
        <MoreToggle open={open} summary={summary} />
        <Grow p={ease(now, DLV.clickMore, 350)}>
          <FormRow label={t('thread.workspace')}>
            <Field chevron className="w-[120px]">
              {t('agents.allWorkspaces')}
            </Field>
          </FormRow>
          <FormRow label={t('automation.threadStrategy')}>
            <div className="flex">
              <Segmented
                options={[t('automation.newThreadEachRun'), t('automation.continueExisting')]}
                value={1}
              />
            </div>
          </FormRow>
          <FormRow label={t('automation.delivery')}>
            {added && (
              <Appear at={DLV.clickDm + 60} pop className="flex">
                <span
                  className="inline-flex h-[14px] items-center gap-[3px] rounded-[3px] border pl-[5px] pr-[2px] text-[0.40625rem] leading-none"
                  style={{ borderColor: INK.hair, color: INK.text }}
                >
                  {B.deliverTo}
                  <X className="h-[6px] w-[6px]" style={{ color: INK.text3 }} />
                </span>
              </Appear>
            )}
            <div className="relative">
              <Field
                chevron
                focus={during(now, DLV.popover, DLV.clickDm + 60)}
                className="w-fit pr-[4px]"
              >
                {t('automation.deliveryAdd')}
              </Field>
              {during(now, DLV.popover, DLV.clickDm + 80) && (
                <div className="absolute left-0 top-[19px] z-[5]">
                  <Appear at={DLV.popover} pop>
                    <DeliveryList pick={now >= DLV_PATH[7].at - 120} />
                  </Appear>
                </div>
              )}
            </div>
          </FormRow>
          <FormRow label={t('automation.maxFailures')}>
            <Field className="w-[32px] font-mono tabular-nums">3</Field>
          </FormRow>
          <FormRow label={t('common.description')}>
            <div
              className="h-[20px] rounded-[4px] border px-[5px] py-[3px] text-[0.40625rem] leading-none"
              style={{
                background: 'var(--color-bg-input)',
                borderColor: INK.hair,
                color: INK.text3,
              }}
            >
              {t('automation.descPlaceholder')}
            </div>
          </FormRow>
        </Grow>
      </div>
      <FormActions
        label={t(now >= DLV.clickSave + 120 ? 'common.saving' : 'automation.saveChanges')}
        pressed={pressAt(now, DLV.clickSave)}
      />
    </div>
  );
}

function AutomationDelivery() {
  const { t } = useTranslation();
  const B = useBook();
  const now = useSceneTime();
  const census = [
    t('automation.censusScheduled', { count: 2 }),
    t('automation.censusWatching', { count: 1 }),
  ].join(' · ');
  if (now >= DLV.feed) {
    // the next morning: the brief's run, sent where it was told, over
    // yesterday's
    return (
      <Appear at={DLV.feed} className="w-full max-w-[400px]">
        <Frame topbar={<span />}>
          <PageHeader census={census} view="feed" />
          <FeedLayout
            runs={
              <>
                <Day label={t('automation.today')}>
                  <BriefRun excerpt={NEXT_EXCERPT} delivered={B.deliverTo} at={DLV.sent} />
                </Day>
                <Day label={t('automation.yesterday')}>
                  <FiredRun />
                  <BriefRun />
                </Day>
              </>
            }
            rail={<FeedRail attention={false} now={NEXT_MORNING} />}
          />
        </Frame>
      </Appear>
    );
  }
  return (
    <div className="relative w-full max-w-[400px]">
      <Frame topbar={<span />}>
        <PageHeader census={census} view="manage" />
        <ManageLayout
          list={
            <AutomationRows
              chosen={now < DLV.form ? 'brief' : null}
              alert={<AlertGroup selected={false} />}
            />
          }
          pane={
            now < DLV.form ? (
              <Inspector which="brief" pressEdit={pressAt(now, DLV.clickEdit)} />
            ) : (
              <Appear at={DLV.form}>
                <EditForm />
              </Appear>
            )
          }
        />
      </Frame>
      <Cursor
        path={DLV_PATH}
        clicks={[DLV.clickEdit, DLV.clickMore, DLV.clickAdd, DLV.clickDm, DLV.clickSave]}
      />
    </div>
  );
}

export const automationScenes = {
  // anchored right: New automation and the pane the form opens in
  automationTrigger: { Scene: AutomationTrigger, length: TRIG.length, anchor: 'right' },
  automationFeed: { Scene: AutomationFeed, length: FEED.length, anchor: 'left' },
  automationDelivery: { Scene: AutomationDelivery, length: DLV.length, anchor: 'right' },
} satisfies Partial<Record<IntroVisualId, IntroScene>>;
