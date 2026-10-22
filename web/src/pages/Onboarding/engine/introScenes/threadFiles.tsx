import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowUpDown,
  BookMarked,
  CandlestickChart,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FilePlus,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  Globe,
  HardDrive,
  Maximize2,
  PanelRight,
  Pencil,
  RefreshCw,
  ScrollText,
  Search,
  Settings,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { IntroVisualId } from '../../registry';
import { BarChart, type Bar } from './charts';
import { CLOSE, Camera, REST, look, type Shot } from './camera';
import { useSceneTime } from './clock';
import { Appear, UserBubble, type Waypoint } from './kit';
import {
  ChromeIcon,
  PanelTab,
  Prose,
  ThreadPage,
  Timeline,
  ToolRow,
  iconStyle,
} from './threadParts';
import type { IntroScene } from './types';

/* The thread intro's first step: the files a turn writes land in the file
   panel's tree, and a click there opens one in the panel. The thread page is
   drawn whole and the camera crops it to the part each beat is about. */
/* eslint-disable react-refresh/only-export-components -- scene module:
   private scene components, one record export */

/** The Analyst's turn: a line of narration, a read of the names to comp,
    three writes (each landing in the tree as it finishes), and the answer.
    Then the pointer opens the report from the tree, the narrow panel's tree
    folds away, and the report shows in the HTML viewer. The tree sorts as
    the app's does: root files first, then results/ and data/, names A to Z
    within. Positions are px on the thread page: the report's row sits at
    y 141 in the tree (x 284 to 400). */
const FILES = {
  ask: 'Comp NVDA against AI semis',
  lead: 'Pulling NTM estimates and prices for the nine names.',
  leadAt: 250,
  read: { name: 'universe.csv', at: 650, done: 1050 },
  writes: [
    { name: 'prices.csv', at: 1150 },
    { name: 'comps.xlsx', at: 1700 },
    { name: 'report.html', at: 2250 },
  ],
  write: 450,
  answer:
    'Done. NVDA trades at **24.1x** NTM sales against a 9.8x median. ' +
    'The write-up is in `results/report.html`.',
  answerAt: 2800,
  path: [
    { at: 4200, x: 262, y: 248 },
    { at: 5000, x: 322, y: 141 },
    { at: 5400, x: 322, y: 141 },
    { at: 6000, x: 300, y: 360 },
  ] satisfies Waypoint[],
  click: 5200,
  open: 5280,
  bars: 5900,
  length: 8600,
};

/** The camera: on the chat column whole, from its header to the answer,
    with the panel's empty tab beside it, as the turn runs and the answer
    names the report; across to the panel as the pointer goes to the tree
    the files landed in, held there as the report opens in its place; then
    in on the report's note and figure as the bars draw. */
const FILE_SHOTS: [Shot, ...Shot[]] = [
  { at: 0, ...look(160, 132, REST) },
  { at: 4500, dur: 900, ...look(240, 132, REST) },
  { at: 7700, dur: 1000, ...look(267, 156, CLOSE) },
];

/** EV / NTM sales across the nine names in comps.xlsx, high to low. */
const EV_SALES: Bar[] = [
  { label: 'ARM', value: 30.2, shown: '30.2x' },
  { label: 'NVDA', value: 24.1, shown: '24.1x', mark: true },
  { label: 'AVGO', value: 22.6, shown: '22.6x' },
  { label: 'TSM', value: 10.4, shown: '10.4x' },
  { label: 'AMD', value: 9.8, shown: '9.8x' },
  { label: 'MRVL', value: 9.1, shown: '9.1x' },
  { label: 'QCOM', value: 4.3, shown: '4.3x' },
  { label: 'MU', value: 4.2, shown: '4.2x' },
  { label: 'INTC', value: 2.9, shown: '2.9x' },
];

/** What an empty tab shows beside the tree (`EmptyTab`): where a file comes
    from, and that the tab can be a chart instead. Its dotted ground is the
    app's. */
