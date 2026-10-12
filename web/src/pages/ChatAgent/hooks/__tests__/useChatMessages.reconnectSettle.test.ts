/**
 * A stream that drops mid-answer leaves its bubble streaming, and the reconnect
 * resumes the run on a bubble of its own: the rest of the model call, and its
 * finish, land there. The bubble it continues must still settle, or it reads
 * as live after the turn has ended.
 *
 * Real hook internals; only the api module (the transport) is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { renderHookWithProviders } from '@/test/utils';
import { settleMountEffect, threadStatus } from './chatHookHarness';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('@/lib/supabase', () => ({ supabase: null }));

vi.mock('../utils/threadStorage', () => ({
  getStoredThreadId: vi.fn().mockReturnValue(null),
  setStoredThreadId: vi.fn(),
  removeStoredThreadId: vi.fn(),
}));

vi.mock('../../utils/api', async () => (await import('./chatHookHarness')).apiMockModule());

import { getWorkflowStatus, reconnectToWorkflowStream, replayThreadHistory, sendChatMessageStream } from '../../utils/api';
import { useChatMessages } from '../useChatMessages';
import type { MessageRecord } from '../utils/types';

const mockStatus = getWorkflowStatus as Mock;
const mockReconnect = reconnectToWorkflowStream as Mock;
const mockReplay = replayThreadHistory as Mock;
const mockSendStream = sendChatMessageStream as Mock;

type Emit = (e: Record<string, unknown>) => void;

const chunk = (content: string, extra: Record<string, unknown> = {}) => ({
  event: 'message_chunk', role: 'assistant', agent: 'main', content_type: 'text', content, ...extra,
});

/** The user steered the run: the rest of it lands on a continuation bubble. */
const steered = { event: 'steering_delivered', messages: [{ content: 'also this', timestamp: 1_700_000_000 }] };

/** The run's todo list, one step done and one under way. */
const todoUpdate = {
  event: 'artifact',
  artifact_type: 'todo_update',
  artifact_id: 'todos-1',
  payload: {
    todos: [{ content: 'gather', status: 'completed' }, { content: 'write', status: 'in_progress' }],
    total: 2, completed: 1, in_progress: 1, pending: 0,
  },
};

