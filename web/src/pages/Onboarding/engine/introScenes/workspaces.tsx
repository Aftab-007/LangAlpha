import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, GripVertical, Pin, Plus, Search, Server, Upload, X } from 'lucide-react';
import { HomeRowIcon } from '@/hooks/useHomeWorkspace';
import { useLocale } from '@/hooks/useLocale';
import { shortMonthDay } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { IntroVisualId } from '../../registry';
import { progress, useSceneTime } from './clock';
import { Appear, Caret, Cursor, Frame, Ln, Loader, Region, Typed, rv } from './kit';
import type { IntroScene } from './types';
import type { Icon } from './chatParts';

/* Scenes for the workspace gallery: the gallery page, and creating a
   workspace over it. Each part is a small copy of the component the app
   draws it with (named on each), in the same tokens and labels. */
/* eslint-disable react-refresh/only-export-components -- scene module:
   private scene components, one record export */

/** Whether `t` falls in `[from, to)`. */
const during = (t: number, from: number, to: number) => t >= from && t < to;

/* ── chat · step 4: the workspace gallery page ─────────────────────────── */

/** An outlined header button, as the gallery draws its secondary actions. */
function OutlineButton({
  icon: Glyph,
  color = 'var(--iv-text-3)',
  children,
}: {
  icon?: Icon;
  color?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-1',
        'text-[0.4375rem] leading-none'
      )}
      style={{ borderColor: 'var(--color-border-muted)', color }}
    >
      {Glyph && <Glyph className="h-2 w-2" />}
      {children}
    </span>
  );
}

/** The gallery's header (`WorkspaceGallery`, `GalleryActions`): the title,
    then Computers and New workspace. `pressNew` presses New. */
function GalleryHeader({
  pressNew,
  className,
  style,
}: {
  pressNew?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn('flex items-center gap-1.5', className)} style={style}>
      <span
        className="mr-auto text-[0.75rem] font-semibold leading-none tracking-[-0.01em]"
        style={{ color: 'var(--iv-text)' }}
      >
        {t('workspace.workspaces')}
      </span>
      <OutlineButton icon={Server} color="var(--iv-text-2)">
        <span className="font-medium">{t('computer.computers', 'Computers')}</span>
      </OutlineButton>
      <span
        className={cn(
          'flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1',
          'transition-transform duration-150'
        )}
        style={{
          background: 'var(--color-btn-primary-bg)',
          color: 'var(--color-btn-primary-text)',
          transform: pressNew,
        }}
      >
        <Plus className="h-2 w-2" />
        <span className="text-[0.4375rem] font-medium leading-none">
          {t('workspace.newWorkspace')}
        </span>
      </span>
    </div>
  );
}

/** A workspace card as the new-workspace modal's backdrop draws it: the
    name and description as skeleton lines, All workspaces as the flat
    elevated card with the home glyph, the way the gallery sets it apart. */
function WsCard({
  home = false,
  delay,
  className = '',
}: {
  home?: boolean;
  delay?: number;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <Region
      delay={delay}
      className={cn('flex min-w-0 flex-col gap-1.5 px-2.5 py-2', className)}
      style={
        home
          ? { background: 'var(--color-bg-elevated)', borderColor: 'var(--color-border-default)' }
          : undefined
      }
    >
      {home ? (
        <>
          <div className="flex items-center gap-1">
            <HomeRowIcon
              className="h-2.5 w-2.5 shrink-0"
              style={{ color: 'var(--color-accent-primary)' }}
            />
            <span
              className="truncate text-[0.5625rem] font-medium leading-none"
              style={{ color: 'var(--iv-text)' }}
            >
              {t('agents.allWorkspaces')}
            </span>
          </div>
          <span
            className="truncate text-[0.4375rem] leading-none"
            style={{ color: 'var(--iv-text-3)' }}
          >
            {t('agents.widgets.allWorkspacesDesc')}
          </span>
        </>
      ) : (
        <>
          <Ln w="52%" h={4} c="var(--iv-line-2)" />
          <Ln w="82%" />
        </>
      )}
      <div className="mt-auto">
        <Ln w="34%" h={2} c="var(--iv-line-3)" />
      </div>
    </Region>
  );
}

