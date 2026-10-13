/**
 * Tests the steering "demotion" path in handleSendSteering.
 *
 * When the user sends a follow-up while the agent is mid-stream, the UI
 * POSTs to the same endpoint and tags the user message as `steering: true`.
 * The backend usually replies with a ``steering_accepted`` SSE event and
 * the message is delivered mid-turn.
 *
 * RACE: if the agent's previous turn flipped to a terminal state between
 * the UI's ``isLoading`` snapshot and the POST landing, the backend opens
 * a *new* turn instead. The very first event the UI sees is then the
 * authoritative ``metadata`` frame for that fresh run (not
 * ``steering_accepted``). The hook must DEMOTE the steering bubble back to
 * a normal user message, append a fresh assistant placeholder, and route
 * all subsequent chunks into that new assistant — otherwise the new turn
 * would render on top of the previous turn's assistant bubble.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { renderHookWithProviders } from '@/test/utils';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports that depend on them
// ---------------------------------------------------------------------------

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('@/lib/supabase', () => ({ supabase: null }));

vi.mock('../utils/threadStorage', () => ({
  getStoredThreadId: vi.fn().mockReturnValue(null),
  setStoredThreadId: vi.fn(),
  removeStoredThreadId: vi.fn(),
}));

// The real handleTextContent mutates the assistant message via the setter
// it receives. We capture the calls so we can assert chunks were routed
// to the *new* (demoted) assistant message id, not the old one.
const textContentCalls: Array<{ assistantMessageId: string; text: string }> = [];

vi.mock('../../session/stream/mainEventHandlers', async (importOriginal) =>
  (await import('./chatHookHarness')).mainHandlersMockModule(await importOriginal(), {
    handleTextContent: vi.fn(({ event, assistantMessageId }) => {
      textContentCalls.push({
        assistantMessageId,
        text: (event?.content as string) || '',
      });
      return true;
    }),
  }));

vi.mock('../../session/subagents/liveEventHandlers', async (importOriginal) =>
  (await import('./chatHookHarness')).subagentHandlersMockModule(await importOriginal()));

vi.mock('../../session/streamRefs', async (importOriginal) =>
  (await import('./chatHookHarness')).streamRefsMockModule(await importOriginal()));

vi.mock('../../session/history/historyHandlers', async (importOriginal) =>
  (await import('./chatHookHarness')).historyHandlersMockModule(await importOriginal()));

vi.mock('../../utils/api', async () => (await import('./chatHookHarness')).apiMockModule());

import { sendChatMessageStream } from '../../utils/api';
import { useChatMessages } from '../useChatMessages';
import type { UserMessage, AssistantMessage } from '@/types/chat';

const mockSendStream = sendChatMessageStream as Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type OnEvent = (e: Record<string, unknown>) => void;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('useChatMessages — handleSendSteering demotion path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    textContentCalls.length = 0;
  });

  it('first non-steering event demotes the steering bubble to a new turn', async () => {
    // First call: hang forever so isLoading stays true while we trigger
    // the second (steering) POST. We capture the onEvent callback in case
    // we need to release it, but the test only needs the side effects of
    // the SECOND call's events.
    const firstHang = deferred<{ disconnected: boolean }>();
    let secondOnEvent: OnEvent | null = null;

    mockSendStream.mockImplementation(
      async (
        _msg: string,
        _ws: string,
        _tid: string | null,
        { onEvent }: { onEvent: OnEvent },
      ) => {
        if (mockSendStream.mock.calls.length === 1) {
          // Emit thread_id so subsequent history-load short-circuits.
          onEvent({ event: 'thread_id', thread_id: 'thread-demote-1' });
          return firstHang.promise;
        }
        // Second call = the steering POST. Capture the callback for the
        // test to drive directly.
        secondOnEvent = onEvent;
        return { disconnected: false };
      },
    );

    const { result } = renderHookWithProviders(() =>
      useChatMessages('ws-demote'),
    );

    // Fire the first message and let `isLoading` flip to true.
    let firstSend: Promise<unknown> = Promise.resolve();
    await act(async () => {
      firstSend = result.current.handleSendMessage('first turn');
      // Yield once so the synchronous setIsLoading flush propagates.
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(true);
    });

    // Second send while still streaming → routes to handleSendSteering.
    let steeringSend: Promise<unknown> = Promise.resolve();
    await act(async () => {
      steeringSend = result.current.handleSendMessage('follow-up steering');
      // Let the handler kick off and the mock implementation run.
      await Promise.resolve();
      await Promise.resolve();
    });

    // Two POSTs total now (original + steering).
    expect(mockSendStream).toHaveBeenCalledTimes(2);
    expect(secondOnEvent).not.toBeNull();

    // The user message added by handleSendSteering should be tagged
    // ``steering: true`` initially.
    await waitFor(() => {
      const userMsgs = result.current.messages.filter(
        (m): m is UserMessage => m.role === 'user',
      );
      // Two user messages: the original send and the steering send.
      expect(userMsgs.length).toBeGreaterThanOrEqual(2);
      const steeringUser = userMsgs[userMsgs.length - 1];
      expect((steeringUser as UserMessage & { steering?: boolean }).steering).toBe(true);
    });

    // Snapshot the assistants BEFORE demotion fires, so we can detect the
    // newly-appended one.
    const assistantsBefore = result.current.messages.filter(
      (m) => m.role === 'assistant',
    );

    // First non-steering event from the steering stream = backend opened a
    // new turn instead of accepting steering mid-flight. Per the SSE
    // protocol, the very first frame is ``metadata`` carrying the new run_id.
    await act(async () => {
      secondOnEvent!({
        event: 'metadata',
        thread_id: 'thread-demote-1',
        run_id: 'run-demoted-1',
      });
      // A subsequent message_chunk should render into the *new* assistant.
      secondOnEvent!({
        event: 'message_chunk',
        role: 'assistant',
        content: 'demoted reply',
        content_type: 'text',
        agent: 'main',
        id: 'msg-demoted-1',
      });
      await Promise.resolve();
    });

    // ---- (a) the user message is no longer flagged as steering ---------
    await waitFor(() => {
      const userMsgs = result.current.messages.filter(
        (m): m is UserMessage => m.role === 'user',
      );
      const steeringUser = userMsgs[userMsgs.length - 1] as UserMessage & {
        steering?: boolean;
      };
      expect(steeringUser.steering).toBeFalsy();
    });

    // ---- (b) a new assistant placeholder was appended ------------------
    const assistantsAfter = result.current.messages.filter(
      (m): m is AssistantMessage => m.role === 'assistant',
    );
    expect(assistantsAfter.length).toBe(assistantsBefore.length + 1);
    const demotedAssistant = assistantsAfter[assistantsAfter.length - 1];
    // The demoted assistant must be a fresh id, not the original one.
    if (assistantsBefore.length > 0) {
      expect(demotedAssistant.id).not.toBe(assistantsBefore[0].id);
    }

    // ---- (c) message_chunk content was routed into the NEW assistant ---
    // We mocked handleTextContent so it records the target assistantMessageId.
    expect(textContentCalls.length).toBeGreaterThan(0);
    const routedTo = textContentCalls[textContentCalls.length - 1].assistantMessageId;
    expect(routedTo).toBe(demotedAssistant.id);

    // Cleanup: release the first hang so the original POST resolves and
    // the awaiting handlers finish without leaking timers.
    firstHang.resolve({ disconnected: false });
    await act(async () => {
      await firstSend.catch(() => undefined);
      await steeringSend.catch(() => undefined);
    });
  });

  it('a demoted send the server failed to start outlives a reload, and its Retry sends it again under its key', async () => {
    const firstHang = deferred<{ disconnected: boolean }>();
    const steerAnswer = deferred<void>();
    mockSendStream.mockImplementation(
      async (
        _msg: string,
        _ws: string,
        _tid: string | null,
        { onEvent }: { onEvent: OnEvent },
      ) => {
        const call = mockSendStream.mock.calls.length;
        if (call === 1) {
          onEvent({ event: 'thread_id', thread_id: 'thread-demote-2' });
          return firstHang.promise;
        }
        if (call === 2) {
          // The running turn ends while the steer waits for admission, so the
          // thread is idle when it lands, and the START it opens fails before
          // the run exists.
          await steerAnswer.promise;
          onEvent({
            event: 'error',
            thread_id: 'thread-demote-2',
            error: 'start failed',
            error_type: 'workflow_error',
            recovery: 'resend',
          });
          return { disconnected: false };
        }
        onEvent({ event: 'metadata', thread_id: 'thread-demote-2', run_id: 'run-resent' });
        return { disconnected: false };
      },
    );

    const { result } = renderHookWithProviders(() => useChatMessages('ws-demote'));
    let firstSend: Promise<unknown> = Promise.resolve();
    await act(async () => {
      firstSend = result.current.handleSendMessage('first turn');
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.isLoading).toBe(true));
    let steeringSend: Promise<unknown> = Promise.resolve();
    await act(async () => {
      steeringSend = result.current.handleSendMessage('follow-up steering');
      await Promise.resolve();
    });
    firstHang.resolve({ disconnected: false });
    await act(async () => {
      await firstSend.catch(() => undefined);
    });
    steerAnswer.resolve();
    await act(async () => {
      await steeringSend;
    });

    // Nothing on the server holds it, so a reload, which keeps only what is
    // not history, must keep both bubbles.
    const followUp = result.current.messages.find(
      (m): m is UserMessage => m.role === 'user' && m.content === 'follow-up steering',
    );
    expect(followUp).toMatchObject({ unadmitted: true });
    expect(followUp?.isHistory).toBeFalsy();
    const failed = result.current.messages.filter((m): m is AssistantMessage => m.role === 'assistant').at(-1);
    expect(failed).toMatchObject({ error: true, unadmitted: true });
    expect(failed?.isHistory).toBeFalsy();

    await act(async () => {
      await result.current.handleRetry();
    });

    const steerKey = (mockSendStream.mock.calls[1][3] as { requestKey: string }).requestKey;
    expect(mockSendStream).toHaveBeenCalledTimes(3);
    expect(mockSendStream.mock.calls[2][0]).toBe('follow-up steering');
    expect((mockSendStream.mock.calls[2][3] as { requestKey: string }).requestKey).toBe(steerKey);
  });
  it('a demoted send whose resends the server never starts either keeps its message through a reload', async () => {
    const firstHang = deferred<{ disconnected: boolean }>();
    const steerAnswer = deferred<void>();
    const notStarted = (onEvent: OnEvent) => onEvent({
      event: 'retry',
      thread_id: 'thread-demote-3',
      auto_retry: true,
      error_type: 'timeout_error',
      retry_count: 1,
      max_retries: 3,
      recovery: 'resend',
    });
    mockSendStream.mockImplementation(
      async (
        _msg: string,
        _ws: string,
        _tid: string | null,
        { onEvent }: { onEvent: OnEvent },
      ) => {
        const call = mockSendStream.mock.calls.length;
        if (call === 1) {
          onEvent({ event: 'thread_id', thread_id: 'thread-demote-3' });
          return firstHang.promise;
        }
        if (call === 2) await steerAnswer.promise;
        notStarted(onEvent);
        return { disconnected: false };
      },
    );

    const { result } = renderHookWithProviders(() => useChatMessages('ws-demote'));
    let firstSend: Promise<unknown> = Promise.resolve();
    await act(async () => {
      firstSend = result.current.handleSendMessage('first turn');
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.isLoading).toBe(true));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let steeringSend: Promise<unknown> = Promise.resolve();
      await act(async () => {
        steeringSend = result.current.handleSendMessage('follow-up steering');
        await Promise.resolve();
      });
      firstHang.resolve({ disconnected: false });
      await act(async () => {
        await firstSend.catch(() => undefined);
      });
      steerAnswer.resolve();
      await act(async () => {
        await steeringSend;
      });
      for (const ms of [1000, 2000, 4000, 60_000]) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(ms);
        });
      }
    } finally {
      vi.useRealTimers();
    }

    // The steer and its three resends, none of which the server started.
    expect(mockSendStream).toHaveBeenCalledTimes(5);
    const followUp = result.current.messages.find(
      (m): m is UserMessage => m.role === 'user' && m.content === 'follow-up steering',
    );
    expect(followUp).toMatchObject({ unadmitted: true });
    expect(followUp?.isHistory).toBeFalsy();
    const failed = result.current.messages.filter((m): m is AssistantMessage => m.role === 'assistant').at(-1);
    expect(failed).toMatchObject({ error: true, unadmitted: true });
    expect(failed?.isHistory).toBeFalsy();
  });
});
