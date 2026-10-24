import { MoreHorizontal, Pin } from 'lucide-react';

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useWorkspaceText } from '@/hooks/useWorkspaceLabel';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useLocale } from '@/hooks/useLocale';
import { relativeTime } from '@/lib/format';
import type { Computer } from '@/types/api';

import { WorkspaceMenuItems } from '../workspaceActions';
import { MachineSummary } from './MachineSummary';
import type { WorkspaceRecord } from './types';

interface CardMenuProps {
  workspace: WorkspaceRecord;
  onTogglePin: (workspace: WorkspaceRecord) => void;
  onRename: (workspace: WorkspaceRecord) => void;
  onDuplicate: (workspace: WorkspaceRecord) => void;
  onMove?: (workspace: WorkspaceRecord) => void;
  onDelete: (workspace: WorkspaceRecord) => void;
}

/** Card menu dropdown (Pin / Rename / Duplicate / Move / Delete). */
function CardMenu({ workspace, onTogglePin, onRename, onDuplicate, onMove, onDelete }: CardMenuProps) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="h-7 w-7 rounded-md transition-colors flex items-center justify-center hover:bg-(--color-border-muted)"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4}>
        <WorkspaceMenuItems
          workspace={workspace}
          onTogglePin={onTogglePin}
          onRename={onRename}
          onDuplicate={onDuplicate}
          onMove={onMove}
          onDelete={onDelete}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface WorkspaceCardProps {
  workspace: WorkspaceRecord;
  /** The machine this workspace lives on, given only when the user has more
   *  than one: with one, the toolbar names it and the card does not. */
  computer?: Computer | null;
  /** Whether that machine is the Mac this desktop app runs on. */
  isThisMac?: boolean;
  /** The clock the relative times read from, one for the whole grid. */
  now: number;
  onSelect: (wsId: string, name?: string, status?: string) => void;
  onTogglePin: (workspace: WorkspaceRecord) => void;
  onRenameStart: (workspace: WorkspaceRecord) => void;
  /** Open the Computers dialog on this card's machine. */
  onOpenComputer?: (computerId: string) => void;
  onDuplicate: (workspace: WorkspaceRecord) => void;
  onMove?: (workspace: WorkspaceRecord) => void;
  onDelete: (workspace: WorkspaceRecord) => void;
  prefetchThreads?: (wsId: string) => void;
  index?: number;
}

/**
 * A workspace in the gallery grid: its name and when it was last used, its
 * description, and the machine it lives on when there is more than one. Home
 * is not a card; the gallery draws it as the strip above the grid.
 */
export function WorkspaceCard({
  workspace,
  computer,
  isThisMac = false,
  now,
  onSelect,
  onTogglePin,
  onRenameStart,
  onOpenComputer,
  onDuplicate,
  onMove,
  onDelete,
  prefetchThreads,
  index,
}: WorkspaceCardProps) {
  const locale = useLocale();
  const isMobile = useIsMobile();
  const text = useWorkspaceText()(workspace);
  // When it was last used, the time the Recent order sorts on, whatever order
  // is picked: `updated_at` alone moves on a rename, pin or reorder. An
  // unreadable timestamp reads as no timestamp, not as "now".
  const when = relativeTime(workspace.last_activity_at ?? workspace.updated_at, locale, now);

  const menu = (
    <CardMenu
      workspace={workspace}
      onTogglePin={onTogglePin}
      onRename={onRenameStart}
      onDuplicate={onDuplicate}
      onMove={onMove}
      onDelete={onDelete}
    />
  );

  return (
    <div
      className="enter-fade-up relative group h-full"
      style={{ animationDelay: `${Math.min(index ?? 0, 12) * 40}ms` }}
      data-testid="workspace-card"
      onMouseEnter={!isMobile ? () => prefetchThreads?.(workspace.workspace_id) : undefined}
    >
      <div
        onClick={() => onSelect(workspace.workspace_id, text.name, workspace.status)}
        className="relative flex h-full w-full cursor-pointer flex-col gap-1.5 overflow-hidden rounded-xl py-3.5 pl-[18px] pr-4 md:px-5 md:py-4 transition-all ease-in-out hover:shadow-xs active:scale-[0.98]"
        style={{
          background: 'var(--color-bg-card-gradient, linear-gradient(to bottom, var(--color-border-muted), var(--color-border-muted)))',
          border: '1px solid var(--color-bg-card-border, var(--color-border-muted))',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
      >
        {/* On a phone the menu stays in the corner, so the row leaves it room. */}
        <div className={`flex items-start gap-2 min-w-0${isMobile ? ' pr-7' : ''}`}>
          {workspace.is_pinned && (
            <Pin className="mt-1 h-3.5 w-3.5 shrink-0 rotate-45" style={{ color: 'var(--color-text-tertiary)' }} />
          )}
          {/* A phone's single column is narrow, so a long name takes a second line there. */}
          <div className="font-medium flex-1 min-w-0 line-clamp-2 md:line-clamp-1 break-words" style={{ color: 'var(--color-text-primary)' }}>
            {text.name}
          </div>
          {when && (
            // On a pointer the menu takes this corner on hover, so the time
            // steps aside rather than sitting under it.
            <span
              className={`shrink-0 pt-0.5 text-xs whitespace-nowrap${isMobile ? '' : ' group-hover:invisible group-focus-within:invisible'}`}
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              {when}
            </span>
          )}
        </div>
        {/* In the grid the description always holds two lines, filled or not,
            so the machine line sits at the same height on every card. A phone's
            single column has no neighbours to match and drops an empty one. */}
        <div
          className={`text-sm line-clamp-2 md:min-h-[2lh]${text.description ? '' : ' hidden md:block'}`}
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          {text.description}
        </div>
        {computer && (
          <div className="mt-auto pt-2.5">
            <MachineSummary computer={computer} isThisMac={isThisMac} onOpen={onOpenComputer} />
          </div>
        )}
      </div>

      {/* Outside the clickable card: a menu item's click would otherwise
          bubble (through the portal) into opening the workspace. */}
      <div className={`absolute top-2.5 right-3 z-10 transition-opacity ${isMobile ? 'opacity-70' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'}`}>
        {menu}
      </div>
    </div>
  );
}

export default WorkspaceCard;
