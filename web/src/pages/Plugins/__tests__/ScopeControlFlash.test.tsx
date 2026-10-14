import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '@/test/utils';

// Inline dropdown, as in BulkScopeMenu.test: jsdom does not drive Radix portals.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div role="menu">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect?: (e?: { preventDefault: () => void }) => void;
  }) => (
    <button role="menuitem" onClick={() => onSelect?.({ preventDefault: () => {} })}>
      {children}
    </button>
  ),
  DropdownMenuCheckboxItem: ({
    children,
    checked,
    onSelect,
  }: {
    children: React.ReactNode;
    checked?: boolean;
    onSelect?: (e?: { preventDefault: () => void }) => void;
  }) => (
    <button
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={() => onSelect?.({ preventDefault: () => {} })}
    >
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="submenu">{children}</div>
  ),
  DropdownMenuSubTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSubContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock('@/hooks/useWorkspaces', () => ({
  useWorkspaces: () => ({ data: { workspaces: [{ workspace_id: 'ws-1', name: 'Research' }] } }),
}));
vi.mock('@/hooks/useAllWorkspaces', () => ({
  useAllWorkspaces: () => ({ data: { workspaces: [{ workspace_id: 'ws-1', name: 'Research' }] } }),
}));
vi.mock('@/pages/ChatAgent/utils/api/workspaces', () => ({
  getFlashWorkspace: vi.fn().mockResolvedValue({ workspace_id: 'flash-1' }),
}));

import { ScopeControl } from '../components/ScopeControl';
import { BulkScopeMenu } from '../components/BulkScopeMenu';
import { useFlashWorkspace } from '@/hooks/useFlashWorkspace';
import { useWorkspaceOptions } from '../hooks/useWorkspaceOptions';

const workspaces = [{ id: 'ws-1', name: 'Research' }];
const flashWorkspace = { id: 'flash-1', name: 'Home' };

describe('ScopeControl with Home', () => {
  it('lists Home last when the row offers it', () => {
    const onSet = vi.fn();
    renderWithProviders(
      <ScopeControl
        workspaces={workspaces}
        scopeWorkspaceId={null}
        disabledWorkspaceIds={['flash-1']}
        flashWorkspace={flashWorkspace}
        onSetWorkspaceDisabled={onSet}
        onMove={vi.fn()}
      />,
    );
    const checks = screen.getAllByRole('menuitemcheckbox');
    expect(checks.map((el) => el.textContent)).toEqual(['Research', 'Home']);
    expect(checks.map((el) => el.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    // Home is never a move destination.
    const moves = screen.getAllByRole('menuitem').map((el) => el.textContent);
    expect(moves).toContain('Research');
    expect(moves).not.toContain('Home');
    // The disabled Home entry still counts toward the label.
    expect(screen.getByText('All workspaces except 1')).toBeInTheDocument();

    fireEvent.click(checks[1]);
    expect(onSet).toHaveBeenCalledWith('flash-1', false);
  });

  it('keeps Home out of rows that do not offer it', () => {
    renderWithProviders(
      <ScopeControl
        workspaces={workspaces}
        scopeWorkspaceId={null}
        disabledWorkspaceIds={['flash-1']}
        onSetWorkspaceDisabled={vi.fn()}
      />,
    );
    expect(screen.queryByText('Home')).not.toBeInTheDocument();
    expect(screen.getByText('All workspaces')).toBeInTheDocument();
  });

  it('keeps Home out of the bulk move-to-workspace destinations', async () => {
    function Harness() {
      const { workspaces: wsOptions } = useWorkspaceOptions();
      const flash = useFlashWorkspace();
      return (
        <>
          <span data-testid="flash-resolved">{flash?.id ?? 'none'}</span>
          <BulkScopeMenu
            workspaces={wsOptions}
            everywhereCount={2}
            onEverywhere={vi.fn()}
            onlyInCount={2}
            onOnlyIn={vi.fn()}
            move={{ count: 2, onMoveTo: vi.fn() }}
          />
        </>
      );
    }
    renderWithProviders(<Harness />);
    // The move list is only meaningful once Home has actually resolved:
    // an unresolved query would pass this test for the wrong reason.
    await screen.findByText('flash-1');

    const moveSub = screen
      .getAllByTestId('submenu')
      .find((el) => el.textContent?.includes('Move into one workspace'));
    expect(moveSub).toBeDefined();
    expect(within(moveSub as HTMLElement).getByText('Research')).toBeInTheDocument();
    expect(within(moveSub as HTMLElement).queryByText('Home')).not.toBeInTheDocument();
    // Nor anywhere else in the bulk menu: the "Only in" checklist writes a
    // deny the Skills tab's ScopeControl could not display or undo.
    expect(screen.queryByText('Home')).not.toBeInTheDocument();
  });
});
