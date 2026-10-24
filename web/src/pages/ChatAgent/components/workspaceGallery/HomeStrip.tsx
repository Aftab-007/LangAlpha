/**
 * Home, as the slim strip above the grid. It is a system entry rather than one
 * of the user's workspaces, so it takes a row of its own instead of a card's
 * slot, and carries no machine line or menu.
 *
 * Its name, description and glyph come from `useWorkspaceText` and
 * `HomeRowIcon`, the one place Home is named, so this strip never spells it.
 */
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { HomeRowIcon } from '@/hooks/useHomeWorkspace';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useLocale } from '@/hooks/useLocale';
import { useWorkspaceText } from '@/hooks/useWorkspaceLabel';
import { relativeTime } from '@/lib/format';

import type { WorkspaceRecord } from './types';

interface HomeStripProps {
  workspace: WorkspaceRecord;
  now: number;
  /** Rise in with the gallery's first paint. Read once, at mount: a search
   *  that hides the strip and gives it back does not replay it. */
  entrance?: boolean;
  onSelect: (wsId: string, name?: string, status?: string) => void;
  prefetchThreads?: (wsId: string) => void;
}

export function HomeStrip({ workspace, now, entrance = true, onSelect, prefetchThreads }: HomeStripProps) {
  const [rises] = useState(entrance);
  const locale = useLocale();
  const isMobile = useIsMobile();
  const text = useWorkspaceText()(workspace);
  // Last used, as on the cards.
  const when = relativeTime(workspace.last_activity_at ?? workspace.updated_at, locale, now);

  // The entrance holds its last transform, so it sits on a wrapper and leaves
  // the strip itself free to rise under the pointer as the cards do.
  return (
    <div className={rises ? 'enter-fade-up' : undefined}>
      <button
        type="button"
        data-testid="home-strip"
        onClick={() => onSelect(workspace.workspace_id, text.name, workspace.status)}
        onMouseEnter={!isMobile ? () => prefetchThreads?.(workspace.workspace_id) : undefined}
        className="hover-lift group flex w-full min-w-0 items-center gap-3 rounded-xl px-4 py-3 text-left motion-safe:active:scale-[0.99]"
        style={{
          // A different material from the user's cards: flat elevated surface and
          // a crisp hairline; the glyph is its only accent.
          backgroundColor: 'var(--color-bg-elevated)',
          border: '1px solid var(--lift-edge, var(--color-border-default))',
        }}
      >
        <HomeRowIcon className="h-4 w-4 shrink-0" style={{ color: 'var(--color-accent-primary)' }} />
        <span className="shrink-0 font-medium" style={{ color: 'var(--color-text-primary)' }}>
          {text.name}
        </span>
        {/* One line, always: the strip is a row, and the description gives way to the name. */}
        <span className="hidden min-w-0 flex-1 truncate text-sm sm:block" style={{ color: 'var(--color-text-tertiary)' }}>
          {text.description}
        </span>
        <span className="flex-1 sm:hidden" />
        {when && (
          <span className="shrink-0 whitespace-nowrap text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            {when}
          </span>
        )}
        {/* Leans toward where a click goes. */}
        <ChevronRight
          className="h-4 w-4 shrink-0 transition-transform duration-150 motion-safe:group-hover:translate-x-0.5"
          style={{ color: 'var(--color-text-tertiary)' }}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

export default HomeStrip;
