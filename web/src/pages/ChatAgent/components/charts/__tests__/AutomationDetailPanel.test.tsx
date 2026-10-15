import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import AutomationDetailPanel from '../AutomationDetailPanel';

vi.mock('@/hooks/useHomeWorkspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useHomeWorkspace')>()),
  useHomeWorkspaceId: () => 'home-1',
}));

const card = (place: Record<string, unknown>) => ({
  automation_id: 'auto-1',
  name: 'Morning briefing',
  status: 'active',
  trigger_type: 'cron',
  schedule: '0 9 * * 1-5',
  ...place,
});

function renderList(...automations: Record<string, unknown>[]) {
  renderWithProviders(<AutomationDetailPanel data={{ type: 'automations', mode: 'list', automations, total: automations.length }} />);
}

describe('where an automation card says it runs', () => {
  it('reads a legacy flash card and one naming Home as All workspaces', () => {
    renderList(card({ agent_mode: 'flash', workspace_id: null }), card({ agent_mode: 'ptc', workspace_id: 'home-1' }));
    expect(screen.getAllByText('All workspaces')).toHaveLength(2);
  });

  it('reads a card that names only its workspace', () => {
    renderList(card({ workspace_id: 'home-1' }), card({ workspace_id: 'ws-1' }));
    expect(screen.getByText('All workspaces')).toBeInTheDocument();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
  });

  it('says nothing for a card that names neither', () => {
    renderList(card({}));
    expect(screen.queryByText('All workspaces')).not.toBeInTheDocument();
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
  });

  it('names the place in the detail view under the Agent row', () => {
    renderWithProviders(
      <AutomationDetailPanel
        data={{ type: 'automations', mode: 'detail', automation: card({ workspace_id: 'home-1' }), executions: [] }}
      />,
    );
    expect(screen.getByText('Agent').nextElementSibling).toHaveTextContent('All workspaces');
  });
});
