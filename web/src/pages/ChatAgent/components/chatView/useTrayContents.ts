import { useTranslation } from 'react-i18next';
import type { MarketWatchState } from '../../session/marketWatchEvents';
import { isTerminalStatus, type SidebarAgentRow } from '../../session/subagents/subagentStatus';
import type { ReportBackOwedThread } from '../../utils/api';

interface TrayInputs {
  marketWatch: MarketWatchState | null;
  /** The thread's agent rows, as the sidebar lists them. */
  agentRows: SidebarAgentRow[];
  isLoading: boolean;
  hasActiveSubagents: boolean;
  reportBackOwed: boolean;
  owedThreads: ReportBackOwedThread[] | null;
  /** Who reports back here: Analysts to Home, PTC agents to a Flash thread, subagents to a workspace thread. */
  mode: 'home' | 'flash' | 'ptc';
}

/** What the tray holds: one chip per entry that is set. */
export interface TrayContents {
  /** The market watch, while the agent watches tickers. */
  watch: MarketWatchState | null;
  /** Background tasks still running, while the tasks chip shows. */
  tasks: SidebarAgentRow[] | null;
  analysts: ReportBackOwedThread[] | null;
  reportBackLabel: string | null;
}

/** How many chips the tray draws, which is how many shapes its liquid runs. */
export function trayChipCount(contents: TrayContents | null): number {
  if (!contents) return 0;
  const { watch, tasks, analysts, reportBackLabel } = contents;
  return [watch, tasks, analysts, reportBackLabel].filter((entry) => entry !== null).length;
}

/**
 * Work the thread is waiting on, which the tray shows as chips: the market
 * watch, background tasks and owed reports. Null when there is none. Read
 * once by the host, since the tray and its folded dock show the same thing.
 */
export function useTrayContents({
  marketWatch, agentRows, isLoading, hasActiveSubagents, reportBackOwed, owedThreads, mode,
}: TrayInputs): TrayContents | null {
  const { t } = useTranslation();

  const watch = marketWatch?.symbols.length ? marketWatch : null;
  // `hasActiveSubagents` is the open-stream signal, set when the main turn
  // ends; during a turn the rows themselves say what is running.
  const running = agentRows.filter((row) => !row.isMainAgent && !isTerminalStatus(row.status));
  const showTasks = hasActiveSubagents || (isLoading && running.length > 0);
  const analysts = mode === 'home' ? owedThreads : null;
  // A report the tray can only name. On a workspace thread the owed report is
  // a subagent's result, which the tasks chip already covers while one runs.
  const reportBackLabel = reportBackOwed && !analysts && !showTasks
    ? t(mode === 'home' ? 'agents.reportBackPending' : mode === 'flash' ? 'chat.reportBackPending' : 'chat.taskReportBackPending')
    : null;

  if (!watch && !showTasks && !analysts && !reportBackLabel) return null;
  return { watch, tasks: showTasks ? running : null, analysts, reportBackLabel };
}
