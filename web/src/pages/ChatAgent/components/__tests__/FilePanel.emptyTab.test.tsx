/**
 * The empty tab is the file listing: the tree lies across the whole body
 * rather than beside a placeholder, and a file opened from it takes the body,
 * with the tree back to being a column the reader can fold.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';

vi.mock('@/pages/ChatAgent/utils/api', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    readWorkspaceFile: vi.fn(async () => ({ content: '# Notes', mime: 'text/markdown', truncated: false })),
    readWorkspaceFileFull: vi.fn(async () => ({ content: '# Notes' })),
    writeWorkspaceFile: vi.fn(async () => ({})),
    downloadWorkspaceFileAsArrayBuffer: vi.fn(),
    triggerFileDownload: vi.fn(),
    resolveWorkspaceFile: vi.fn(),
    getPreviewUrl: vi.fn(),
  };
});
vi.mock('@/hooks/useWorkspace', () => ({ useWorkspace: () => ({ data: { status: 'running', name: 'ws' } }) }));
vi.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark' }) }));
vi.mock('@/pages/ChatAgent/components/FilePanelMemo', () => ({
  memoMimeForName: () => null,
  useAddToMemo: () => vi.fn(),
  useWorkspaceMemoIndex: () => new Map(),
  useMemoStaleCheck: () => ({ status: null, sandboxText: null, refresh: () => {} }),
  MemoStaleBanner: () => null,
  MemoDiffModal: () => null,
}));
vi.mock('@/pages/ChatAgent/components/SandboxSettingsPanel', () => ({ SandboxSettingsContent: () => null }));

import FilePanel from '@/pages/ChatAgent/components/FilePanel';

const panel = () => (
  <FilePanel workspaceId="ws" threadId="thread-1" onClose={() => {}} files={['notes.md', 'todo.md']} target={null} />
);

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.resetAllMocks(); vi.restoreAllMocks(); });

describe('FilePanel empty tab', () => {
  it('lays the tree across the body, with no column to fold and nothing behind it', () => {
    renderWithProviders(panel());

    expect(document.querySelector('.file-panel-tree.is-full')).toBeTruthy();
    expect(document.querySelector('.file-panel-empty-tab')).toBeNull();
    expect(screen.queryByTitle('Toggle file tree')).toBeNull();
  });

  it('gives the body to a file opened from it and makes the tree a column again', async () => {
    renderWithProviders(panel());

    fireEvent.click(document.querySelector('[data-row-path="notes.md"]')!);

    await waitFor(() => expect(screen.getByText('notes.md', { selector: '.file-panel-tab-name' })).toBeTruthy());
    expect(screen.getByTitle('Toggle file tree')).toBeTruthy();
    expect(document.querySelector('.file-panel-empty-tab')).toBeNull();
  });
});
