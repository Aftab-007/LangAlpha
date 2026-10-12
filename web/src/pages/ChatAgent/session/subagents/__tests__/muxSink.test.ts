// @vitest-environment node
/**
 * A task's close tells the tray when it went quiet only when the close is
 * news here, which may be the first the page hears of the task. A drain that
 * re-closes a task this page already knew had settled must not restart its
 * five-turn clock.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { ThreadMuxSink } from '../../stream/threadStreamMux';
import type { SubagentRuntime } from '../../runtime';
import { createSubagentMuxController } from '../muxSink';

const attached = vi.hoisted(() => ({ sink: null as ThreadMuxSink | null }));
vi.mock('../../stream/threadStreamMux', () => ({
  getThreadMux: () => ({ attach: (sink: ThreadMuxSink) => { attached.sink = sink; } }),
}));

const NOW = 1_700_000_500_000;

function setup(historyStatus?: string) {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  const updateSubagentCard = vi.fn();
  const rt = {
    subagentHistory: { get: () => ({ entries: historyStatus ? { 'task:Qm3xLp': { status: historyStatus } } : {} }) },
    terminalTaskOutcomesRef: { current: new Map<string, string>() },
    updateSubagentCard,
    subagentStateRefsRef: { current: {} },
    subagentProcessEventRef: { current: null },
    setHasActiveSubagents: vi.fn(),
    setMessages: vi.fn(),
    // Mid-turn, so no report-back watch is armed.
    isStreamingRef: { current: true },
    threadIdRef: { current: 'thread-1' },
  } as unknown as SubagentRuntime;
  createSubagentMuxController(rt, { muxOpenTaskIds: () => new Set(), armReportBackWatch: vi.fn() })
    .attachSubagentMux('thread-1', vi.fn());
  const close = () => attached.sink!.onTaskRunClosed('Qm3xLp', 'completed');
  const written = () => updateSubagentCard.mock.calls.map(([, data]) => data as Record<string, unknown>);
  return { close, written };
}

afterEach(() => {
  vi.useRealTimers();
  attached.sink = null;
});

describe('muxSink: when a closed task went quiet', () => {
  it('stamps a close that is news here, and not the same close again', () => {
    const { close, written } = setup();
    close();
    close();
    expect(written()).toEqual([
      { status: 'completed', isActive: false, lastActivityMs: NOW },
      { status: 'completed', isActive: false },
    ]);
  });

  it('leaves the clock of a task the page loaded as settled', () => {
    const { close, written } = setup('completed');
    close();
    expect(written()).toEqual([{ status: 'completed', isActive: false }]);
  });
});
