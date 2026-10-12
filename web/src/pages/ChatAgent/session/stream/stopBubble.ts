import { finalizeAssistantMessage } from './finalizeMessage';
import { handleReasoningSignal, handleTextContent } from './mainEventHandlers';
import type { MessageRecord, SetMessages } from '../../hooks/utils/types';
import type { StreamRefs } from '../streamRefs';

/**
 * Settles a bubble whose run was stopped, wherever the stop came from: this
 * tab's Stop, or a cancel from elsewhere that the stream reports as its
 * `run_end`. Neither carries the closes a finished model call would, so the
 * open thought and tool rows are closed here through the same handlers, or
 * they keep ticking until a reload shows the reply as the server holds it.
 */
export function settleStoppedBubble({ assistantMessageId, refs, setMessages }: {
  assistantMessageId: string;
  refs: StreamRefs;
  setMessages: SetMessages;
}): void {
  handleReasoningSignal({ assistantMessageId, signalContent: 'complete', refs, setMessages });
  handleTextContent({ assistantMessageId, content: '', finishReason: 'stopped', refs, setMessages });
  // Always-live tools (TaskOutput, WebFetch) spin off `isInProgress` whatever
  // `isStreaming` says, so their rows fold here too.
  setMessages((prev: MessageRecord[]) => prev.map((msg) => {
    if (msg.id !== assistantMessageId) return msg;
    const tp: Record<string, MessageRecord> = {};
    for (const [id, val] of Object.entries((msg.toolCallProcesses as Record<string, MessageRecord>) || {})) {
      tp[id] = val.isInProgress ? { ...val, isInProgress: false, isComplete: true } : val;
    }
    return { ...finalizeAssistantMessage(msg, 'stopped'), toolCallProcesses: tp };
  }));
}
