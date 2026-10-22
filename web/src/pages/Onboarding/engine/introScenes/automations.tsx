import { useTranslation } from 'react-i18next';
import { BarChart3, CalendarSearch, Plus, Sun, TrendingUp, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { IntroVisualId } from '../../registry';
import {
  ALERT_INSTRUCTION,
  BRIEF_INSTRUCTION,
  DEFAULT_DAYS,
  LAST_EXCERPT,
  NEXT_EXCERPT,
  NEXT_MORNING,
  NVDA,
  useBook,
} from './automationBook';
import { askScene } from './automationAsk';
import { BriefRun, Day, FeedLayout, FeedRail, FiredRun, PreviewRun } from './automationFeed';
import {
  AlertGroup,
  AutomationRows,
  during,
  Field,
  FormActions,
  FormRow,
  FormTitle,
  Grow,
  Inspector,
  InstructionBox,
  Kicker,
  ManageLayout,
  MenuSurface,
  MoreToggle,
  Page,
  PageHeader,
  pressAt,
  PriceMeter,
  Readout,
  Segmented,
  TriggerChips,
  useSummary,
  WEEKDAYS,
  WeekPicker,
} from './automationParts';
import { CLOSE, Camera, REST, type Shot, VIEW, look } from './camera';
import { ease, useSceneTime } from './clock';
import { Appear, Caret, Typed } from './kit';
import type { IntroScene } from './types';

/* Scenes for the Automations page: making a price alert beside a weekday
   brief, the feed its runs land in, and sending a run's results to a chat
   app; setting one up in chat has its own file, automationAsk.tsx. Each
   part is a small copy of the page's own (automationParts.tsx); schedule
   lines, distances and times come from the page's formatters.
   Each scene draws the page alone at its own size, and a camera frames the
   part the step is about, pushing in on the detail and following the
   pointer. Shots and pointer paths are in page px. */
/* eslint-disable react-refresh/only-export-components -- scene module:
   private scene components, one record export */

/**
 * The shot at `at` whose view has its top-left corner on page point
 * (`left`, `top`) at `zoom`, for a shot whose edges have to fall in the gap
 * between two rows rather than through a line of text. A shot held against
 * the page's edges is set with `look` instead.
 */
function corner(at: number, left: number, top: number, zoom: number, dur?: number): Shot {
  return { at, dur, zoom, x: left + VIEW.width / 2 / zoom, y: top + VIEW.height / 2 / zoom };
}

/* ── automations · step 1: a trigger, on a schedule or a price ──────────── */

/** Making the price alert, played out over the manage view with the two
    schedules already in the list: New automation, the price template, NVDA
    typed in and the quote coming back, the level typed and the meter drawn,
    Create, and the alert taking its place under Watching. */
const TRIG = {
  clickNew: 1150,
  menu: 1230,
  clickTemplate: 2000,
  form: 2080,
  clickSymbol: 2850,
  typeSymbol: 2930,
  asking: 3230,
  quote: 3500,
  clickLevel: 3950,
  typeLevel: 4060,
  meter: 4300,
  clickCreate: 5650,
  saved: 5950,
  length: 7800,
};

/** Past the view's height by enough that the form's Create clears the
    pane's foot. */
const TRIG_PAGE = 340;
const TRIG_SIZE = { width: VIEW.width, height: TRIG_PAGE };

/** New automation, the price template, the symbol, the level, Create: where
    the pointer's tip lands on each. */
const TRIG_PATH = [
  { at: 300, x: 250, y: 200 },
  { at: 1000, x: 346, y: 36 },
  { at: 1350, x: 346, y: 36 },
  { at: 1900, x: 300, y: 113 },
  { at: 2200, x: 300, y: 113 },
  { at: 2750, x: 160, y: 177 },
  { at: 3600, x: 160, y: 177 },
  { at: 3850, x: 302, y: 177 },
  { at: 5000, x: 302, y: 177 },
  { at: 5550, x: 156, y: 313 },
];

/** The header's New and the menu it drops over the pane, the list's edge
    beside it; a short push in on the form as the symbol goes in and its
    quote comes back; back out, down the form to the level, the meter and
    Create; across to the list as the alert takes its row under Watching,
    its inspector beside it. */
const TRIG_SHOTS: [Shot, ...Shot[]] = [
  // the header's right and the pane under it, room below for the menu
  { at: 0, ...look(VIEW.width, 0, REST, TRIG_SIZE) },
  // under the header: the form from its title down to Instruction, the
  // pane edge to edge
  { at: 3000, dur: 800, ...look(VIEW.width, 160, CLOSE, TRIG_SIZE) },
  // under the header again, as the quote comes back: the form from its
  // title down to Create
  { at: 3900, dur: 400, ...look(VIEW.width, 190, REST, TRIG_SIZE) },
  // the header's census, the list's new Watching row, and the inspector's
  // title and meter beside it, Delete off the right
  { at: 6550, dur: 800, ...look(0, 0, REST, TRIG_SIZE) },
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
      <Glyph className="mt-px h-2 w-2 shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
      <span className="flex min-w-0 flex-col gap-[2px]">
        <span className="text-[7px] leading-[1.2]" style={{ color: 'var(--color-text-primary)' }}>
          {name}
        </span>
        <span className="text-[6px] leading-[1.3]" style={{ color: 'var(--color-text-tertiary)' }}>
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
      <div
        className="-mx-[3px] my-[3px] h-px"
        style={{ background: 'var(--color-border-muted)' }}
      />
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
          className={cn('mb-[3px] text-[5.5px] leading-none', mono)}
          style={{ color: 'var(--color-text-tertiary)' }}
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
      <span className={mono} style={{ color: 'var(--color-text-secondary)' }}>
        NVDA
      </span>
      {now < TRIG.quote ? (
        <span>…</span>
      ) : (
        <>
          <span className={mono} style={{ color: 'var(--color-text-primary)' }}>
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
  const summary = useSummary();
  const symbolFocus = during(now, TRIG.clickSymbol, TRIG.clickLevel);
  const levelFocus = during(now, TRIG.clickLevel, TRIG.clickCreate);
  const saving = now >= TRIG.clickCreate + 120;
  return (
    <div>
      <FormTitle>{t('automation.newAutomation')}</FormTitle>
      <div className="mt-[6px] border-b" style={{ borderColor: 'var(--color-border-muted)' }}>
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
                <span style={{ color: 'var(--color-text-tertiary)' }}>
                  {t('automation.priceSymbol')}
                </span>
              )}
            </Field>
            <Field chevron className="w-[86px]">
              {t('automation.priceConditionAbove')}
            </Field>
            <Field focus={levelFocus} className="w-[52px] font-mono tabular-nums">
              <span style={{ color: 'var(--color-text-tertiary)' }}>$</span>{' '}
              {now >= TRIG.typeLevel ? (
                <Typed text="190" at={TRIG.typeLevel} cps={14} />
              ) : (
                <span style={{ color: 'var(--color-text-tertiary)' }}>150.00</span>
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
    <Camera
      shots={TRIG_SHOTS}
      cursor={TRIG_PATH}
      clicks={[
        TRIG.clickNew,
        TRIG.clickTemplate,
        TRIG.clickSymbol,
        TRIG.clickLevel,
        TRIG.clickCreate,
      ]}
    >
      <Page height={TRIG_PAGE}>
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
        {/* the menu drops from New, its right edge on the button's */}
        <div className="absolute right-[12px] top-[45px] z-[5]">
          {during(now, TRIG.menu, TRIG.clickTemplate + 80) && (
            <Appear at={TRIG.menu} pop>
              <NewMenu hover={now >= TRIG_PATH[3].at - 150} />
            </Appear>
          )}
        </div>
      </Page>
    </Camera>
  );
}

/* ── automations · step 2: the feed ────────────────────────────────────── */

/** The feed as runs land in it: the $180 alert fires and its run slides in
    at the top, works, and finishes with what it found, over the morning's
    brief and the earnings preview that ran before it. The feed then scrolls
    down to those two, each done and a thread to open, the rail holding
    still beside it with the next scheduled times and the alert still
    watching. */
const FEED = {
  land: 900,
  done: 3000,
  scroll: 4300,
  /** The alert's run, once it has reported: the brief's entry then sits
      at the column's top edge. */
  scrollBy: 90,
  length: 7600,
};

/** At rest on the day's runs under the header, the rail's edge beside them,
    as the alert's run lands, works and reports, and as the feed scrolls on
    to the brief and the earnings preview; then across to the rail, Up next
    over the alert still watching, the runs' edge beside it. */
const FEED_SHOTS: [Shot, ...Shot[]] = [
  { at: 0, ...look(0, 0, REST) },
  { at: 6400, dur: 900, ...look(VIEW.width, 0, REST) },
];

function AutomationFeed() {
  const { t } = useTranslation();
  const now = useSceneTime();
  const census = [
    t('automation.censusScheduled', { count: 2 }),
    t('automation.censusWatching', { count: 1 }),
  ].join(' · ');
  return (
    <Camera shots={FEED_SHOTS}>
      <Page>
        <PageHeader census={census} view="feed" />
        <FeedLayout
          scroll={FEED.scrollBy * ease(now, FEED.scroll, 900)}
          runs={
            <>
              <Day label={t('automation.today')}>
                <FiredRun land={FEED.land} done={FEED.done} />
                <BriefRun />
                <PreviewRun />
              </Day>
              <Day label={t('automation.yesterday')}>
                <BriefRun excerpt={LAST_EXCERPT} />
              </Day>
            </>
          }
          rail={<FeedRail />}
        />
      </Page>
    </Camera>
  );
}

/* ── automations · step 3: delivery to a chat app ──────────────────────── */

/** Sending the brief's results to Slack: Edit on the brief, More options
    opened onto the place, the thread and Delivery, Add and Slack DM
    picked, Save changes; then the next morning's run in the feed, sent to
    Slack DM. */
const DLV = {
  clickEdit: 1000,
  form: 1080,
  clickMore: 2300,
  clickAdd: 3500,
  popover: 3580,
  clickDm: 4300,
  clickSave: 5250,
  feed: 5650,
  sent: 6200,
  length: 8200,
};

/** Edit, More options, Add, Slack DM, Save changes. */
const DLV_PATH = [
  { at: 300, x: 230, y: 200 },
  { at: 900, x: 251, y: 130 },
  { at: 1300, x: 251, y: 130 },
  { at: 2200, x: 160, y: 281 },
  { at: 2900, x: 160, y: 281 },
  { at: 3400, x: 150, y: 396 },
  { at: 3700, x: 150, y: 396 },
  { at: 4200, x: 190, y: 440 },
  { at: 4650, x: 190, y: 440 },
  { at: 5150, x: 166, y: 526 },
];

/** How tall the manage page is drawn: the edit form at full length, which
    the camera pans down as the page's scroller would. */
const DLV_PAGE = 560;
const DLV_SIZE = { width: VIEW.width, height: DLV_PAGE };

/** The brief's inspector and its Edit, the list's edge beside it; down the
    form to More options as it opens; a short push in on Delivery as its
    Add list opens, and back out as Slack DM is picked, down to Save; then
    a cut to the next morning's feed, at rest on the run and where it
    went. */
const DLV_SHOTS: [Shot, ...Shot[]] = [
  // the header's right and the pane under it: the brief's inspector and its
  // latest run
  { at: 0, ...look(VIEW.width, 0, REST, DLV_SIZE) },
  // over Instruction: More options and the rows it opens, down to Delivery
  corner(2450, 80, 220, REST, 900),
  // over Thread: Delivery, and the Add list under it, to the page's foot
  corner(3550, 117, 336, CLOSE),
  // Delivery down to Save changes, at the foot of the page
  { at: 4800, dur: 800, ...look(VIEW.width, DLV_PAGE, REST, DLV_SIZE) },
  // the cut to the next morning's feed: the header, and the runs with
  // where the brief's went, the rail's edge beside them
  corner(DLV.feed, 0, 3, REST, 1),
];

/** The Add list (`DeliveryPicker`): each app's Default and its chats, the
    DM first. App marks are left out; the app's name heads its section. */
function DeliveryList({ pick }: { pick: boolean }) {
  const { t } = useTranslation();
  const B = useBook();
  const heading = 'px-[5px] pb-[2px] pt-[2px] font-mono text-[5.5px] leading-none';
  const item = 'flex items-center gap-1 rounded-[3px] px-[5px] py-[3px] text-[6.5px] leading-none';
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
      <div className={heading} style={{ color: 'var(--color-text-tertiary)' }}>
        {t('automation.deliverToSlack')}
      </div>
      {slack.map(({ label, tag }, i) => (
        <div
          key={label}
          className={item}
          style={{
            color: 'var(--color-text-primary)',
            background: pick && i === 1 ? 'var(--color-bg-hover)' : undefined,
          }}
        >
          <span className="-my-px min-w-0 flex-1 truncate leading-[1.3]">{label}</span>
          {tag && (
            <span className="shrink-0 text-[5.5px]" style={{ color: 'var(--color-text-tertiary)' }}>
              {tag}
            </span>
          )}
        </div>
      ))}
      <div
        className="mt-[2px] border-t pt-[2px]"
        style={{ borderColor: 'var(--color-border-muted)' }}
      >
        <div className={heading} style={{ color: 'var(--color-text-tertiary)' }}>
          {t('automation.deliverToDiscord')}
        </div>
        <div className={item} style={{ color: 'var(--color-text-primary)' }}>
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
  const summary = useSummary();
  const day =
    'flex h-[15px] w-[15px] items-center justify-center rounded-[3px] border font-mono text-[6px]';
  return (
    <div>
      <FormTitle>{t('automation.editAutomation')}</FormTitle>
      <div className="mt-[6px] border-b" style={{ borderColor: 'var(--color-border-muted)' }}>
        <FormRow first className="border-t" label={t('common.name')}>
          <Field>{B.brief}</Field>
        </FormRow>
        <FormRow label={t('automation.fieldWhen')}>
          <TriggerChips value="cron" days={WEEKDAYS} />
          <div
            className="flex items-center gap-1 text-[7px]"
            style={{ color: 'var(--color-text-secondary)' }}
          >
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
                  className="inline-flex h-[14px] items-center gap-[3px] rounded-[3px] border pl-[5px] pr-[2px] text-[6.5px] leading-none"
                  style={{
                    borderColor: 'var(--color-border-muted)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  {B.deliverTo}
                  <X className="h-[6px] w-[6px]" style={{ color: 'var(--color-text-tertiary)' }} />
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
              className="h-[20px] rounded-[4px] border px-[5px] py-[3px] text-[6.5px] leading-none"
              style={{
                background: 'var(--color-bg-input)',
                borderColor: 'var(--color-border-muted)',
                color: 'var(--color-text-tertiary)',
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
  const feed = now >= DLV.feed;
  return (
    <Camera
      shots={DLV_SHOTS}
      cursor={feed ? undefined : DLV_PATH}
      clicks={[DLV.clickEdit, DLV.clickMore, DLV.clickAdd, DLV.clickDm, DLV.clickSave]}
    >
      {feed ? (
        // the next morning: the brief's run, sent where it was told, over
        // yesterday's
        <Appear at={DLV.feed}>
          <Page>
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
              rail={<FeedRail now={NEXT_MORNING} />}
            />
          </Page>
        </Appear>
      ) : (
        <Page height={DLV_PAGE}>
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
        </Page>
      )}
    </Camera>
  );
}

export const automationScenes = {
  // anchored right: New automation and the pane the form opens in
  automationTrigger: { Scene: AutomationTrigger, length: TRIG.length, anchor: 'right' },
  automationAsk: askScene,
  automationFeed: { Scene: AutomationFeed, length: FEED.length, anchor: 'left' },
  automationDelivery: { Scene: AutomationDelivery, length: DLV.length, anchor: 'right' },
} satisfies Partial<Record<IntroVisualId, IntroScene>>;
