// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ReportSource } from '@/types/api';
import type { ChatMessage, UserMessage } from '@/types/chat';
import type { DeliveredReport, DeliveredSteer, SteeringDeliveredEntry } from '@/types/sse';
import { createAssistantMessage } from '../../../hooks/utils/messageHelpers';
import { deliveredEntryRow, foldSteeringDelivery, type DeliveredRowKind } from '../steeringDelivery';

const TASK: ReportSource = { kind: 'task', task_id: 'k3', display_id: 'Task-k3', description: 'Pull filings', failed: false };
const TASK_PROVENANCE = { kind: 'task_report', taskId: 'k3', displayId: 'Task-k3', description: 'Pull filings', failed: false };
const BANNER = { message: 'Steer failed to send' };

const report: DeliveredReport = { content: '', report_source: TASK, timestamp: 1_700_000_000 };
const steer = (content: string, extra: Partial<DeliveredSteer> = {}): DeliveredSteer => ({ content, ...extra });

type Failed = UserMessage & { queueError?: unknown };
const user = (id: string, extra: Partial<Failed> = {}): Failed => ({
  id, role: 'user', content: '', contentType: 'text', timestamp: new Date(0), isStreaming: false, turnIndex: 0, ...extra,
});
const waiting = (id: string, content: string, extra: Partial<Failed> = {}) => user(id, { content, steering: true, ...extra });
const failed = (id: string, content: string, extra: Partial<Failed> = {}) => user(id, { content, queueError: BANNER, ...extra });
const transcript = (): ChatMessage[] => [user('u0', { content: 'Compare the gaps' }), createAssistantMessage('a1', 0)];

function mint() {
  let n = 0;
  return (kind: DeliveredRowKind) => `${kind}-${n++}`;
}

const fold = (prev: ChatMessage[], entries: SteeringDeliveredEntry[], turnIndex: number | undefined = 0) =>
  foldSteeringDelivery(prev, entries, turnIndex, mint());
const byId = (messages: ChatMessage[], id: string) => messages.find((m) => m.id === id);

describe('deliveredEntryRow', () => {
  const at = new Date(1_700_000_000_000);
  const id = (kind: DeliveredRowKind) => `row-${kind}`;

  it('draws a report as its caption row, delivered steering in the turn it landed in', () => {
    expect(deliveredEntryRow(report, id, 2)).toEqual({
      id: 'row-report',
      role: 'user',
      content: '',
      contentType: 'text',
      timestamp: at,
      isStreaming: false,
      provenance: TASK_PROVENANCE,
      steeringDelivered: true,
      turnIndex: 2,
    });
  });

  it('leaves a report\'s turn unstamped when it is not known', () => {
    const row = deliveredEntryRow({ content: '', report_source: { kind: 'analyst', thread_id: 'th-a', workspace_name: 'Semis' } }, id, undefined);
    expect(row).toMatchObject({
      provenance: { kind: 'analyst_report', threadId: 'th-a', workspaceId: null, workspaceName: 'Semis' },
      steeringDelivered: true,
    });
    expect(row).not.toHaveProperty('turnIndex');
  });

  it('draws the user\'s words labelled with the chat app they came from', () => {
    expect(deliveredEntryRow(steer('from the phone', { platform: 'telegram', timestamp: 1_700_000_000 }), id, 2)).toEqual({
      id: 'row-user',
      role: 'user',
      content: 'from the phone',
      contentType: 'text',
      timestamp: at,
      isStreaming: false,
      steeringDelivered: true,
      turnIndex: 2,
      provenance: { kind: 'channel', platform: 'telegram' },
    });
  });

  it('draws nothing for what a share leaves of a report', () => {
    expect(deliveredEntryRow(steer(''), id, 2)).toBeNull();
  });
});