function EmptyTab() {
  const { t } = useTranslation();
  return (
    <div
      className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-2 text-center"
      style={{
        backgroundImage: 'radial-gradient(var(--color-border-muted) 1px, transparent 0)',
        backgroundSize: '10px 10px',
      }}
    >
      <FolderOpen className="h-4 w-4" style={iconStyle} />
      <span
        className="text-[0.5rem] font-medium leading-none"
        style={{ color: 'var(--iv-text-2)' }}
      >
        {t('filePanel.openFile')}
      </span>
      <span
        className={cn(
          'mt-0.5 flex items-center gap-1 rounded border px-1.5 py-1',
          'text-[0.4375rem] font-medium leading-none'
        )}
        style={{
          background: 'var(--color-bg-card)',
          borderColor: 'var(--color-border-default)',
          color: 'var(--iv-text)',
        }}
      >
        <CandlestickChart className="h-[7px] w-[7px] shrink-0" />
        {t('filePanel.openChart')}
      </span>
    </div>
  );
}

/** The tree column (`TreeColumn`): its toolbar, the search field, Memory and
    Memo pinned above the listing, then the listing. */
function TreeColumn({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex w-[116px] shrink-0 flex-col border-l"
      style={{ borderColor: 'var(--iv-border)' }}
    >
      <div className="flex items-center gap-[5px] px-1.5 pb-1 pt-1.5">
        {[CheckSquare, Upload, HardDrive, RefreshCw, ArrowUpDown].map((icon, i) => (
          <ChromeIcon key={i} icon={icon} />
        ))}
        <span className="ml-auto flex">
          <ChromeIcon icon={Settings} />
        </span>
      </div>
      <div className="px-1 pb-1">
        <div
          className="flex h-3.5 items-center gap-1 rounded border px-1"
          style={{ background: 'var(--color-bg-input)', borderColor: 'var(--color-border-muted)' }}
        >
          <Search className="h-[7px] w-[7px] shrink-0" style={iconStyle} />
          <span className="truncate text-[0.375rem] leading-none" style={iconStyle}>
            {t('filePanel.searchFiles')}
          </span>
        </div>
      </div>
      <div className="border-b pb-0.5" style={{ borderColor: 'var(--iv-border)' }}>
        <TreeFile icon={BookMarked} name={t('filePanel.tabs.memory')} />
        <TreeFile icon={ScrollText} name={t('filePanel.tabs.memo')} />
      </div>
      <div className="flex flex-col pt-0.5">{children}</div>
    </div>
  );
}

/** A file in the tree, listed from `at`: its kind's glyph (as `fileGlyph`
    picks it), then the name. `hover` is the row under the pointer. */
function TreeFile({
  icon: Icon = FileText,
  name,
  nested = false,
  at = 0,
  hover = false,
}: {
  icon?: LucideIcon;
  name: string;
  nested?: boolean;
  at?: number;
  hover?: boolean;
}) {
  return (
    <Appear
      at={at}
      className="flex min-w-0 items-center gap-1 py-[3px] pr-1.5"
      style={{
        paddingLeft: nested ? 16 : 6,
        background: hover ? 'var(--color-bg-hover)' : undefined,
      }}
    >
      <Icon className="h-[7px] w-[7px] shrink-0" style={iconStyle} />
      <span className="truncate text-[0.4375rem] leading-none" style={{ color: 'var(--iv-text)' }}>
        {name}
      </span>
    </Appear>
  );
}

/** A folder in the tree: chevron, folder, `name/` and how many files it
    holds. The tree is built from the files, so a folder is listed from its
    first file (`at`), open from `openAt`. */