/** The machine every workspace in the gallery runs on, and the moments it
    goes from stopped to starting to running. */
type MachineState = 'stopped' | 'starting' | 'running';

/** A machine's state as `ComputerStatusIndicator` draws it: a hollow ring,
    the loader, or a filled dot, then the state's name. */
function MachineStatus({ state }: { state: MachineState }) {
  const { t } = useTranslation();
  const glyph =
    state === 'starting' ? (
      <Loader color="var(--color-accent-primary)" className="text-[0.375rem]" />
    ) : (
      <span
        className="h-[4px] w-[4px] shrink-0 rounded-full"
        style={
          state === 'running'
            ? { background: 'var(--color-profit)' }
            : { border: '1px solid var(--color-text-tertiary)' }
        }
      />
    );
  const label = {
    stopped: t('computer.statusStopped'),
    starting: t('computer.statusStarting'),
    running: t('computer.statusRunning'),
  }[state];
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {glyph}
      {label}
    </span>
  );
}

/** One workspace in the gallery: its name, what it is for, and when it last
    changed. `ran` is when an agent finishes work in it, from which it reads
    as updated today. */
interface Desk {
  name: string;
  description: string;
  updated: Date;
  pinned?: boolean;
  ran?: number;
}

/**
 * A card in the gallery (`WorkspaceCard`): name, one line of description,
 * the machine it runs on with that machine's state, and when it was updated.
 * All workspaces is the flat elevated card with the home glyph and no
 * machine line; every other card sits on the card fill.
 */
