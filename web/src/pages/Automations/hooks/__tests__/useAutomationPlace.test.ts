import { describe, it, expect, vi } from 'vitest';
import { renderHookWithProviders } from '@/test/utils';

vi.mock('@/hooks/useHomeWorkspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useHomeWorkspace')>()),
  useHomeWorkspaceId: () => 'home-1',
}));

import { useAutomationPlace } from '../useAutomationPlace';

const place = () => renderHookWithProviders(() => useAutomationPlace()).result.current;

describe('useAutomationPlace', () => {
  it('reads a legacy flash row as All workspaces, whatever workspace it names', () => {
    const { label, workspaceOf } = place();
    expect(label({ agent_mode: 'flash', workspace_id: null })).toBe('All workspaces');
    expect(label({ agent_mode: 'flash', workspace_id: 'ws-old' }, 'Old')).toBe('All workspaces');
    expect(workspaceOf({ agent_mode: 'flash', workspace_id: 'ws-old' })).toBe('home-1');
  });

  it('reads a row naming Home as All workspaces, with or without a mode', () => {
    const { label, workspaceOf } = place();
    expect(label({ agent_mode: 'ptc', workspace_id: 'home-1' })).toBe('All workspaces');
    expect(label({ workspace_id: 'home-1' })).toBe('All workspaces');
    expect(workspaceOf({ agent_mode: 'ptc', workspace_id: 'home-1' })).toBe('home-1');
  });

  it('reads any other row as its workspace, by name when given', () => {
    const { label, workspaceOf, runsInHome } = place();
    expect(label({ agent_mode: 'ptc', workspace_id: 'ws-nvda' }, 'NVDA deep dive')).toBe('In NVDA deep dive');
    expect(label({ workspace_id: 'ws-nvda' })).toBe('Workspace');
    expect(workspaceOf({ workspace_id: 'ws-nvda' })).toBe('ws-nvda');
    expect(runsInHome({ workspace_id: 'ws-nvda' })).toBe(false);
  });
});
