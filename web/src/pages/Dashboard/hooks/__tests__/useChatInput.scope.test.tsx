/**
 * The dashboard composer sends to Home while its scope is All workspaces, the
 * default, and to the picked workspace otherwise. Only the Home send carries
 * the flash row's route state, which is what names Home to the chat view
 * before the row loads.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';

import { renderHookWithProviders } from '@/test/utils';

const api = vi.hoisted(() => ({
  getFlashWorkspace: vi.fn(async () => ({ workspace_id: 'home-1' })),
}));
vi.mock('@/pages/ChatAgent/utils/api/workspaces', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getFlashWorkspace: api.getFlashWorkspace,
}));
vi.mock('@/hooks/useWorkspaces', () => ({
  useWorkspaces: () => ({ data: { workspaces: [{ workspace_id: 'ws-1', name: 'Research', status: 'active' }], total: 1 } }),
}));
const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => navigate,
}));

import { useChatInput } from '../useChatInput';

afterEach(() => {
  navigate.mockReset();
});

const sentState = () => (navigate.mock.calls[0]?.[1] as { state: Record<string, unknown> }).state;

describe('useChatInput', () => {
  it('sends to Home under All workspaces', async () => {
    const { result } = renderHookWithProviders(() => useChatInput());
    expect(result.current.scope).toBe('all');

    await act(() => result.current.handleSend('hello'));
    expect(sentState()).toMatchObject({ workspaceId: 'home-1', workspaceStatus: 'flash' });
  });

  it('sends to the picked workspace under its scope', async () => {
    const { result } = renderHookWithProviders(() => useChatInput());
    act(() => result.current.setScope('workspace'));

    await act(() => result.current.handleSend('hello'));
    expect(sentState().workspaceId).toBe('ws-1');
    expect(sentState()).not.toHaveProperty('workspaceStatus');
  });
});
