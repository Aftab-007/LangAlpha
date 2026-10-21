import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import { GETTING_STARTED_TASKS } from '../registry';
import type { GettingStartedTaskState } from '../OnboardingProvider';

const dismiss = vi.fn();
const completeTask = vi.fn();
let mockTasks: GettingStartedTaskState[] = [];
let mockVisible = true;
vi.mock('../OnboardingProvider', () => ({
  useOnboarding: () => ({
    gettingStarted: {
      visible: mockVisible,
      tasks: mockTasks,
      doneCount: mockTasks.filter((t) => t.done).length,
      dismiss,
      completeTask,
    },
  }),
}));

import { GettingStartedLauncher } from '../engine/GettingStarted';

const TOTAL = GETTING_STARTED_TASKS.length;

function LocationProbe() {
  return <span data-testid="loc">{useLocation().pathname}</span>;
}

function renderLauncher(variant: 'row' | 'rail' = 'row') {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <GettingStartedLauncher variant={variant} />
      <Routes>
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

/** Opens the list from the sidebar entry. */
function openList(variant: 'row' | 'rail' = 'row') {
  renderLauncher(variant);
  fireEvent.click(screen.getByRole('button', { name: /^Get started/ }));
}

describe('GettingStartedLauncher', () => {
  beforeEach(() => {
    dismiss.mockClear();
    completeTask.mockClear();
    mockVisible = true;
    mockTasks = GETTING_STARTED_TASKS.map((def, i) => ({ def, done: i === 0 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when not visible', () => {
    mockVisible = false;
    const { container } = renderLauncher();
    expect(container.querySelector('button')).toBeNull();
  });

  it('shows progress in the sidebar row and keeps the list closed until asked', () => {
    renderLauncher();
    const entry = screen.getByRole('button', {
      name: `Get started, 1 of ${TOTAL} done`,
    });
    expect(entry).toHaveTextContent(`1/${TOTAL}`);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('the rail draws the same entry as an icon', () => {
    openList('rail');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  });

  it('lists every task, marks the done ones, and describes only the next one', () => {
    openList();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    expect(screen.getByText(`1 of ${TOTAL} done`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Explore the dashboard/ })).toBeDisabled();
    // The next task carries its line and holds focus, so Enter starts it.
    const next = screen.getByRole('button', { name: /Check live markets/ });
    expect(next).toHaveTextContent('Streaming charts for any symbol.');
    expect(next).toHaveFocus();
    expect(screen.queryByText(/Risk, markets, style, and how the agent works with you/)).toBeNull();
  });

  it('clicking a pending task navigates to its target and closes the list', () => {
    openList();
    fireEvent.click(screen.getByRole('button', { name: /Run your first analysis/ }));
    expect(screen.getByTestId('loc').textContent).toBe('/chat');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('the profile task opens the welcome flow', () => {
    openList();
    fireEvent.click(screen.getByRole('button', { name: /Set up your investing profile/ }));
    expect(screen.getByTestId('loc').textContent).toBe('/welcome');
    expect(completeTask).not.toHaveBeenCalled();
  });

  it('in the browser an external task stamps it done and opens a new tab, no in-app navigation', () => {
    // No 'noopener' feature string — that would make open() return null even
    // on success (reading as "blocked"). The opener is severed on the handle.
    const handle = { opener: window } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(handle);
    openList();
    fireEvent.click(screen.getByRole('button', { name: /Connect a chat app/ }));
    expect(completeTask).toHaveBeenCalledWith('integrations');
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/\/integrations$/), '_blank');
    expect(handle.opener).toBeNull();
    expect(screen.getByTestId('loc').textContent).toBe('/settings');
  });

  it('a blocked popup leaves the external task pending so the user can retry', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    openList();
    fireEvent.click(screen.getByRole('button', { name: /Connect a chat app/ }));
    expect(completeTask).not.toHaveBeenCalled();
  });

  it('the X closes the list and keeps the guide', () => {
    openList();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('"Hide guide" dismisses it for good', () => {
    openList();
    fireEvent.click(screen.getByRole('button', { name: 'Hide guide' }));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
