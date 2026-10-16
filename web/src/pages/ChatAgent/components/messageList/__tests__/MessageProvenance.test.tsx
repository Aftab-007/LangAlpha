/**
 * The caption over a message nobody typed here: what it says, where it links,
 * and that a read-only view draws it without the link.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { MessageProvenanceLabel } from '../MessageProvenance';
import { MessageActionsProvider, type MessageActions } from '../MessageActionsContext';
import MessageList from '../../MessageList';
import type { MessageProvenance } from '@/types/chat';
import { deliveredEntryRow } from '../../../session/stream/steeringDelivery';
import type { MessageRecord } from '../types';

let allWorkspaces = false;
vi.mock('@/hooks/useAllWorkspacesAgent', () => ({
  useAllWorkspacesAgent: () => allWorkspaces,
}));

vi.mock('@/hooks/useUser', () => ({
  useUser: () => ({ user: null }),
}));

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'dark' }),
}));

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

function renderLabel(
  provenance: MessageProvenance,
  { actions = {}, readOnly = false }: { actions?: MessageActions; readOnly?: boolean } = {},
) {
  return render(
    <MemoryRouter initialEntries={['/chat/t/here']}>
      <MessageActionsProvider actions={actions}>
        <Routes>
          <Route path="*" element={<><MessageProvenanceLabel provenance={provenance} readOnly={readOnly} /><Where /></>} />
        </Routes>
      </MessageActionsProvider>
    </MemoryRouter>,
  );
}

describe('MessageProvenanceLabel', () => {
  it('names a channel with no link', () => {
    renderLabel({ kind: 'channel', platform: 'imessage' });
    expect(screen.getByText('Via iMessage')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('opens the automation a run came from', () => {
    renderLabel({ kind: 'automation', automationId: 'auto-1', name: 'Morning brief' });
    fireEvent.click(screen.getByRole('button', { name: 'Automation · Morning brief' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/automations?id=auto-1');
  });

  it('draws the label without its link in a read-only view', () => {
    renderLabel({ kind: 'automation', automationId: 'auto-1', name: null }, { readOnly: true });
    expect(screen.getByText('Automation')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('goes back to the dispatching thread through the host', () => {
    const onOpenDispatcher = vi.fn();
    renderLabel({ kind: 'agent', agent: 'chief_of_staff', threadId: 'th-home' }, { actions: { onOpenDispatcher } });
    fireEvent.click(screen.getByRole('button', { name: 'From Chief of Staff' }));
    expect(onOpenDispatcher).toHaveBeenCalledWith('th-home');
  });

  it('labels a steer the Chief of Staff sent into a running turn, without a link to its Home thread', () => {
    const row = deliveredEntryRow(
      { content: 'add the margin bridge', origin: { type: 'agent', agent: 'chief_of_staff' }, request_key: 'rk-cos' },
      () => 'row',
      2,
    );
    renderLabel(row!.provenance!, { actions: { onOpenDispatcher: vi.fn() } });
    expect(screen.getByText('From Chief of Staff')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('reads an unrecorded dispatcher off the current flag', () => {
    allWorkspaces = false;
    const { unmount } = renderLabel({ kind: 'agent', agent: null, threadId: 'th-old' });
    expect(screen.getByText('From Flash')).toBeInTheDocument();
    unmount();
    allWorkspaces = true;
    renderLabel({ kind: 'agent', agent: null, threadId: 'th-old' });
    expect(screen.getByText('From Chief of Staff')).toBeInTheDocument();
    allWorkspaces = false;
  });

  it('leaves an unrecorded dispatcher unlabelled in a share, which has no flags of its owner', () => {
    renderLabel({ kind: 'agent', agent: null, threadId: 'th-old' }, { readOnly: true });
    expect(screen.queryByText('From Flash')).not.toBeInTheDocument();
    expect(screen.queryByText('From Chief of Staff')).not.toBeInTheDocument();
  });

  it('opens a finished task\'s tab', () => {
    const onOpenSubagentTask = vi.fn();
    renderLabel(
      { kind: 'task_report', taskId: 'k7Xm2p', displayId: 'Task-k7Xm2p', description: 'Pull filings', failed: false },
      { actions: { onOpenSubagentTask } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Task-k7Xm2p finished' }));
    expect(onOpenSubagentTask).toHaveBeenCalledWith({ subagentId: 'task:k7Xm2p', description: 'Pull filings' });
  });

  it('opens an Analyst\'s thread from its report', () => {
    renderLabel({ kind: 'analyst_report', threadId: 'th-ws', workspaceId: 'ws-1', workspaceName: 'Semis' });
    fireEvent.click(screen.getByRole('button', { name: 'Report from Semis' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/chat/t/th-ws');
  });
});

describe('MessageList report row', () => {
  it('draws a report-back as its label alone, with no bubble or actions', () => {
    const messages: MessageRecord[] = [
      {
        id: 'history-user-1',
        role: 'user',
        content: 'Pull the filings',
        contentType: 'text',
        timestamp: new Date('2026-10-10T11:00:00Z'),
        isStreaming: false,
        isHistory: true,
        turnIndex: 1,
      },
      {
        id: 'history-user-2',
        role: 'user',
        content: '',
        contentType: 'text',
        timestamp: new Date('2026-10-10T12:00:00Z'),
        isStreaming: false,
        isHistory: true,
        turnIndex: 2,
        provenance: { kind: 'task_report', taskId: 'k7Xm2p', displayId: 'Task-k7Xm2p', description: null, failed: true },
      },
    ];
    const { container } = render(
      <MemoryRouter>
        <MessageActionsProvider actions={{ onEditMessage: vi.fn(), onOpenSubagentTask: vi.fn() }}>
          <MessageList messages={messages} />
        </MessageActionsProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Task-k7Xm2p failed' })).toBeInTheDocument();
    // The typed message above keeps its actions; the report row has none.
    expect(screen.getAllByTitle('Copy message')).toHaveLength(1);
    const report = container.querySelector('[data-message-id="history-user-2"]');
    expect(report?.querySelector('[title="Copy message"]')).toBeNull();
    expect(report?.textContent).toBe('Task-k7Xm2p failed');
  });
});
