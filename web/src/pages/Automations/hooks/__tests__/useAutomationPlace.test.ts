import { describe, it, expect, vi } from 'vitest';
import { renderHookWithProviders } from '@/test/utils';

vi.mock('@/hooks/useHomeWorkspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useHomeWorkspace')>()),
  useHomeWorkspaceId: () => 'home-1',
}));

import { useAutomationPlace } from '../useAutomationPlace';

const place = () => renderHookWithProviders(() => useAutomationPlace()).result.current;

describe('useAutomationPlace', () => {
  it('reads a row naming Home as All workspaces', () => {
    const { label, runsInHome } = place();
    expect(label({ workspace_id: 'home-1' })).toBe('All workspaces');
    expect(label({ workspace_id: 'home-1' }, 'Home')).toBe('All workspaces');
    expect(runsInHome({ workspace_id: 'home-1' })).toBe(true);
  });

  it('reads any other row as its workspace, by name when given', () => {
    const { label, runsInHome } = place();
    expect(label({ workspace_id: 'ws-nvda' }, 'NVDA deep dive')).toBe('In NVDA deep dive');
    expect(label({ workspace_id: 'ws-nvda' })).toBe('Workspace');
    expect(runsInHome({ workspace_id: 'ws-nvda' })).toBe(false);
  });
});
