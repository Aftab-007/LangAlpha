/**
 * Message classification shared by the transcript renderer and the turn-index
 * math. Steering bubbles are mid-turn injections with NO backend turn boundary
 * of their own, so every consumer must classify them identically — the edit
 * gate, the regenerate tail, and the turn projection each carried their own
 * inline `role === 'assistant' && !isSteering` check before this module.
 */
import type { MessageProvenance } from '@/types/chat';

/** The subset of message fields the predicates read. Structural so both the
 *  loose `MessageRecord` wire shape and the typed `ChatMessage` union fit. */
export interface MessageLike {
  role?: unknown;
  steering?: unknown;
  steeringDelivered?: unknown;
  isSteering?: unknown;
  queueError?: unknown;
}

/**
 * A user bubble that was injected into a RUNNING turn (queued or already
 * delivered as steering). It has no `/turns` checkpoint of its own, so an edit
 * fork would land on the NEXT turn and leave the original steering text in the
 * agent's context — the pencil is hidden for these and the hook refuses them.
 */
export function isSteeringUserMessage(message: MessageLike): boolean {
  if (message.role !== 'user') return false;
  return !!message.steeringDelivered || !!message.steering;
}

/**
 * The user message a turn starts from. A steer that failed to send is none
 * either: it was typed into the running turn and stays inside it. A send the
 * server refused before admitting it keeps the count the next send then takes
 * too, so a turn can hold two of these, and the later one is the turn's.
 */
export function opensTurn(message: MessageLike): boolean {
  return message.role === 'user' && !isSteeringUserMessage(message) && !message.queueError;
}

/**
 * An assistant bubble that CONTINUES the turn its predecessor opened (the
 * agent resumed after consuming steering). It is not a turn of its own: the
 * turn index folds back to the bubble it continues, and regenerate re-runs the
 * whole turn from the opener's checkpoint.
 */
export function isSteeringContinuation(message: MessageLike): boolean {
  return message.role === 'assistant' && !!message.isSteering;
}

/**
 * A report-back's row: the turn's own message is written for the model, so
 * the row is drawn as its label alone, with no bubble, actions or minimap
 * entry. It still opens its turn like any user message.
 */
export function isReportRow(message: MessageLike & { provenance?: unknown }): boolean {
  if (message.role !== 'user') return false;
  const kind = (message.provenance as MessageProvenance | undefined)?.kind;
  return kind === 'analyst_report' || kind === 'task_report';
}
