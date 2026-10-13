/**
 * A `steering_delivered` event read into the transcript: the steers it names
 * marked delivered, and a row for each entry no bubble stands for. Pure, so
 * the live stream and history replay draw an entry as the same row, and the
 * live fold is pinned without a stream.
 */
import type { ChatMessage, UserMessage } from '@/types/chat';
import { isDeliveredReport, type DeliveredSteer, type SteeringDeliveredEntry } from '@/types/sse';
import { reportRow, senderProvenance } from '../provenance';

/** A delivery's entries, typed once where the loose event shapes are read. */
export function steeringDeliveredEntries(event: { messages?: readonly unknown[] }): readonly SteeringDeliveredEntry[] {
  return (event.messages ?? []) as readonly SteeringDeliveredEntry[];
}

/** Which kind of row an id is minted for: each id scheme names it. */
export type DeliveredRowKind = 'report' | 'user';

/**
 * The row an entry is drawn as: a report's caption, or the user's words
 * labelled with the chat app they came from. Delivered steering, so it opens
 * no turn and offers no edit. Null for an entry with neither, which is what a
 * share leaves of a report.
 */
export function deliveredEntryRow(
  entry: SteeringDeliveredEntry,
  rowId: (kind: DeliveredRowKind) => string,
  turnIndex: number | undefined,
): UserMessage | null {
  const timestamp = entry.timestamp ? new Date(entry.timestamp * 1000) : new Date();
  if (isDeliveredReport(entry)) {
    return reportRow(entry.report_source, {
      id: rowId('report'),
      timestamp,
      steeringDelivered: true,
      ...(turnIndex !== undefined ? { turnIndex } : {}),
    });
  }
  if (!entry.content) return null;
  const provenance = senderProvenance({ platform: entry.platform });
  return {
    id: rowId('user'),
    role: 'user',
    content: entry.content,
    contentType: 'text',
    timestamp,
    isStreaming: false,
    steeringDelivered: true,
    turnIndex,
    ...(provenance ? { provenance } : {}),
  };
}

/**
 * Marks delivered the steers of the steered turn that a delivery names. The
 * server delivers a steer only to the run it was sent to, and hands back at
 * that run's end any it did not deliver, so a steer another turn holds, or one
 * the server has yet to queue, is not this delivery's. Each text claims the
 * oldest steer still waiting with it, then the oldest failed with no refusal:
 * the server may have taken that one and lost only the POST's answer, so the
 * run delivering it is that answer. A refused steer was never queued, so no
 * delivery is its. Returns the entries no steer claimed too: one batch can
 * carry steers sent from another tab or a channel beside this view's own.
 */
function claimDeliveredSteers(
  messages: ChatMessage[],
  delivered: readonly DeliveredSteer[],
  turn: number | undefined,
): { messages: ChatMessage[]; claimedAt: number[]; unclaimed: DeliveredSteer[] } {
  const unclaimed = [...delivered];
  const texts = unclaimed.map((q) => q.content.trim());
  const claimedAt: number[] = [];
  let next = messages;
  for (const waiting of [true, false]) {
    for (let i = 0; i < next.length && texts.length > 0; i++) {
      const m = next[i] as ChatMessage & { queueError?: unknown };
      if (m.role !== 'user' || (turn !== undefined && m.turnIndex !== turn)) continue;
      if (waiting ? !m.steering : (m.isHistory || !m.queueError || m.queueRefused || m.steeringDelivered)) continue;
      const at = texts.indexOf(String(m.content ?? '').trim());
      if (at === -1) continue;
      texts.splice(at, 1);
      unclaimed.splice(at, 1);
      const claimed: typeof m = { ...m, steering: false, steeringDelivered: true };
      delete claimed.queueError;
      if (next === messages) next = [...messages];
      next[i] = claimed;
      claimedAt.push(i);
    }
  }
  return { messages: next, claimedAt, unclaimed };
}

/** The first steer still waiting in the turn, or -1. */
function firstWaitingSteer(messages: readonly ChatMessage[], turnIndex: number | undefined): number {
  return messages.findIndex((m) =>
    m.role === 'user' && !!m.steering && (turnIndex === undefined || m.turnIndex === turnIndex));
}

/**
 * Adds the bubble a delivery opens for the model's next reply. It goes above
 * a steer still waiting in the turn: the model has yet to read that steer, and
 * replay draws it after this reply.
 */
export function withContinuation(
  messages: ChatMessage[],
  bubble: ChatMessage,
  turnIndex: number | undefined,
): ChatMessage[] {
  const at = firstWaitingSteer(messages, turnIndex);
  return at === -1 ? [...messages, bubble] : [...messages.slice(0, at), bubble, ...messages.slice(at)];
}

export interface SteeringDelivery {
  messages: ChatMessage[];
  /** The banners the failed steers it delivered raised, which no failed steer holds now. */
  clearedErrors: unknown[];
  /** The request keys of this view's steers it delivered: the server holds
   *  each of them now, so a later send of its text is new. */
  settledKeys: string[];
}

/**
 * Folds a live delivery into the transcript. A steer of this view's it names
 * gets no copy; the rest, which this view never held (sent elsewhere) or lost
 * on a reconnect, go after what it delivers, above any steer still waiting in
 * the turn, which the model has yet to read. Reports go ahead of the user's
 * words, as the model reads them: before the first steer this delivers, else
 * before the first still waiting in the turn (sent after the run took its
 * queue, and replay draws the report above it too), else at the end.
 */
export function foldSteeringDelivery(
  prev: ChatMessage[],
  entries: readonly SteeringDeliveredEntry[],
  turnIndex: number | undefined,
  rowId: (kind: DeliveredRowKind) => string,
): SteeringDelivery {
  const steers = entries.filter((e): e is DeliveredSteer => !isDeliveredReport(e));
  const { messages, claimedAt, unclaimed } = claimDeliveredSteers(prev, steers, turnIndex);
  const errorOf = (m: ChatMessage) => (m as { queueError?: unknown }).queueError;
  const clearedErrors = claimedAt.map((i) => errorOf(prev[i]))
    .filter((e) => e !== undefined && !messages.some((m) => errorOf(m) === e));
  const settledKeys = claimedAt.map((i) => (prev[i] as { requestKey?: string }).requestKey)
    .filter((key): key is string => !!key);
  const rows = (list: readonly SteeringDeliveredEntry[]) => list
    .map((e) => deliveredEntryRow(e, rowId, turnIndex))
    .filter((m): m is UserMessage => m !== null);
  const reports = rows(entries.filter(isDeliveredReport));
  const added = rows(unclaimed);
  if (reports.length === 0 && added.length === 0) return { messages, clearedErrors, settledKeys };
  const waiting = firstWaitingSteer(messages, turnIndex);
  const at = claimedAt.length > 0 ? Math.min(...claimedAt) : waiting === -1 ? messages.length : waiting;
  const end = waiting === -1 ? messages.length : Math.max(waiting, at);
  return {
    messages: [...messages.slice(0, at), ...reports, ...messages.slice(at, end), ...added, ...messages.slice(end)],
    clearedErrors,
    settledKeys,
  };
}
