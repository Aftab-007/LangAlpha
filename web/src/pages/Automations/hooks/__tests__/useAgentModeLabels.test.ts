import { describe, it, expect, vi } from 'vitest';
import { renderHookWithProviders } from '@/test/utils';

vi.mock('@/hooks/useFlashWorkspace', () => ({ useFlashWorkspace: () => ({ id: 'home-1', name: 'Home' }) }));

import { useAgentModeLabels, useRunsAs } from '../useAgentModeLabels';

describe('useAgentModeLabels', () => {
  it('reads the stored modes as places', () => {
    const { label } = renderHookWithProviders(() => useAgentModeLabels()).result.current;
    expect(label('flash')).toBe('All workspaces');
    expect(label('ptc', 'NVDA deep dive')).toBe('In NVDA deep dive');
    expect(label('ptc')).toBe('Workspace');
  });
});

describe('useRunsAs', () => {
  it('reads a Chief of Staff automation, filed as ptc in Home, as All workspaces', () => {
    const runsAs = renderHookWithProviders(() => useRunsAs()).result.current;
    expect(runsAs('ptc', 'home-1')).toBe('flash');
    expect(runsAs('ptc', 'ws-nvda')).toBe('ptc');
    expect(runsAs('flash', 'home-1')).toBe('flash');
    expect(runsAs('ptc', null)).toBe('ptc');
  });
});
