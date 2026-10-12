// @vitest-environment node
/**
 * Pin the deterministic-bubble-id contract for history replay handlers.
 *
 * Earlier code keyed assistant + user history bubbles on
 * `${role}-${pairIndex}-${Date.now()}` — making the same logical bubble
 * look new on every replay. Combined with a non-deduping setMessages
 * reducer, a second `loadConversationHistory` invocation (e.g. via the
 * failed-reconnect setReloadTrigger increment) would silently double the
 * visible history.
 *
 * The deterministic key is `history-{role}-{pairIndex}` — pairIndex is the
 * server-side `turn_index` and is unique per turn. These tests pin that
 * the handler uses ONLY pairIndex as the disambiguator, so a re-replay
 * produces stable ids that the reset-before-replay step in
 * `loadConversationHistory` can clean up cleanly.
 */
import { describe, it, expect } from 'vitest';
import { handleHistorySteeringDelivered, handleHistoryUserMessage, handleHistoryTaskArtifactStatus } from '../historyEventHandlers';
import type { MessageRecord } from '../types';

/** setMessages that applies the updater against a mutable backing array. */
function makeStore(initial: MessageRecord[]) {
  const state = initial.map((m) => ({ ...m }));
  const setMessages = (updater: (prev: MessageRecord[]) => MessageRecord[]) => {
    const next = updater(state.slice());
    state.length = 0;
    state.push(...next);
  };
  return { state, setMessages };
}

function makeRefs() {
  return {
    recentlySentTracker: { isRecentlySent: () => false },
    currentMessageRef: { current: null as string | null },
    newMessagesStartIndexRef: { current: 0 },
  };
}

describe('historyEventHandlers — bubble id determinism', () => {
  it('user-message bubble id depends only on pairIndex', () => {
    const inserted: MessageRecord[] = [];
    const setMessages = (updater: ((prev: MessageRecord[]) => MessageRecord[]) | MessageRecord[]) => {
      const next = typeof updater === 'function' ? updater(inserted.slice()) : updater;
      inserted.length = 0;
      inserted.push(...next);
    };
    const refs = makeRefs();
    const assistantMessagesByPair = new Map<number, string>();
    const pairStateByPair = new Map();

    handleHistoryUserMessage({
      event: { event: 'user_message', role: 'user', content: 'hello', turn_index: 3 },
      pairIndex: 3,
      assistantMessagesByPair,
      pairStateByPair,
      refs,
      setMessages,
    });

    const userBubble = inserted.find((m) => m.role === 'user');
    expect(userBubble).toBeDefined();
    expect(userBubble!.id).toBe('history-user-3');
  });

  it('assistant placeholder id depends only on pairIndex', () => {
    const inserted: MessageRecord[] = [];
    const setMessages = (updater: ((prev: MessageRecord[]) => MessageRecord[]) | MessageRecord[]) => {
      const next = typeof updater === 'function' ? updater(inserted.slice()) : updater;
      inserted.length = 0;
      inserted.push(...next);
    };
    const refs = makeRefs();
    const assistantMessagesByPair = new Map<number, string>();
    const pairStateByPair = new Map();

    handleHistoryUserMessage({
      event: { event: 'user_message', role: 'user', content: 'hello', turn_index: 7 },
      pairIndex: 7,
      assistantMessagesByPair,
      pairStateByPair,
      refs,
      setMessages,
    });

    expect(assistantMessagesByPair.get(7)).toBe('history-assistant-7');
    const assistantBubble = inserted.find((m) => m.role === 'assistant');
    expect(assistantBubble).toBeDefined();
    expect(assistantBubble!.id).toBe('history-assistant-7');
  });

  it('two replays of the same turn produce the same bubble ids', () => {
    // The crux of the fix: deterministic ids let a re-replay's bubbles
    // collide with the first replay's, which combined with the reset in
    // `loadConversationHistory` (filter `isHistory: true` from messages
    // before re-running) keeps the rendered list stable.
    const idsRun1: string[] = [];
    const idsRun2: string[] = [];

    for (const collector of [idsRun1, idsRun2]) {
      const inserted: MessageRecord[] = [];
      const setMessages = (updater: ((prev: MessageRecord[]) => MessageRecord[]) | MessageRecord[]) => {
        const next = typeof updater === 'function' ? updater(inserted.slice()) : updater;
        inserted.length = 0;
        inserted.push(...next);
      };
      const refs = makeRefs();
      const assistantMessagesByPair = new Map<number, string>();
      const pairStateByPair = new Map();
      handleHistoryUserMessage({
        event: { event: 'user_message', role: 'user', content: 'hi', turn_index: 0 },
        pairIndex: 0,
        assistantMessagesByPair,
        pairStateByPair,
        refs,
        setMessages,
      });
      collector.push(...inserted.map((m) => m.id as string));
    }

    expect(idsRun1).toEqual(idsRun2);
  });
});