/** The statuses of the open todo list on the bubble showing `text`. */
function todosOn(messages: MessageRecord[], text: string): string[] {
  const bubble = messages.find((m) => m.role === 'assistant' && String(m.content ?? '').includes(text));
  const lists = Object.values((bubble?.todoListProcesses ?? {}) as Record<string, { order?: number; todos: { status: string }[] }>);
  if (lists.length === 0) throw new Error(`no todo list on the bubble showing ${text}`);
  const last = lists.reduce((a, b) => ((a.order || 0) >= (b.order || 0) ? a : b));
  return last.todos.map((t) => t.status);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

async function mount(status = threadStatus()) {
  mockReplay.mockImplementation(async (_tid: string, onEvent: Emit) => {
    onEvent({ event: 'user_message', turn_index: 0, content: 'question 0', run_id: 'run-0' });
    onEvent({ event: 'message_chunk', turn_index: 0, role: 'assistant', agent: 'main', content_type: 'text', content: 'answer 0' });
    onEvent({ event: 'replay_done', thread_id: 'th-1' });
  });
  mockStatus.mockResolvedValue(status);
  const hook = renderHookWithProviders(() => useChatMessages('ws', 'th-1'));
  await settleMountEffect();
  await waitFor(() => expect(hook.result.current.isLoadingHistory).toBe(false));
  return hook;
}

type Hook = Awaited<ReturnType<typeof mount>>;

/** A reconnect that plays `frames` and ends with the run. */
const endsAfter = (frames: Record<string, unknown>[]) =>
  async (_tid: string, _rid: string, _cursor: unknown, onEvent: Emit) => {
    for (const frame of frames) onEvent(frame);
    return { disconnected: false, aborted: false };
  };

/** A reconnect that plays `frames` and stays open, as for a run still going. */
const staysOpenAfter = (frames: Record<string, unknown>[]) =>
  (_tid: string, _rid: string, _cursor: unknown, onEvent: Emit, signal: AbortSignal) =>
    new Promise((resolve) => {
      for (const frame of frames) onEvent(frame);
      onEvent({ event: 'caught_up' });
      signal.addEventListener('abort', () => resolve({ disconnected: false, aborted: true }), { once: true });
    });

/** A reconnect that plays `frames`, then loses its own stream with the run still going. */
const failsAfter = (frames: Record<string, unknown>[], failure: 'throws' | 'drops') =>
  async (_tid: string, _rid: string, _cursor: unknown, onEvent: Emit) => {
    for (const frame of frames) onEvent(frame);
    if (failure === 'throws') throw new Error('network down');
    return { disconnected: true, aborted: false };
  };

type Attempt = (tid: string, rid: string, cursor: unknown, onEvent: Emit, signal: AbortSignal) => Promise<unknown>;

/** One reconnect per attempt, in order. */
const inTurn = (...list: Attempt[]): Attempt => {
  let n = 0;
  return (...args) => list[n++](...args);
};

/** Records when each attempt it wraps opened its stream. */
const clock = () => {
  const calledAt: number[] = [];
  const timed = (attempt: Attempt): Attempt => (...args) => {
    calledAt.push(Date.now());
    return attempt(...args);
  };
  return { calledAt, timed };
};

const running = () => threadStatus({ can_reconnect: true, status: 'running', run_id: 'run-1', latest_turn_index: 1 });

/** Sends a turn whose stream drops mid-answer, then reconnects with `reconnect`. */
async function dropThenReconnect(hook: Hook, reconnect: (...args: never[]) => Promise<unknown>, status = running) {
  mockStatus.mockImplementation(async () => status());
  mockReconnect.mockImplementation(reconnect);
  mockSendStream.mockImplementation(async (_msg: string, _ws: string, _tid: string | null, { onEvent }: { onEvent: Emit }) => {
    onEvent({ event: 'metadata', thread_id: 'th-1', run_id: 'run-1', _eventId: 1 });
    // Mid-sentence: the model call's finish never reaches this stream.
    onEvent({ ...chunk('the first half'), _eventId: 2 });
    return { disconnected: true };
  });
  await act(async () => {
    await hook.result.current.handleSendMessage('go on');
    await flush();
  });
  await waitFor(() => expect(mockReconnect).toHaveBeenCalled());
}

/** Opens the thread mid-turn: its load attaches to the running run with `reconnect`. */
async function openMidTurn(reconnect: Attempt) {
  mockReconnect.mockImplementation(reconnect);
  const hook = await mount(running());
  await waitFor(() => expect(mockReconnect).toHaveBeenCalled());
  return hook;
}

const emptyBubbles = (hook: Hook) =>
  (hook.result.current.liveMessages.get() as MessageRecord[]).filter(
    (m) => m.role === 'assistant' && !m.content && !(m.contentSegments as unknown[] | undefined)?.length,
  );

const ended = () => threadStatus({ can_reconnect: false, status: 'completed', latest_turn_index: 1 });

/**
 * What a give-up left, as the reload it asks for finds it. The reload checks
 * the status before its replay clears the bubbles the give-up handed over, so
 * the last look a status check took is that state.
 */
function watchReload(hook: Hook) {
  let lastSeen: MessageRecord[] = [];
  const atReload: { current: MessageRecord[] | null } = { current: null };
  mockReplay.mockImplementation(async (_tid: string, onEvent: Emit) => {
    atReload.current = lastSeen;
    onEvent({ event: 'replay_done', thread_id: 'th-1' });
  });
  const seeing = <T>(status: () => T) => () => {
    lastSeen = [...(hook.result.current.liveMessages.get() as MessageRecord[])];
    return status();
  };
  return { atReload, seeing };
}

function bubbleShowing(hook: Hook, text: string): MessageRecord {
  const bubble = (hook.result.current.liveMessages.get() as MessageRecord[]).find(
    (m) => m.role === 'assistant' && String(m.content ?? '').includes(text),
  );
  if (!bubble) throw new Error(`no assistant bubble shows ${text}`);
  return bubble;
}

describe('useChatMessages: a reconnect settles the bubble it continues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('the dropped bubble settles when the reconnected turn ends', async () => {
    const hook = await mount();
    await dropThenReconnect(hook, endsAfter([
      { ...chunk(' and the rest'), _eventId: 3 },
      { ...chunk('', { finish_reason: 'stop' }), _eventId: 4 },
    ]));
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));

    const continued = bubbleShowing(hook, 'the first half');
    expect(continued.isStreaming).toBe(false);
    expect(bubbleShowing(hook, 'and the rest').isStreaming).toBe(false);
    const streaming = (hook.result.current.liveMessages.get() as MessageRecord[]).filter((m) => m.isStreaming);
    expect(streaming).toEqual([]);
  });

  it('the dropped bubble carries the turn end when the reconnect brings no more text', async () => {
    const hook = await mount();
    // The drop came after the last word: only the call's finish is left.
    await dropThenReconnect(hook, endsAfter([{ ...chunk('', { finish_reason: 'stop' }), _eventId: 3 }]));
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));

    const continued = bubbleShowing(hook, 'the first half');
    expect(continued.isStreaming).toBe(false);
    expect(typeof continued.completionObservedAt).toBe('number');
  });

  it('the dropped bubble settles when the user stops the reconnected turn', async () => {
    const hook = await mount();
    await dropThenReconnect(hook, staysOpenAfter([{ ...chunk(' still going'), _eventId: 3 }]));
    await waitFor(() => expect(bubbleShowing(hook, 'still going')).toBeTruthy());

    await act(async () => {
      await hook.result.current.stopWorkflow();
    });

    expect(bubbleShowing(hook, 'the first half').isStreaming).toBe(false);
    // The stop belongs to the turn's tail, the bubble the run was writing to.
    expect(bubbleShowing(hook, 'the first half').stopped).toBeUndefined();
    expect(bubbleShowing(hook, 'still going').stopped).toBe(true);
  });

  it('no bubble stays live when the attach a load opened fails', async () => {
    const hook = await openMidTurn(failsAfter([{ ...chunk('and then'), _eventId: 3 }], 'throws'));
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));

    const streaming = (hook.result.current.liveMessages.get() as MessageRecord[]).filter((m) => m.isStreaming);
    expect(streaming).toEqual([]);
    // The stream failed, which says nothing of the run: the bubble claims
    // neither that the turn ended nor that it failed, and the banner carries
    // the error.
    expect(bubbleShowing(hook, 'and then').completionObservedAt).toBeUndefined();
    expect(bubbleShowing(hook, 'and then').error).toBeUndefined();
    expect(hook.result.current.messageError).toBeTruthy();
  });

  it('an attach a load opened that drops is retried, and the turn ends on the retry', async () => {
    const hook = await openMidTurn(inTurn(
      failsAfter([{ ...chunk('and then'), _eventId: 3 }], 'drops'),
      endsAfter([
        { ...chunk(' the end'), _eventId: 4 },
        { ...chunk('', { finish_reason: 'stop' }), _eventId: 5 },
      ]),
    ));
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false), { timeout: 3000 });

    expect(mockReconnect).toHaveBeenCalledTimes(2);
    // The retry resumes the same run after what the attach delivered.
    expect(mockReconnect.mock.calls[1][1]).toBe('run-1');
    expect(mockReconnect.mock.calls[1][2]).toBe(3);
    expect(hook.result.current.messageError).toBeNull();
    const streaming = (hook.result.current.liveMessages.get() as MessageRecord[]).filter((m) => m.isStreaming);
    expect(streaming).toEqual([]);
    expect(typeof bubbleShowing(hook, 'the end').completionObservedAt).toBe('number');
  });

  it('a retry that cannot connect is one failed attempt, and the next one ends the turn', async () => {
    const hook = await mount();
    const { calledAt, timed } = clock();
    await dropThenReconnect(hook, inTurn(
      timed(async () => {
        throw new TypeError('Failed to fetch');
      }),
      timed(endsAfter([
        { ...chunk(' the end'), _eventId: 3 },
        { ...chunk('', { finish_reason: 'stop' }), _eventId: 4 },
      ])),
    ));
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false), { timeout: 3000 });

    expect(mockReconnect).toHaveBeenCalledTimes(2);
    // The failed attempt is charged the loop's backoff before the next one.
    expect(calledAt[1] - calledAt[0]).toBeGreaterThanOrEqual(900);
    expect(hook.result.current.messageError).toBeNull();
    // It leaves no bubble, and the retry continues the turn the drop left.
    expect(emptyBubbles(hook)).toEqual([]);
    expect(bubbleShowing(hook, 'the first half').turnIndex).toBe(1);
    expect(bubbleShowing(hook, 'the end').turnIndex).toBe(1);
    expect(typeof bubbleShowing(hook, 'the end').completionObservedAt).toBe('number');
  });

  it('a retry the tab resumes before it hears anything continues the turn the drop left', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    const hook = await mount();
    // Open and silent, as a reader a suspended tab left behind.
    const quiet: Attempt = (_tid, _rid, _cursor, _onEvent, signal) =>
      new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve({ disconnected: false, aborted: true }), { once: true });
      });
    await dropThenReconnect(hook, inTurn(
      quiet,
      endsAfter([
        { ...chunk(' the end'), _eventId: 3 },
        { ...chunk('', { finish_reason: 'stop' }), _eventId: 4 },
      ]),
    ));
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
      document.dispatchEvent(new Event('visibilitychange'));
      await flush();
    });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false), { timeout: 3000 });

    expect(mockReconnect).toHaveBeenCalledTimes(2);
    expect(emptyBubbles(hook)).toEqual([]);
    expect(bubbleShowing(hook, 'the first half').turnIndex).toBe(1);
    expect(bubbleShowing(hook, 'the end').turnIndex).toBe(1);
    // The same run resumes after what the send delivered.
    expect(mockReconnect.mock.calls[1][1]).toBe('run-1');
    expect(mockReconnect.mock.calls[1][2]).toBe(2);
  });

  it.each([401, 403])('a retry the server refuses with %i ends with the banner, unretried', async (status) => {
    const hook = await mount();
    await dropThenReconnect(hook, async () => {
      throw Object.assign(new Error('Not authenticated'), { status });
    });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));

    expect(mockReconnect).toHaveBeenCalledTimes(1);
    expect(hook.result.current.messageError).toBe('Not authenticated');
    // Nothing reloads the transcript over the error.
    expect(mockReplay).toHaveBeenCalledTimes(1);
    const streaming = (hook.result.current.liveMessages.get() as MessageRecord[]).filter((m) => m.isStreaming);
    expect(streaming).toEqual([]);
  });

  it('a retry the server rate-limits waits as long as it asks before the next one', async () => {
    const hook = await mount();
    const { calledAt, timed } = clock();
    await dropThenReconnect(hook, inTurn(
      timed(async () => {
        throw Object.assign(new Error('Rate limit exceeded'), { status: 429, retryAfter: 2 });
      }),
      timed(endsAfter([
        { ...chunk(' the end'), _eventId: 3 },
        { ...chunk('', { finish_reason: 'stop' }), _eventId: 4 },
      ])),
    ));
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false), { timeout: 4000 });

    expect(mockReconnect).toHaveBeenCalledTimes(2);
    // Two seconds as asked, not the one the backoff would take.
    expect(calledAt[1] - calledAt[0]).toBeGreaterThanOrEqual(1900);
    expect(hook.result.current.messageError).toBeNull();
  });

  it('a retry the server has no run for gives up the way a finished run does', async () => {
    const hook = await mount();
    let expired = false;
    await dropThenReconnect(
      hook,
      async () => {
        expired = true;
        // The server's own detail text, not the transport's generic message.
        throw Object.assign(new Error('Run finished and its event stream expired.'), { status: 410 });
      },
      () => (expired ? ended() : running()),
    );
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));

    await waitFor(() => expect(mockReplay).toHaveBeenCalledTimes(2));
    expect(mockReconnect).toHaveBeenCalledTimes(1);
    expect(hook.result.current.messageError).toBeNull();
  });

  it('a reconnect that drops too is retried, and the turn ends on the retry', async () => {
    const hook = await mount();
    const { calledAt, timed } = clock();
    await dropThenReconnect(hook, inTurn(
      timed(failsAfter([{ ...chunk(' and then'), _eventId: 3 }], 'drops')),
      timed(endsAfter([
        { ...chunk(' the end'), _eventId: 4 },
        { ...chunk('', { finish_reason: 'stop' }), _eventId: 5 },
      ])),
    ));
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false), { timeout: 3000 });

    expect(mockReconnect).toHaveBeenCalledTimes(2);
    // A drop that made progress keeps the full allowance but still waits
    // before reopening, so a link that drops after every event cannot spin.
    expect(calledAt[1] - calledAt[0]).toBeGreaterThanOrEqual(900);
    // The retry resumes after what the dropped attempt delivered.
    expect(mockReconnect.mock.calls[1][2]).toBe(3);
    const streaming = (hook.result.current.liveMessages.get() as MessageRecord[]).filter((m) => m.isStreaming);
    expect(streaming).toEqual([]);
    expect(typeof bubbleShowing(hook, 'the end').completionObservedAt).toBe('number');
    expect(hook.result.current.messageError).toBeNull();
  });

  it('a reconnect that drops after its run ended gives up the way a first drop does', async () => {
    const hook = await mount();
    let reconnectDropped = false;
    const dropsOnce: Attempt = failsAfter([{ ...chunk(' and then'), _eventId: 3 }], 'drops');
    await dropThenReconnect(
      hook,
      async (...args: Parameters<Attempt>) => {
        const result = await dropsOnce(...args);
        reconnectDropped = true;
        return result;
      },
      () => (reconnectDropped ? ended() : running()),
    );
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false), { timeout: 3000 });

    // The give-up reloads the transcript, rather than leaving the drop as an error.
    await waitFor(() => expect(mockReplay).toHaveBeenCalledTimes(2));
    expect(mockReconnect).toHaveBeenCalledTimes(1);
    expect(hook.result.current.messageError).toBeNull();
  });

  it('giving up closes the todo list a dropped reconnect was keeping', async () => {
    const hook = await mount();
    // The give-up reloads; what it left is what the reload starts from.
    const { atReload, seeing } = watchReload(hook);
    let reconnectDropped = false;
    const dropsOnce: Attempt = failsAfter([{ ...todoUpdate, _eventId: 3 }, { ...chunk(' and then'), _eventId: 4 }], 'drops');
    await dropThenReconnect(
      hook,
      async (...args: Parameters<Attempt>) => {
        const result = await dropsOnce(...args);
        reconnectDropped = true;
        return result;
      },
      seeing(() => (reconnectDropped ? ended() : running())),
    );
    await waitFor(() => expect(atReload.current).not.toBeNull(), { timeout: 3000 });

    const keeper = atReload.current!.find((m) => String(m.content ?? '').includes('and then'));
    const lists = Object.values((keeper?.todoListProcesses ?? {}) as Record<string, { todos: { status: string }[] }>);
    expect(lists).toHaveLength(1);
    expect(lists[0].todos.map((t) => t.status)).toEqual(['completed', 'stale']);
  });

  it('a turn a reconnect ends closes the todo list on every bubble it wrote to', async () => {
    const hook = await mount();
    mockStatus.mockImplementation(async () => running());
    mockReconnect.mockImplementation(endsAfter([
      { ...chunk(' then more'), _eventId: 4 },
      { ...todoUpdate, _eventId: 5 },
      { ...steered, _eventId: 6 },
      { ...chunk('after the steer'), _eventId: 7 },
      { ...todoUpdate, _eventId: 8 },
      { ...chunk('', { finish_reason: 'stop' }), _eventId: 9 },
    ]));
    mockSendStream.mockImplementation(async (_msg: string, _ws: string, _tid: string | null, { onEvent }: { onEvent: Emit }) => {
      onEvent({ event: 'metadata', thread_id: 'th-1', run_id: 'run-1', _eventId: 1 });
      onEvent({ ...chunk('the first half'), _eventId: 2 });
      onEvent({ ...todoUpdate, _eventId: 3 });
      return { disconnected: true };
    });
    await act(async () => {
      await hook.result.current.handleSendMessage('go on');
      await flush();
    });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));

    const messages = hook.result.current.liveMessages.get() as MessageRecord[];
    // The bubble it continued, its own, and the steer's continuation.
    for (const text of ['the first half', 'then more', 'after the steer']) {
      expect(todosOn(messages, text)).toEqual(['completed', 'stale']);
    }
  });

  const secondRetry = {
    ends: endsAfter([
      { ...chunk(' the end'), _eventId: 5 },
      { ...chunk('', { finish_reason: 'stop' }), _eventId: 6 },
    ]),
    'is refused': async () => {
      throw Object.assign(new Error('Not authenticated'), { status: 401 });
    },
  };

  it.each(Object.keys(secondRetry) as (keyof typeof secondRetry)[])(
    'a turn whose second reconnect %s closes the todo list the send left',
    async (outcome) => {
      const hook = await mount();
      mockStatus.mockImplementation(async () => running());
      mockReconnect.mockImplementation(inTurn(
        failsAfter([{ ...chunk(' and then'), _eventId: 4 }], 'drops'),
        secondRetry[outcome],
      ));
      mockSendStream.mockImplementation(async (_msg: string, _ws: string, _tid: string | null, { onEvent }: { onEvent: Emit }) => {
        onEvent({ event: 'metadata', thread_id: 'th-1', run_id: 'run-1', _eventId: 1 });
        onEvent({ ...chunk('the first half'), _eventId: 2 });
        onEvent({ ...todoUpdate, _eventId: 3 });
        return { disconnected: true };
      });
      await act(async () => {
        await hook.result.current.handleSendMessage('go on');
        await flush();
      });
      await waitFor(() => expect(hook.result.current.isLoading).toBe(false), { timeout: 3000 });

      expect(mockReconnect).toHaveBeenCalledTimes(2);
      // Two hops back from the reconnect that ended the turn.
      expect(todosOn(hook.result.current.liveMessages.get() as MessageRecord[], 'the first half')).toEqual(['completed', 'stale']);
    },
  );

  it('giving up closes the todo list on every bubble a dropped reconnect wrote to', async () => {
    const hook = await mount();
    const { atReload, seeing } = watchReload(hook);
    let reconnectDropped = false;
    // The list is on the reconnect's own bubble; a steer moved it on before the drop.
    const dropsOnce: Attempt = failsAfter([
      { ...chunk(' then more'), _eventId: 3 },
      { ...todoUpdate, _eventId: 4 },
      { ...steered, _eventId: 5 },
      { ...chunk('after the steer'), _eventId: 6 },
    ], 'drops');
    await dropThenReconnect(
      hook,
      async (...args: Parameters<Attempt>) => {
        const result = await dropsOnce(...args);
        reconnectDropped = true;
        return result;
      },
      seeing(() => (reconnectDropped ? ended() : running())),
    );
    await waitFor(() => expect(atReload.current).not.toBeNull(), { timeout: 3000 });

    expect(todosOn(atReload.current!, 'then more')).toEqual(['completed', 'stale']);
  });

  it('giving up on a steered run that ended during the drop settles its continuation, though the reload fails', async () => {
    const hook = await mount();
    mockStatus.mockImplementation(async () => ended());
    mockSendStream.mockImplementationOnce(async (_msg: string, _ws: string, _tid: string | null, { onEvent }: { onEvent: Emit }) => {
      onEvent({ event: 'metadata', thread_id: 'th-1', run_id: 'run-1', turn_index: 1, _eventId: 1 });
      onEvent({ ...chunk('the answer'), _eventId: 2 });
      onEvent({ ...steered, _eventId: 3 });
      onEvent({ ...chunk('after the steer'), _eventId: 4 });
      return { disconnected: true };
    });
    // The reload the give-up asks for fails, which leaves the bubbles as the give-up did.
    mockReplay.mockImplementation(async () => {
      throw new Error('HTTP error! status: 503');
    });
    await act(async () => {
      await hook.result.current.handleSendMessage('go on');
      await flush();
    });
    await waitFor(() => expect(mockReplay).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(hook.result.current.isLoadingHistory).toBe(false));

    expect(hook.result.current.isLoading).toBe(false);
    expect(bubbleShowing(hook, 'after the steer').isStreaming).toBe(false);
    const streaming = (hook.result.current.liveMessages.get() as MessageRecord[]).filter((m) => m.isStreaming);
    expect(streaming).toEqual([]);
  });

  it('a stop during the retry\'s status check leaves the stopped turn alone', async () => {
    const hook = await mount();
    let answer: (status: unknown) => void = () => {};
    let checking = false;
    mockStatus.mockImplementation(() => new Promise((resolve) => {
      checking = true;
      answer = resolve;
    }));
    mockSendStream.mockImplementation(async (_msg: string, _ws: string, _tid: string | null, { onEvent }: { onEvent: Emit }) => {
      onEvent({ event: 'metadata', thread_id: 'th-1', run_id: 'run-1', _eventId: 1 });
      onEvent({ ...chunk('the first half'), _eventId: 2 });
      return { disconnected: true };
    });
    await act(async () => {
      await hook.result.current.handleSendMessage('go on');
      await flush();
    });
    await waitFor(() => expect(checking).toBe(true));

    await act(async () => {
      await hook.result.current.stopWorkflow();
    });
    // The run ended under the stop, which is what the check then reports.
    mockStatus.mockResolvedValue(ended());
    await act(async () => {
      answer(ended());
      await new Promise((r) => setTimeout(r, 50));
    });

    // The stop tore the turn down already; giving up on top would reload it.
    expect(mockReplay).toHaveBeenCalledTimes(1);
    expect(mockReconnect).not.toHaveBeenCalled();
    expect(bubbleShowing(hook, 'the first half').stopped).toBe(true);
  });

  it('a steer during the reconnect ends the turn on its continuation', async () => {
    const hook = await mount();
    await dropThenReconnect(hook, endsAfter([
      { ...chunk(' and then'), _eventId: 3 },
      { ...steered, _eventId: 4 },
      { ...chunk('after the steer'), _eventId: 5 },
      { ...chunk('', { finish_reason: 'stop' }), _eventId: 6 },
    ]));
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));

    const continuation = bubbleShowing(hook, 'after the steer');
    expect(continuation.isSteering).toBe(true);
    expect(continuation.isStreaming).toBe(false);
    // The bubble the run was writing when it ended is the turn's tail.
    expect(typeof continuation.completionObservedAt).toBe('number');
  });

  it('a steer during a load\'s attach leaves no bubble live when the attach fails', async () => {
    const hook = await openMidTurn(failsAfter([
      { ...chunk('and then'), _eventId: 3 },
      { ...steered, _eventId: 4 },
      { ...chunk('after the steer'), _eventId: 5 },
    ], 'throws'));
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));

    expect(bubbleShowing(hook, 'after the steer').isSteering).toBe(true);
    const streaming = (hook.result.current.liveMessages.get() as MessageRecord[]).filter((m) => m.isStreaming);
    expect(streaming).toEqual([]);
  });

  it('a tab resumed again and again during a quiet stretch costs no retries', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    const hook = await mount();
    // A long tool call writes nothing, and every resume cuts the open reader.
    const quiet: Attempt = (_tid, _rid, _cursor, _onEvent, signal) =>
      new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve({ disconnected: false, aborted: true }), { once: true });
      });
    const resumes = 6;
    await dropThenReconnect(hook, inTurn(
      ...Array.from({ length: resumes }, () => quiet),
      endsAfter([
        { ...chunk(' the end'), _eventId: 3 },
        { ...chunk('', { finish_reason: 'stop' }), _eventId: 4 },
      ]),
    ));
    for (let n = 1; n <= resumes; n++) {
      // Each reader opens at once: a resume is not a failure to wait out.
      await waitFor(() => expect(mockReconnect).toHaveBeenCalledTimes(n), { timeout: 800 });
      await act(async () => {
        window.dispatchEvent(new Event('pagehide'));
        document.dispatchEvent(new Event('visibilitychange'));
        await flush();
      });
    }
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false), { timeout: 800 });

    // More resumes than the loop has attempts, and still no give-up reload.
    expect(mockReconnect).toHaveBeenCalledTimes(resumes + 1);
    expect(mockReplay).toHaveBeenCalledTimes(1);
    expect(hook.result.current.messageError).toBeNull();
    expect(typeof bubbleShowing(hook, 'the end').completionObservedAt).toBe('number');
  });

  it('an attach that drops after a steer closes the todo list on the bubble before the steer', async () => {
    const hook = await openMidTurn(inTurn(
      failsAfter([
        { ...chunk('and then'), _eventId: 3 },
        { ...todoUpdate, _eventId: 4 },
        { ...steered, _eventId: 5 },
        { ...chunk('after the steer'), _eventId: 6 },
      ], 'drops'),
      endsAfter([
        { ...chunk(' the end'), _eventId: 7 },
        { ...chunk('', { finish_reason: 'stop' }), _eventId: 8 },
      ]),
    ));
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false), { timeout: 3000 });

    expect(mockReconnect).toHaveBeenCalledTimes(2);
    // The retry continues the steer's bubble; the list is on the one before it.
    expect(todosOn(hook.result.current.liveMessages.get() as MessageRecord[], 'and then')).toEqual(['completed', 'stale']);
  });
});
