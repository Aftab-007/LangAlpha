/**
 * The tray's chips: the market watch as a control with a live label, a list
 * whose rows close it as they open their target, and an Analyst's thread
 * opened behind the host's leave guard.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { RouteLeaveGuardContext, type RouteLeaveGuard } from '../../../contexts/RouteLeaveGuardContext';
import type { RosterTask } from '../delegatedWork';
import { ComposerTray } from '../ComposerTray';
import { trayWorking, type TrayContents } from '../useTrayContents';

const EMPTY: TrayContents = { watch: null, tasks: null, analysts: null, reportBackLabel: null };

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname}</output>;
}

function renderTray(
  contents: Partial<TrayContents>,
  { onOpenTask = vi.fn(), onOpenWatch = vi.fn(), guard = (go) => go() }: {
    onOpenTask?: (agentId: string) => void;
    onOpenWatch?: () => void;
    guard?: RouteLeaveGuard;
  } = {},
) {
  return render(
    <MemoryRouter initialEntries={['/chat/t/here']}>
      <RouteLeaveGuardContext value={guard}>
        <Routes>
          <Route
            path="*"
            element={(
              <>
                <ComposerTray
                  contents={{ ...EMPTY, ...contents }}
                  phase="open"
                  trayRef={{ current: null }}
                  dockRef={{ current: null }}
                  from={{ threadId: 'here', workspaceId: 'home' }}
                  onOpenTask={onOpenTask}
                  onOpenWatch={onOpenWatch}
                />
                <Where />
              </>
            )}
          />
        </Routes>
      </RouteLeaveGuardContext>
    </MemoryRouter>,
  );
}

function task(id: string, description: string, running = true): RosterTask {
  return { id, name: `Task-${id}`, description, isMainAgent: false, status: running ? 'active' : 'completed', running };
}

function listed(...rows: RosterTask[]): TrayContents['tasks'] {
  return { rows, unnamedRunning: false };
}

describe('ComposerTray', () => {
  it('shows the watched tickers on a button that opens the watch', () => {
    const onOpenWatch = vi.fn();
    renderTray({ watch: { symbols: ['NVDA', 'TSLA'] } }, { onOpenWatch });
    const chip = screen.getByRole('button', { name: 'Open live market watch' });
    expect(chip).toHaveAttribute('title', 'Live prices for the tickers the agent is watching');
    fireEvent.click(chip);
    expect(onOpenWatch).toHaveBeenCalledTimes(1);
  });

  it('announces the watch from its label, not the button', () => {
    renderTray({ watch: { symbols: ['AAPL'] } });
    const label = screen.getByText('Watching AAPL');
    expect(label).toHaveAttribute('role', 'status');
    expect(label).toHaveAttribute('aria-live', 'polite');
    expect(label.closest('button')).not.toHaveAttribute('role');
  });

  it('names when the watch last updated', () => {
    renderTray({ watch: { symbols: ['NVDA'], timestamp: 1_700_000_000 } });
    expect(screen.getByRole('button', { name: 'Open live market watch' }).getAttribute('title')).toMatch(/updated/);
  });

  it('closes the task list as a row opens its task', () => {
    const onOpenTask = vi.fn();
    renderTray({ tasks: listed(task('a', 'Pull filings'), task('b', '', false)) }, { onOpenTask });
    fireEvent.click(screen.getByRole('button', { name: /2 tasks · 1 running/ }));
    // A row is named by its task's words, and by its name without them.
    fireEvent.click(screen.getByRole('button', { name: /Pull filings/ }));
    expect(onOpenTask).toHaveBeenCalledWith('a');
    expect(screen.queryByRole('button', { name: /Task-b/ })).toBeNull();
  });

  it('spins for a task only while it runs, whatever its status reads', () => {
    const spinner = (name: string) => screen.getByRole('button', { name: new RegExp(name) }).querySelector('[role="status"]');
    renderTray({ tasks: listed(task('a', 'Pull filings')) });
    expect(spinner('Pull filings')).not.toBeNull();
    cleanup();
    // Its run ended unseen: the status still reads live, but nothing runs.
    renderTray({ tasks: listed({ ...task('b', 'Size the market', false), status: 'active' }) });
    expect(spinner('Size the market')).toBeNull();
  });

  it('spins for a task no row names beside the rows it keeps', () => {
    const contents = { ...EMPTY, tasks: { rows: [task('b', 'Size the market', false)], unnamedRunning: true } };
    expect(trayWorking(contents)).toBe(true);
    renderTray(contents);
    const chip = screen.getByRole('button', { name: /1 task/ });
    expect(chip.querySelector('[role="status"]')).not.toBeNull();
    fireEvent.click(chip);
    expect(screen.getByRole('button', { name: /Size the market/ })).toBeInTheDocument();
  });

  it("names each task's status for a screen reader", () => {
    renderTray({ tasks: listed(task('a', 'Pull filings'), { ...task('b', 'Size the market', false), status: 'error' }) });
    fireEvent.click(screen.getByRole('button', { name: /2 tasks · 1 running/ }));
    expect(screen.getByRole('button', { name: /Working.*Pull filings/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Failed.*Size the market/ })).toBeInTheDocument();
  });

  it('draws no status for an Analyst nothing has reported on yet', () => {
    const analyst = { threadId: 'a1', workspaceId: 'w1', workspaceName: 'Semis', title: 'Chip demand', running: false };
    renderTray({ analysts: [{ ...analyst, status: null }, { ...analyst, threadId: 'a2', workspaceName: 'Banks', status: 'completed' }] });
    fireEvent.click(screen.getByRole('button', { name: /2 Analysts/ }));
    const row = screen.getAllByRole('button', { name: /Chip demand/ })[0];
    expect(row.querySelector('[role="status"]')).toBeNull();
    expect(row).not.toHaveTextContent(/Starting|·/);
  });

  it("asks the leave guard before opening an Analyst's thread", () => {
    const guard = vi.fn<RouteLeaveGuard>();
    renderTray(
      { analysts: [{ threadId: 'analyst-1', workspaceId: 'ws-1', workspaceName: 'Semis', title: 'Chip demand', status: 'running', running: true }] },
      { guard },
    );
    fireEvent.click(screen.getByRole('button', { name: /Semis/ }));
    expect(guard).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('where')).toHaveTextContent('/chat/t/here');
    act(() => guard.mock.calls[0][0]());
    expect(screen.getByTestId('where')).toHaveTextContent('/chat/t/analyst-1');
  });
});