function TreeFolder({
  name,
  count,
  at = 0,
  openAt = at,
}: {
  name: string;
  count: number;
  at?: number;
  openAt?: number;
}) {
  const t = useSceneTime();
  const Chevron = t >= openAt ? ChevronDown : ChevronRight;
  return (
    <Appear at={at} className="flex min-w-0 items-center gap-[3px] py-[3px] pl-1 pr-1.5">
      <Chevron className="h-[7px] w-[7px] shrink-0" style={iconStyle} />
      <Folder className="h-[7px] w-[7px] shrink-0" style={iconStyle} />
      <span className="truncate text-[0.4375rem] font-medium leading-none" style={iconStyle}>
        {name}/
      </span>
      <span className="text-[0.4375rem] leading-none" style={{ color: 'var(--color-icon-muted)' }}>
        {count}
      </span>
    </Appear>
  );
}

/** Preview or Source in the HTML viewer's toolbar; the one showing sits on
    the accent's soft fill. */
function ViewTab({ active = false, children }: { active?: boolean; children: ReactNode }) {
  return (
    <span
      className="rounded-[3px] border px-1.5 py-[3px] text-[0.375rem] font-medium leading-none"
      style={
        active
          ? {
              background: 'var(--color-accent-soft)',
              borderColor: 'var(--color-accent-overlay)',
              color: 'var(--iv-text)',
            }
          : { borderColor: 'var(--color-border-muted)', color: 'var(--iv-text-3)' }
      }
    >
      {children}
    </span>
  );
}

/** An open file's header (`FileCrumbs`): the path, one segment per folder,
    then how long the file is and its actions. */
function Crumbs({ path, lines }: { path: string[]; lines: number }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex h-[18px] shrink-0 items-center gap-1.5 border-b pl-2 pr-1.5"
      style={{ borderColor: 'var(--color-border-muted)' }}
    >
      <span className="flex min-w-0 items-center gap-[1px] text-[0.4375rem] leading-none">
        {path.map((seg, i) => {
          const file = i === path.length - 1;
          return (
            <span key={seg} className="flex items-center gap-[1px]">
              {i > 0 && (
                <ChevronRight
                  className="h-[7px] w-[7px] shrink-0"
                  style={{ color: 'var(--color-icon-muted)' }}
                />
              )}
              <span
                className="truncate px-[2px]"
                style={{ color: file ? 'var(--iv-text)' : 'var(--iv-text-3)' }}
              >
                {seg}
              </span>
            </span>
          );
        })}
      </span>
      <span className="ml-auto shrink-0 text-[0.4375rem] leading-none" style={iconStyle}>
        {t('filePanel.metaLines', { count: lines })}
      </span>
      <ChromeIcon icon={Download} />
      <ChromeIcon icon={Pencil} />
    </div>
  );
}

/** The report the turn wrote, open in the HTML viewer (`HtmlViewer`): its
    Preview / Source toolbar, then the page as the agent laid it out, a
    titled note with its figure, the subject's bar in the accent. */
