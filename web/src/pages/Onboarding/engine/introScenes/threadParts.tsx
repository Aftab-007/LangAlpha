import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useAgentNames } from '../introAgents';
import { VIEW } from './camera';
import { useSceneTime } from './clock';
import { InputDock, Tag, Typed } from './kit';
import { ChatHeaderButtons, PanelStrip } from './panelParts';
import { TopTitle, Transcript } from './transcriptParts';

/* The thread page the thread intro's scenes play on: the chat column beside
   the file panel, the panel a full-height column with its own tab strip.
   Each part is a small copy of the component the app draws it with; the
   transcript's own parts are in transcriptParts.tsx. */

/** The file panel's width in the 400px scene; the chat column takes the rest. */
export const PANEL_W = 212;

/** A glyph in the chrome of a tab's own body (the Memory and Memo tabs). */
export function ChromeIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon className="h-2 w-2 shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />;
}

/** The chat column's header (`ChatView`'s top bar): back, the thread's
    `title`, the agent, and share. The panel is open beside it, so the panel
    toggle is in the panel's corner rather than here. This page's header
    sets the arrow 6px from the title where the chat scenes' set it 4px, and
    keeps the agent's tag at the right, by the buttons. */
function ChatHeader({ title }: { title: string }) {
  const { worker } = useAgentNames();
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5 pl-2.5 pr-[9px]">
      <TopTitle className="gap-1.5">{title}</TopTitle>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <Tag>{worker}</Tag>
        <ChatHeaderButtons panelOpen />
      </span>
    </div>
  );
}

/** The page's header row: the chat header beside the panel's tab strip. */
export const HEADER_H = 28;

/**
 * The thread page alone, drawn at the view's size (`VIEW`) for a scene's
 * `Camera` to crop: the chat column with its header (the thread's `title`)
 * beside the file panel, whose tab strip (`tabs`, with `back` and `tree` as
 * `PanelStrip` reads them) sits level with the chat header and `panel` fills
 * the rest. `stack` places the transcript: from the top for a new thread, or
 * settled on the composer for one with history above, the oldest lines
 * running off the top as the newest come in. `ask` is typed into the
 * composer from `at`, `cps` characters a second, and sent at `send`.
 */
export function ThreadPage({
  title,
  tabs,
  back,
  tree,
  chat,
  panel,
  ask,
  stack = 'top',
}: {
  title: string;
  tabs: ReactNode;
  back?: boolean;
  tree?: boolean;
  chat: ReactNode;
  panel: ReactNode;
  ask?: { text: string; at: number; send: number; cps: number };
  stack?: 'top' | 'bottom';
}) {
  const t = useSceneTime();
  const typing = ask && t >= ask.at && t < ask.send;
  return (
    <div className="relative flex flex-col" style={VIEW}>
      <div
        className="flex shrink-0 items-stretch border-b"
        style={{ height: HEADER_H, borderColor: 'var(--color-border-muted)' }}
      >
        <ChatHeader title={title} />
        <PanelStrip
          tabs={tabs}
          back={back}
          tree={tree}
          className="border-l"
          style={{ width: PANEL_W, borderColor: 'var(--color-border-muted)' }}
        />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-2.5">
          {stack === 'bottom' ? <Transcript settled>{chat}</Transcript> : chat}
          <InputDock
            text={typing ? <Typed text={ask.text} at={ask.at} cps={ask.cps} /> : undefined}
            sendAt={ask && [ask.send]}
          />
        </div>
        <div
          className="flex shrink-0 flex-col border-l"
          style={{ width: PANEL_W, borderColor: 'var(--color-border-muted)' }}
        >
          {panel}
        </div>
      </div>
    </div>
  );
}