describe('handleHistoryTaskArtifactStatus — born-correct inline card status', () => {
  const cardMsg = (tasks: Record<string, Record<string, unknown>>): MessageRecord => ({
    id: 'history-assistant-0',
    role: 'assistant',
    subagentTasks: tasks,
  });

  it('stamps the matching card by tool_call_id (running -> cancelled)', () => {
    const { state, setMessages } = makeStore([
      cardMsg({ tc1: { subagentId: 'tc1', action: 'init', status: 'running' } }),
    ]);

    const applied = handleHistoryTaskArtifactStatus({
      toolCallId: 'tc1',
      taskId: 'abc',
      status: 'cancelled',
      setMessages,
    });

    expect(applied).toBe(true);
    expect((state[0].subagentTasks as Record<string, Record<string, unknown>>).tc1.status).toBe('cancelled');
  });

  it('only patches the card of the artifact tool_call_id, not siblings of the same task', () => {
    const { state, setMessages } = makeStore([
      cardMsg({
        tc1: { subagentId: 'tc1', action: 'init', status: 'running' },
        tc2: { subagentId: 'tc2', action: 'resume', resumeTargetId: 'task:abc', status: 'running' },
      }),
    ]);

    handleHistoryTaskArtifactStatus({ toolCallId: 'tc2', taskId: 'abc', status: 'completed', setMessages });

    const tasks = state[0].subagentTasks as Record<string, Record<string, unknown>>;
    expect(tasks.tc1.status).toBe('running'); // untouched
    expect(tasks.tc2.status).toBe('completed');
  });

  it('ignores absent/unknown status values', () => {
    const { state, setMessages } = makeStore([
      cardMsg({ tc1: { subagentId: 'tc1', action: 'init', status: 'running' } }),
    ]);

    expect(handleHistoryTaskArtifactStatus({ toolCallId: 'tc1', taskId: 'abc', status: undefined, setMessages })).toBe(false);
    expect(handleHistoryTaskArtifactStatus({ toolCallId: 'tc1', taskId: 'abc', status: 'weird', setMessages })).toBe(false);
    expect((state[0].subagentTasks as Record<string, Record<string, unknown>>).tc1.status).toBe('running');
  });

  it('falls back to task_id (resume cards) only when tool_call_id is absent', () => {
    const { state, setMessages } = makeStore([
      cardMsg({
        tc1: { subagentId: 'tc1', action: 'init', status: 'running' },
        tc2: { subagentId: 'tc2', action: 'resume', resumeTargetId: 'task:abc', status: 'running' },
      }),
    ]);

    handleHistoryTaskArtifactStatus({ toolCallId: undefined, taskId: 'abc', status: 'completed', setMessages });

    const tasks = state[0].subagentTasks as Record<string, Record<string, unknown>>;
    expect(tasks.tc1.status).toBe('running'); // init card carries no resumeTargetId
    expect(tasks.tc2.status).toBe('completed');
  });
});

describe('handleHistorySteeringDelivered — reply time', () => {
  function replyAfterSteer(event: Record<string, unknown>): MessageRecord {
    const { state, setMessages } = makeStore([]);
    handleHistorySteeringDelivered({
      event: { event: 'steering_delivered', turn_index: 2, ...event },
      pairIndex: 2,
      assistantMessagesByPair: new Map(),
      pairStateByPair: new Map(),
      refs: { newMessagesStartIndexRef: { current: 0 } },
      setMessages,
    });
    return state.find((m) => m.role === 'assistant')!;
  }

  // The tray ages work handed off in this reply by its time, so a replay
  // must not make it look new.
  it('starts when the run took the steer in, not when the replay ran', () => {
    const reply = replyAfterSteer({ timestamp: 1_700_000_100, messages: [{ content: 'go', timestamp: 1_700_000_000 }] });
    expect((reply.timestamp as Date).getTime()).toBe(1_700_000_100_000);
  });

  it('falls back to the steer sent last when the delivery has no time', () => {
    const reply = replyAfterSteer({ messages: [{ content: 'a', timestamp: 1_700_000_000 }, { content: 'b', timestamp: 1_700_000_050 }] });
    expect((reply.timestamp as Date).getTime()).toBe(1_700_000_050_000);
  });
});
