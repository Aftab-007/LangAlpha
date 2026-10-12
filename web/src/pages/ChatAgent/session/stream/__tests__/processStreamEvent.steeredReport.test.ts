// @vitest-environment node
/**
 * A report a live turn took in mid-turn arrives as a `steering_delivered`
 * entry with a `report_source` and no words. It is drawn as the report's
 * caption row, and it is not the user's own steer: it must neither deliver the
 * bubble the user is still waiting on nor spend the boundary that steer's
 * acceptance set.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, UserMessage } from '@/types/chat';
import type { SSEEvent } from '../../types';
import { createStreamEventProcessor } from '../processStreamEvent';

type Processor = Parameters<typeof createStreamEventProcessor>;

const TASK = { kind: 'task', task_id: 'k3', display_id: 'Task-k3', description: 'Pull filings', failed: false };
const TASK_PROVENANCE = { kind: 'task_report', taskId: 'k3', displayId: 'Task-k3', description: 'Pull filings', failed: false };

function setup(initial: ChatMessage[]) {
  let messages = initial;
  const setMessages = (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    messages = updater(messages);
  };
  const steeringAtOrderRef = { current: 7 as number | null };
  const rt = {
    setMessages,
    queueMessages: setMessages,
    flushMessages: vi.fn(),
    lastEventIdRef: { current: null },
    threadIdRef: { current: 'thread-1' },
    currentMessageRef: { current: 'a1' },
  };
  const refs = {
    contentOrderCounterRef: { current: 0 },
    currentReasoningIdRef: { current: null },
    currentToolCallIdRef: { current: null },
    subagentStateRefs: {},
    steeringAtOrderRef,
    isReconnect: false,
  };
  const process = createStreamEventProcessor(
    rt as unknown as Processor[0],
    { clearModelStatus: () => {} } as unknown as Processor[1],
    'a1',
    refs as unknown as Processor[3],
    (event) => (event.agent as string) ?? null,
  );
  const deliver = (entries: Record<string, unknown>[]) =>
    process({ event: 'steering_delivered', messages: entries } as unknown as SSEEvent);
  return { deliver, steeringAtOrderRef, messages: () => messages };
}

const user = (id: string, extra: Partial<UserMessage> = {}): UserMessage => ({
  id, role: 'user', content: '', contentType: 'text', timestamp: new Date(0), isStreaming: false, ...extra,
});

const transcript = (): ChatMessage[] => [
  user('u0', { content: 'Compare the gaps', turnIndex: 0 }),
  { id: 'a1', role: 'assistant', content: 'working', contentType: 'text', isStreaming: true, turnIndex: 0 } as unknown as ChatMessage,
];

describe('live: a report the turn took in as a steer', () => {
  it('leaves the user\'s pending steer and its boundary for the delivery that takes it', () => {
    const { deliver, steeringAtOrderRef, messages } = setup([
      ...transcript(),
      user('s1', { content: 'also check margins', steering: true, turnIndex: 0 }),
    ]);

    deliver([{ content: '', report_source: TASK, timestamp: 1_700_000_000 }]);

    const rows = messages();
    expect(rows.find((m) => m.id === 's1')).toMatchObject({ steering: true });
    expect(rows.find((m) => m.id === 's1')).not.toHaveProperty('steeringDelivered');
    const report = rows.find((m) => m.id.startsWith('steering-report-')) as UserMessage;
    expect(report).toMatchObject({ content: '', steeringDelivered: true, provenance: TASK_PROVENANCE, turnIndex: 0 });
    expect(steeringAtOrderRef.current).toBe(7);
  });

  it('delivers the user\'s steer with the report, the row just before its bubble', () => {
    const { deliver, steeringAtOrderRef, messages } = setup([
      ...transcript(),
      user('s1', { content: 'also check margins', steering: true, turnIndex: 0 }),
    ]);

    deliver([
      { content: '', report_source: TASK },
      { content: 'also check margins' },
    ]);

    const rows = messages();
    const at = rows.findIndex((m) => m.id === 's1');
    expect(rows[at]).toMatchObject({ steering: false, steeringDelivered: true });
    expect(rows[at - 1]).toMatchObject({ provenance: TASK_PROVENANCE, steeringDelivered: true, content: '' });
    // Only the pending bubble exists for the user's words; none is made from the payload.
    expect(rows.filter((m) => m.role === 'user' && m.content === 'also check margins')).toHaveLength(1);
    expect(steeringAtOrderRef.current).toBeNull();
  });

  it('draws report then user rows in payload order when nothing is pending (reconnect)', () => {
    const { deliver, messages } = setup(transcript());

    deliver([
      { content: '', report_source: { kind: 'analyst', thread_id: 'th-a', workspace_name: 'Semis' } },
      { content: 'and margins', timestamp: 1_700_000_000 },
    ]);

    const rows = messages();
    const added = rows.slice(2, 4) as UserMessage[];
    expect(added[0]).toMatchObject({
      content: '',
      steeringDelivered: true,
      turnIndex: 0,
      provenance: { kind: 'analyst_report', threadId: 'th-a', workspaceId: null, workspaceName: 'Semis' },
    });
    expect(added[1]).toMatchObject({ content: 'and margins', steeringDelivered: true, turnIndex: 0 });
    // Then the steering continuation's assistant placeholder.
    expect(rows[4]).toMatchObject({ role: 'assistant', isSteering: true });
  });
});
