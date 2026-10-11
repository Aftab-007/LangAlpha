/**
 * The tray's chips: the market watch as a control with a live label, a list
 * whose rows close it as they open their target, and an Analyst's thread
 * opened behind the host's leave guard.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { RouteLeaveGuardContext, type RouteLeaveGuard } from '../../../contexts/RouteLeaveGuardContext';
import type { SidebarAgentRow } from '../../../session/subagents/subagentStatus';
import { ComposerTray } from '../ComposerTray';
import type { TrayContents } from '../useTrayContents';

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

function task(id: string, description: string): SidebarAgentRow {
  return { id, name: `Task-${id}`, description, isMainAgent: false, status: 'active' };
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
    renderTray({ tasks: [task('a', 'Pull filings'), task('b', '')] }, { onOpenTask });
    fireEvent.click(screen.getByRole('button', { name: /2 background tasks/ }));
    // A row is named by its task's words, and by its name without them.
    fireEvent.click(screen.getByRole('button', { name: /Pull filings/ }));
    expect(onOpenTask).toHaveBeenCalledWith('a');
    expect(screen.queryByRole('button', { name: /Task-b/ })).toBeNull();
  });

  it("asks the leave guard before opening an Analyst's thread", () => {
    const guard = vi.fn<RouteLeaveGuard>();
    renderTray(
      { analysts: [{ thread_id: 'analyst-1', workspace_id: 'ws-1', workspace_name: 'Semis', title: 'Chip demand' }] },
      { guard },
    );
    fireEvent.click(screen.getByRole('button', { name: /Semis/ }));
    expect(guard).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('where')).toHaveTextContent('/chat/t/here');
    act(() => guard.mock.calls[0][0]());
    expect(screen.getByTestId('where')).toHaveTextContent('/chat/t/analyst-1');
  });
});
