/**
 * The edit boxes a chat has open, held by the session rather than by the
 * bubbles. A reload rebuilds the transcript and remounts every bubble, so text
 * kept in a bubble went with it; kept here, an edit reopens on its message
 * once the reload shows it again. A draft is found by its thread, its turn and
 * the text it was typed over, never by a bubble id: replayed ids repeat from
 * thread to thread.
 */
import { useState, useSyncExternalStore } from 'react';

export interface EditDraft {
  threadId: string;
  turnIndex: number;
  /** The message's text when the box opened, which finds the message again. */
  original: string;
  text: string;
}

export interface EditDraftStore {
  /** The text of the open box over this message of the shown thread. */
  get: (turnIndex: number, original: string) => string | undefined;
  /** Opens a box or rewrites its text; without a thread, on the shown one. */
  put: (draft: Omit<EditDraft, 'threadId'> & { threadId?: string }) => void;
  drop: (turnIndex: number, original: string, threadId?: string) => void;
  /** The open boxes of a thread. */
  of: (threadId: string) => EditDraft[];
  /** Has the box over this message take the focus when it next shows: it
   *  held the focus when a reload took it away, or its edit came back. */
  markFocus: (turnIndex: number, original: string, threadId?: string) => void;
  /** Whether the box over this message is to take the focus; asking clears it. */
  takeFocus: (turnIndex: number, original: string) => boolean;
  subscribe: (listener: () => void) => () => void;
}

export function createEditDraftStore(shownThread: () => string | null): EditDraftStore {
  // Thread, then turn, then the boxes over that turn's messages.
  const byThread = new Map<string, Map<number, EditDraft[]>>();
  let focus: { threadId: string; turnIndex: number; original: string } | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  // A replayed message holds the text the server stored, which a send may
  // have trimmed.
  const find = (threadId: string | null, turnIndex: number, original: string) => {
    const drafts = threadId === null ? undefined : byThread.get(threadId)?.get(turnIndex);
    if (!drafts) return { drafts, at: -1 };
    const key = original.trim();
    return { drafts, at: drafts.findIndex((draft) => draft.original === key) };
  };
  return {
    get(turnIndex, original) {
      const { drafts, at } = find(shownThread(), turnIndex, original);
      return at === -1 ? undefined : drafts![at].text;
    },
    put({ threadId = shownThread() ?? undefined, turnIndex, original, text }) {
      if (threadId === undefined) return;
      const draft = { threadId, turnIndex, original: original.trim(), text };
      const { drafts, at } = find(threadId, turnIndex, original);
      if (at !== -1) {
        if (drafts![at].text === text) return;
        drafts![at] = draft;
      } else if (drafts) {
        drafts.push(draft);
      } else {
        let turns = byThread.get(threadId);
        if (!turns) byThread.set(threadId, (turns = new Map()));
        turns.set(turnIndex, [draft]);
      }
      notify();
    },
    drop(turnIndex, original, threadId = shownThread() ?? undefined) {
      if (threadId === undefined) return;
      const { drafts, at } = find(threadId, turnIndex, original);
      if (at === -1) return;
      drafts!.splice(at, 1);
      if (drafts!.length === 0) byThread.get(threadId)!.delete(turnIndex);
      notify();
    },
    of(threadId) {
      return [...(byThread.get(threadId)?.values() ?? [])].flat();
    },
    markFocus(turnIndex, original, threadId = shownThread() ?? undefined) {
      focus = threadId === undefined ? null : { threadId, turnIndex, original: original.trim() };
    },
    takeFocus(turnIndex, original) {
      const asked = focus !== null
        && focus.threadId === shownThread()
        && focus.turnIndex === turnIndex
        && focus.original === original.trim();
      if (asked) focus = null;
      return asked;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * The store a bubble keeps its edit in: its host's, or one of its own where
 * the host provides none, which keeps the edit only while the bubble lives.
 */
export function useEditDraftStore(hostStore: EditDraftStore | undefined): EditDraftStore {
  const [own] = useState(() => createEditDraftStore(() => ''));
  return hostStore ?? own;
}

/** The text of the open box over a message, read from `store`. */
export function useEditDraft(store: EditDraftStore, turnIndex: number, original: string | null): string | undefined {
  return useSyncExternalStore(store.subscribe, () => (original === null ? undefined : store.get(turnIndex, original)));
}
