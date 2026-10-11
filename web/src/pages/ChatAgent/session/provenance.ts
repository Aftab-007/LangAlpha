/**
 * Where a message came from when nobody typed it in this view: read off a
 * replayed query row's metadata, a live report-back's first frame, or a
 * subagent instruction's sender. Pure, so the mapping is pinned without
 * rendering anything; the label that draws it is
 * `components/messageList/MessageProvenance.tsx`.
 *
 * Every key is optional on the wire: rows written before a key existed, and a
 * share's replay, which drops `report_source`, must keep today's rendering.
 */
import type { ReportSource, ThreadOrigin } from '@/types/api';
import type { ChatMessage, MessageProvenance, UserMessage } from '@/types/chat';
import { messagingAppDomain } from '../components/messaging/messageDelivery';

/** Every instruction the main agent writes to a subagent carries the same label. */
export const MAIN_AGENT_PROVENANCE: MessageProvenance = Object.freeze({ kind: 'main_agent' });

/** The keys a query row's metadata names its sender by. */
export interface SenderMetadata {
  /** Who sent the turn; absent when the user did. */
  origin?: ThreadOrigin;
  /** The surface it arrived on, raw (`web`, `market_view:AAPL`, `telegram`, ...). */
  platform?: string;
}

/**
 * A report-back's row, named by what it reports on. Null without a source
 * (a share's replay, an older row), which keeps the row hidden as it always was.
 */
export function reportRowProvenance(source?: ReportSource): MessageProvenance | null {
  switch (source?.kind) {
    case 'analyst':
      return {
        kind: 'analyst_report',
        threadId: source.thread_id,
        workspaceId: source.workspace_id ?? null,
        workspaceName: source.workspace_name ?? null,
      };
    case 'task':
      return {
        kind: 'task_report',
        taskId: source.task_id,
        displayId: source.display_id,
        description: source.description ?? null,
        failed: source.failed,
      };
    default:
      return null;
  }
}

/**
 * Who sent a turn, or null when the user did. Who sent it (`origin`) wins over
 * where it arrived (`platform`): an automation can post through a channel, and
 * the automation is the answer. Only a chat app this build lists is labelled;
 * `web` and `market_view:*` are this app.
 */
export function senderProvenance(metadata?: SenderMetadata): MessageProvenance | null {
  const origin = metadata?.origin;
  if (origin?.type === 'agent') {
    return { kind: 'agent', agent: origin.agent ?? null, threadId: origin.id ?? null };
  }
  if (origin?.type === 'automation') {
    return { kind: 'automation', automationId: origin.id ?? null, name: origin.name ?? null };
  }
  const platform = metadata?.platform;
  if (platform && messagingAppDomain(platform)) return { kind: 'channel', platform };
  return null;
}

/**
 * A report-back attached live: its stream's first frame names the report, and
 * no user message comes with it, so the row is placed ahead of the bubble the
 * attach opened. The run's own row is kept wherever it is: a re-attach replays
 * the stream from its start, and history draws the row of a run that was
 * still going, or had just ended, when the page loaded. A row for another run
 * is not this one's, even right above it: a report-back that failed keeps its
 * row. Unstamped, like that bubble: an unstamped user row takes the turn the
 * assistant bubble after it opens.
 */
export function withLiveReportRow(
  messages: ChatMessage[],
  runId: string,
  source: ReportSource,
  beforeId: string | null,
): ChatMessage[] {
  const provenance = reportRowProvenance(source);
  if (!provenance) return messages;
  if (messages.some((m) => m.role === 'user' && m.runId === runId)) return messages;
  const found = beforeId ? messages.findIndex((m) => m.id === beforeId) : -1;
  const at = found === -1 ? messages.length : found;
  const row: UserMessage = {
    id: `report-${runId}`,
    role: 'user',
    content: '',
    contentType: 'text',
    timestamp: new Date(),
    isStreaming: false,
    provenance,
    runId,
  };
  return [...messages.slice(0, at), row, ...messages.slice(at)];
}