function GalleryCard({
  desk,
  home = false,
  machine,
}: {
  desk: Desk;
  home?: boolean;
  machine: MachineState;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const now = useSceneTime();
  const fresh = desk.ran != null && now >= desk.ran;
  const tertiary = { color: 'var(--iv-text-3)' };
  return (
    <div
      className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-lg border py-2 pl-2.5 pr-2"
      style={
        home
          ? { background: 'var(--color-bg-elevated)', borderColor: 'var(--color-border-default)' }
          : {
              background: 'var(--color-bg-card-gradient)',
              borderColor: 'var(--color-bg-card-border)',
            }
      }
    >
      <div className="flex min-w-0 items-center gap-1">
        {home && (
          <HomeRowIcon
            className="h-2.5 w-2.5 shrink-0"
            style={{ color: 'var(--color-accent-primary)' }}
          />
        )}
        {desk.pinned && <Pin className="h-2 w-2 shrink-0 rotate-45" style={tertiary} />}
        <span
          className="truncate text-[0.5625rem] font-medium leading-none"
          style={{ color: 'var(--iv-text)' }}
        >
          {desk.name}
        </span>
      </div>
      <span className="line-clamp-1 text-[0.4375rem] leading-[1.3]" style={tertiary}>
        {desk.description}
      </span>
      {!home && (
        <span
          className="flex min-w-0 items-center gap-1 text-[0.375rem] leading-none"
          style={tertiary}
        >
          <Server className="h-[7px] w-[7px] shrink-0" />
          <span className="truncate">Cloud computer</span>
          <MachineStatus state={machine} />
        </span>
      )}
      <span
        key={fresh ? 'fresh' : 'old'}
        className={cn('mt-auto block text-[0.375rem] leading-none', fresh && 'intro-rv')}
        style={{ ...rv(0), ...tertiary }}
      >
        {t('workspace.updated', {
          time: shortMonthDay(fresh ? GRID.today : desk.updated, locale),
        })}
      </span>
    </div>
  );
}

/** The gallery, kept calm: the cards come in, the one machine they share
    starts (each card's machine line turns at once), then two of them read
    as updated today as agents finish work in them. Sorted by activity:
    All workspaces, the pinned card, then the most recently updated. */
const GRID = {
  cards: [150, 270, 390, 510],
  starting: 1500,
  running: 2500,
  today: new Date(2026, 9, 21),
  desks: [
    {
      name: 'NVDA deep dive',
      description: 'Q3 print vs guidance, data-center demand and a reverse DCF.',
      updated: new Date(2026, 9, 20),
      pinned: true,
      ran: 3300,
    },
    {
      name: 'Portfolio monitoring',
      description: 'Daily risk check on current holdings and earnings dates.',
      updated: new Date(2026, 9, 19),
      ran: 4200,
    },
    {
      name: 'AI semis comps',
      description: 'Nine-name comps table on NTM multiples, refreshed weekly.',
      updated: new Date(2026, 9, 17),
    },
  ] satisfies Desk[],
  length: 4800,
};

function WorkspaceGrid() {
  const { t } = useTranslation();
  const now = useSceneTime();
  const machine: MachineState =
    now >= GRID.running ? 'running' : now >= GRID.starting ? 'starting' : 'stopped';
  const home: Desk = {
    name: t('agents.allWorkspaces'),
    description: t('agents.widgets.allWorkspacesDesc'),
    updated: GRID.today,
  };
  return (
    // the gallery page has no title bar of its own, only the window's strip
    <Frame topbar={<span />}>
      <div className="flex flex-1 flex-col gap-2">
        <GalleryHeader className="intro-rv" style={rv(0.08)} />
        {/* search */}
        <Region delay={0.16} className="flex items-center gap-1.5 px-2 py-1.5">
          <Search className="h-2.5 w-2.5 shrink-0" style={{ color: 'var(--iv-text-3)' }} />
          <span className="text-[0.5rem] leading-none" style={{ color: 'var(--iv-text-3)' }}>
            {t('workspace.searchWorkspaces')}
          </span>
        </Region>
        {/* sort */}
        <div className="intro-rv flex items-center justify-end gap-1.5" style={rv(0.2)}>
          <span className="text-[0.4375rem] leading-none" style={{ color: 'var(--iv-text-3)' }}>
            {t('workspace.sortBy')}
          </span>
          <OutlineButton>{t('workspace.activity')}</OutlineButton>
          <OutlineButton icon={GripVertical}>{t('workspace.reorder')}</OutlineButton>
        </div>
        <div className="grid flex-1 auto-rows-fr grid-cols-2 gap-2">
          {[home, ...GRID.desks].map((desk, i) => (
            <Appear key={i} at={GRID.cards[i]} reserve className="flex min-w-0">
              <GalleryCard desk={desk} home={i === 0} machine={machine} />
            </Appear>
          ))}
        </div>
      </div>
    </Frame>
  );
}

/* ── chat · step 5: the new-workspace modal over the gallery ───────────── */

/** Creating a workspace, played out: the pointer clicks New workspace, the
    modal opens, the name and description type in, a click on the drop zone
    adds two files, and the pointer clicks Create. Pointer positions are px
    in the 400px scene, matched to the fixed-size mockup below. */
const NEW_WS = {
  name: 'NVDA earnings deep-dive',
  desc: 'Q1 print vs. guidance, data-center demand…',
  clickNew: 1000,
  modal: 1150,
  typeName: 1550,
  clickDesc: 2650,
  typeDesc: 2800,
  clickDrop: 4500,
  files: [4650, 4850],
  upload: 700,
  clickCreate: 6100,
  length: 6800,
};

/** New workspace, then the description's free space past its text, the
    drop zone's browse link, and Create. Each point sits 2px up and left of
    its target, where the pointer's tip lands; on Create it lands in the
    padding past the label, so the finished frame still reads it. */
const NEW_WS_PATH = [
  { at: 200, x: 232, y: 236 },
  { at: 950, x: 296, y: 46 },
  { at: 1800, x: 296, y: 46 },
  { at: 2600, x: 300, y: 134 },
  { at: 4000, x: 300, y: 134 },
  { at: 4450, x: 230, y: 223 },
  { at: 5500, x: 230, y: 223 },
  { at: 6050, x: 321, y: 291 },
];

/** A field's text typed in place: an invisible copy of the finished text
    holds the line's size, so nothing around it moves while it types. A
    focused field that has not started typing shows the caret. */
function TypedInPlace({ text, at, focus }: { text: string; at: number; focus: boolean }) {
  const t = useSceneTime();
  return (
    <span className="grid">
      <span className="invisible [grid-area:1/1]">{text}</span>
      <span className="[grid-area:1/1]">
        <Typed text={text} at={at} />
        {focus && t < at && <Caret />}
      </span>
    </span>
  );
}

/** A field's label, as the modal sets it: the name, then a required mark or
    an optional note. */
function FieldLabel({ children, required = false }: { children: ReactNode; required?: boolean }) {
  const { t } = useTranslation();
  return (
    <span className="text-[0.5rem] font-medium leading-none" style={{ color: 'var(--iv-text)' }}>
      {children}{' '}
      {required ? (
        <span style={{ color: 'var(--color-loss)' }}>*</span>
      ) : (
        <span className="text-[0.4375rem] font-normal" style={{ color: 'var(--iv-text-2)' }}>
          {t('common.optional')}
        </span>
      )}
    </span>
  );
}

/** A text field in the modal: the card fill, and the accent edge while focused. */
function field(focus: boolean): CSSProperties {
  return {
    background: 'var(--color-bg-card)',
    borderColor: focus ? 'var(--color-accent-primary)' : 'var(--color-border-muted)',
  };
}

/** A file added to the new workspace: its upload bar fills from `at`, then
    the row reads as the modal lists a file, size and remove. Its space is
    held so the modal does not grow. */
function UploadRow({ name, size, at }: { name: string; size: string; at: number }) {
  const t = useSceneTime();
  const p = progress(t, at, NEW_WS.upload);
  return (
    <Appear
      at={at}
      reserve
      className="flex items-center gap-1.5 rounded border px-1.5 py-1"
      style={{ background: 'var(--color-bg-tag)', borderColor: 'var(--color-border-muted)' }}
    >
      <FileText className="h-2 w-2 shrink-0" style={{ color: 'var(--iv-text-2)' }} />
      <span className="truncate text-[0.4375rem] leading-none" style={{ color: 'var(--iv-text)' }}>
        {name}
      </span>
      <span className="ml-auto flex h-2 items-center gap-1">
        {p < 1 ? (
          <span
            className="block h-0.5 w-8 overflow-hidden rounded-full"
            style={{ background: 'var(--color-border-muted)' }}
          >
            <span
              className="block h-full rounded-full"
              style={{
                width: `${p * 100}%`,
                background: 'var(--color-accent-primary)',
                transition: 'width 90ms linear',
              }}
            />
          </span>
        ) : (
          <>
            <span className="text-[0.375rem] leading-none" style={{ color: 'var(--iv-text-2)' }}>
              {size}
            </span>
            <X className="h-1.5 w-1.5" style={{ color: 'var(--iv-text-2)' }} />
          </>
        )}
      </span>
    </Appear>
  );
}

function CreateWorkspace() {
  const { t } = useTranslation();
  const now = useSceneTime();
  const open = now >= NEW_WS.modal;
  const press = (at: number) => (during(now, at, at + 160) ? 'scale(0.92)' : undefined);
  const nameFocus = during(now, NEW_WS.modal, NEW_WS.clickDesc);
  const descFocus = during(now, NEW_WS.clickDesc, NEW_WS.clickDrop);
  const overDrop = during(now, NEW_WS_PATH[5].at, NEW_WS_PATH[6].at);
  const typed = 'text-[0.5rem] leading-none';
  return (
    <div className="relative w-full max-w-[400px]">
      {/* this scene is center-anchored: the gallery fades into the panel at
          both edges instead of hard-cropping on one side, and dims behind
          the modal once it opens */}
      <div
        style={{
          opacity: open ? 0.45 : 1,
          transition: 'opacity 300ms ease',
          WebkitMaskImage:
            'linear-gradient(90deg, transparent 0, black 18%, black 82%, transparent 100%)',
          maskImage:
            'linear-gradient(90deg, transparent 0, black 18%, black 82%, transparent 100%)',
        }}
      >
        <Frame>
          <div className="flex flex-col gap-2">
            {/* the New workspace button the pointer clicks */}
            <GalleryHeader pressNew={press(NEW_WS.clickNew)} className="mr-14" />
            <div className="grid grid-cols-2 gap-2">
              <WsCard home delay={0} className="h-16" />
              <WsCard delay={0} className="h-16" />
              <WsCard delay={0} className="h-16" />
              <WsCard delay={0} className="h-16" />
            </div>
          </div>
        </Frame>
      </div>
      {/* the modal the click opens (`CreateWorkspaceModal`): name,
          description, files, Create. Centering transform lives on a static
          wrapper — the pop animates `transform` and would clobber translate
          utilities on itself. */}
      <div className="absolute left-1/2 top-1/2 w-[72%] -translate-x-1/2 -translate-y-1/2">
        <Appear
          at={NEW_WS.modal}
          pop
          className="rounded-[10px] border p-3"
          style={{
            background: 'var(--color-bg-elevated)',
            borderColor: 'var(--color-border-muted)',
          }}
        >
          <div className="flex items-center justify-between">
            <span
              className="text-[0.625rem] font-semibold leading-none"
              style={{ color: 'var(--iv-text)' }}
            >
              {t('workspace.createNewWorkspace')}
            </span>
            <X className="h-2.5 w-2.5" style={{ color: 'var(--iv-text)' }} />
          </div>
          <div className="mt-2.5 flex flex-col gap-1">
            {/* name, focused when the modal opens */}
            <FieldLabel required>{t('workspace.workspaceName')}</FieldLabel>
            <div className="rounded border px-1.5 py-1" style={field(nameFocus)}>
              <span className={typed} style={{ color: 'var(--iv-text)' }}>
                <TypedInPlace text={NEW_WS.name} at={NEW_WS.typeName} focus={nameFocus} />
              </span>
            </div>
            {/* description, a three-line box */}
            <div className="mt-1.5">
              <FieldLabel>{t('common.description')}</FieldLabel>
            </div>
            <div className="h-9 rounded border px-1.5 py-1" style={field(descFocus)}>
              <span className={typed} style={{ color: 'var(--iv-text)' }}>
                <TypedInPlace text={NEW_WS.desc} at={NEW_WS.typeDesc} focus={descFocus} />
              </span>
            </div>
            {/* files, added after the workspace is created */}
            <div className="mt-1.5">
              <FieldLabel>{t('workspace.files')}</FieldLabel>
            </div>
            <span className="text-[0.375rem] leading-none" style={{ color: 'var(--iv-text-2)' }}>
              {t('workspace.filesUploadNote')}
            </span>
            <div
              className={cn(
                'mt-0.5 flex flex-col items-center gap-1 rounded-md border border-dashed',
                'py-2'
              )}
              style={{
                borderColor: overDrop ? 'var(--color-accent-primary)' : 'var(--color-border-muted)',
              }}
            >
              <Upload className="h-3 w-3" style={{ color: 'var(--iv-text-2)' }} />
              <span className="text-[0.4375rem] leading-none" style={{ color: 'var(--iv-text-2)' }}>
                {t('workspace.dragFilesHere')}
                <span className="font-medium" style={{ color: 'var(--color-accent-primary)' }}>
                  {t('workspace.clickToBrowse')}
                </span>
              </span>
            </div>
            <UploadRow name="NVDA_10-Q.pdf" size="2.4 MB" at={NEW_WS.files[0]} />
            <UploadRow name="dc-demand.xlsx" size="186 KB" at={NEW_WS.files[1]} />
            <div className="flex items-center justify-end gap-1.5 pt-1.5">
              <span
                className="px-2 py-1 text-[0.5rem] font-medium leading-none"
                style={{ color: 'var(--iv-text)' }}
              >
                {t('common.cancel')}
              </span>
              <span
                className={cn(
                  'rounded px-2 py-1 text-[0.5rem] font-medium leading-none',
                  'transition-transform duration-150'
                )}
                style={{
                  background: 'var(--color-btn-primary-bg)',
                  color: 'var(--color-btn-primary-text)',
                  transform: press(NEW_WS.clickCreate),
                }}
              >
                {t('common.create')}
              </span>
            </div>
          </div>
        </Appear>
      </div>
      <Cursor
        path={NEW_WS_PATH}
        clicks={[NEW_WS.clickNew, NEW_WS.clickDesc, NEW_WS.clickDrop, NEW_WS.clickCreate]}
      />
    </div>
  );
}

export const workspaceScenes = {
  workspaceGrid: { Scene: WorkspaceGrid, length: GRID.length, anchor: 'left' },
  // centered: the scene fades its own edges instead of bleeding one side
  createWorkspace: { Scene: CreateWorkspace, length: NEW_WS.length, anchor: 'center' },
} satisfies Partial<Record<IntroVisualId, IntroScene>>;