describe('foldSteeringDelivery: claiming', () => {
  it('marks the waiting steer delivered where it sits and makes no copy', () => {
    const prev = [...transcript(), waiting('s1', 'also check margins')];
    const { messages, clearedErrors } = fold(prev, [steer('also check margins')]);
    expect(messages.map((m) => m.id)).toEqual(['u0', 'a1', 's1']);
    expect(byId(messages, 's1')).toMatchObject({ steering: false, steeringDelivered: true });
    expect(clearedErrors).toEqual([]);
  });

  it('takes the waiting copy over a failed one', () => {
    const prev = [...transcript(), failed('f1', 'margins'), waiting('s1', 'margins')];
    const { messages } = fold(prev, [steer('margins')]);
    expect(byId(messages, 's1')).toMatchObject({ steeringDelivered: true });
    expect(byId(messages, 'f1')).toBe(prev[2]);
  });

  it('takes a failed steer the server may have queued, and clears its banner', () => {
    const prev = [...transcript(), failed('f1', 'margins')];
    const { messages, clearedErrors } = fold(prev, [steer('margins')]);
    expect(byId(messages, 'f1')).toMatchObject({ steeringDelivered: true });
    expect(byId(messages, 'f1')).not.toHaveProperty('queueError');
    expect(clearedErrors).toEqual([BANNER]);
  });

  it('keeps a banner another failed steer still holds', () => {
    const prev = [...transcript(), failed('f1', 'margins'), failed('f2', 'and capex')];
    const { clearedErrors } = fold(prev, [steer('margins')]);
    expect(clearedErrors).toEqual([]);
  });

  it.each([
    // The server refuses a steer before it queues it, so no delivery is its.
    ['a refused steer', failed('f1', 'margins', { queueRefused: true })],
    ['a steer of another turn', waiting('s1', 'margins', { turnIndex: 1 })],
  ])('leaves %s alone and draws the words as their own row', (_, bubble) => {
    const prev = [...transcript(), bubble];
    const { messages } = fold(prev, [steer('margins')]);
    expect(messages[2]).toBe(bubble);
    expect(messages[3]).toMatchObject({ id: 'user-0', content: 'margins', steeringDelivered: true, turnIndex: 0 });
  });

  it('returns the transcript itself when it draws and claims nothing', () => {
    const prev = [...transcript(), waiting('s1', 'margins')];
    expect(fold(prev, [steer('')]).messages).toBe(prev);
  });
});

describe('foldSteeringDelivery: placing reports', () => {
  it.each<[string, ChatMessage[], SteeringDeliveredEntry[], string[]]>([
    [
      'above the steer it is delivered with',
      [...transcript(), waiting('s1', 'margins')],
      [report, steer('margins')],
      ['u0', 'a1', 'report-0', 's1'],
    ],
    [
      // The user sent s1 just after the run took its queue: replay draws the
      // report above s1, so the live view does too.
      'alone, above a steer still waiting in the turn',
      [...transcript(), waiting('s1', 'margins')],
      [report],
      ['u0', 'a1', 'report-0', 's1'],
    ],
    [
      'alone, at the end when the waiting steer is another turn\'s',
      [...transcript(), waiting('s1', 'margins', { turnIndex: 1 })],
      [report],
      ['u0', 'a1', 's1', 'report-0'],
    ],
    [
      // Sent from another tab or a chat app: delivered, so above the steer
      // the model has yet to read.
      'a steer sent elsewhere, above a steer still waiting',
      [...transcript(), waiting('s1', 'margins')],
      [steer('and costs')],
      ['u0', 'a1', 'user-0', 's1'],
    ],
    [
      'reports, then a steer sent elsewhere, after the steer it delivers',
      [...transcript(), waiting('s1', 'margins'), waiting('s2', 'and costs')],
      [report, steer('margins'), steer('and capex')],
      ['u0', 'a1', 'report-0', 's1', 'user-1', 's2'],
    ],
    [
      'ahead of the user\'s rows when nothing is pending (reconnect)',
      transcript(),
      [report, steer('and margins')],
      ['u0', 'a1', 'report-0', 'user-1'],
    ],
  ])('%s', (_, prev, entries, ids) => {
    expect(fold(prev, entries).messages.map((m) => m.id)).toEqual(ids);
  });

  it('leaves the user\'s waiting steer waiting when only reports arrive', () => {
    const prev = [...transcript(), waiting('s1', 'margins')];
    const { messages } = fold(prev, [report]);
    expect(byId(messages, 's1')).toBe(prev[2]);
    expect(byId(messages, 'report-0')).toMatchObject({ provenance: TASK_PROVENANCE, steeringDelivered: true, turnIndex: 0 });
  });
});