function ReportView() {
  const { t } = useTranslation();
  const text = { color: 'var(--iv-text-2)' };
  return (
    <Appear at={FILES.open} className="flex min-h-0 flex-1 flex-col">
      <Crumbs path={['results', 'report.html']} lines={64} />
      <div
        className="flex shrink-0 items-center gap-1 border-b px-1.5 py-1"
        style={{ borderColor: 'var(--color-border-muted)' }}
      >
        <ViewTab active>{t('filePanel.htmlPreview')}</ViewTab>
        <ViewTab>{t('filePanel.htmlSource')}</ViewTab>
        <span className="ml-auto flex items-center gap-1.5">
          <ChromeIcon icon={Maximize2} />
          <ChromeIcon icon={ExternalLink} />
        </span>
      </div>
      <div className="flex flex-1 flex-col px-3 pb-2 pt-2.5">
        <span
          className="text-[0.3125rem] font-medium uppercase leading-none tracking-[0.08em]"
          style={iconStyle}
        >
          AI semis · Oct 21, 2026
        </span>
        <span
          className="mt-1.5 font-serif text-[0.6875rem] font-semibold leading-[1.15]"
          style={{ color: 'var(--iv-text)' }}
        >
          Where NVDA sits in the AI semis
        </span>
        <p className="mt-1.5 text-[0.4375rem] leading-[1.55]" style={text}>
          At $182.42, NVDA trades at 24.1x NTM sales, well above the 9.8x median of the nine names.
          Only ARM screens richer, on a far smaller revenue base.
        </p>
        <span
          className="mt-2.5 text-[0.375rem] font-semibold leading-none"
          style={{ color: 'var(--color-accent-primary)' }}
        >
          Figure 1.{' '}
          <span className="font-normal" style={text}>
            EV / NTM sales, dashed line at the median
          </span>
        </span>
        <BarChart
          bars={EV_SALES}
          max={32}
          median={9.8}
          at={FILES.bars}
          labelWidth={20}
          surface="var(--iv-mk-bg)"
          className="mt-1.5"
        />
        <span className="mt-2 text-[0.3125rem] leading-none" style={iconStyle}>
          Source: comps.xlsx, NTM consensus as of Oct 21
        </span>
      </div>
    </Appear>
  );
}

function FilePanel() {
  const t = useSceneTime();
  const { t: tr } = useTranslation();
  const [prices, comps, report] = FILES.writes.map((w) => w.at + FILES.write);
  const opened = t >= FILES.open;
  const hover = t >= FILES.path[1].at && !opened;
  return (
    <Camera shots={FILE_SHOTS} cursor={FILES.path} clicks={[FILES.click]}>
      <ThreadPage
        title="Semis comps"
        tabs={
          opened ? (
            <PanelTab icon={Globe} label="report.html" active onLoan />
          ) : (
            <PanelTab icon={FolderOpen} label={tr('filePanel.openFile')} active />
          )
        }
        actions={<ChromeIcon icon={PanelRight} on={!opened} />}
        chat={
          <>
            <UserBubble at={0}>{FILES.ask}</UserBubble>
            <Prose text={FILES.lead} at={FILES.leadAt} />
            <Timeline>
              <ToolRow
                icon={FileText}
                running={{ label: tr('toolArtifact.running.read'), pill: FILES.read.name }}
                settled={{ label: tr('toolArtifact.tool.read'), pill: FILES.read.name }}
                at={FILES.read.at}
                done={FILES.read.done}
              />
              {FILES.writes.map((w) => (
                <ToolRow
                  key={w.name}
                  icon={FilePlus}
                  running={{ label: tr('toolArtifact.running.write'), pill: w.name }}
                  settled={{ label: tr('toolArtifact.tool.write'), pill: w.name }}
                  at={w.at}
                  done={w.at + FILES.write}
                />
              ))}
            </Timeline>
            <Prose text={FILES.answer} at={FILES.answerAt} cps={140} />
          </>
        }
        panel={
          opened ? (
            <ReportView />
          ) : (
            <div className="flex flex-1">
              <EmptyTab />
              <TreeColumn>
                <TreeFile name="notes.md" />
                <TreeFolder name="results" count={t >= report ? 2 : 1} at={comps} />
                <TreeFile nested icon={FileSpreadsheet} name="comps.xlsx" at={comps} />
                <TreeFile nested icon={Globe} name="report.html" at={report} hover={hover} />
                <TreeFolder name="data" count={t >= prices ? 2 : 1} openAt={prices} />
                <TreeFile nested icon={FileSpreadsheet} name="prices.csv" at={prices} />
                <TreeFile nested icon={FileSpreadsheet} name="universe.csv" at={prices} />
              </TreeColumn>
            </div>
          )
        }
      />
    </Camera>
  );
}

export const threadFileScenes = {
  filePanel: { Scene: FilePanel, length: FILES.length, anchor: 'right' },
} satisfies Partial<Record<IntroVisualId, IntroScene>>;
