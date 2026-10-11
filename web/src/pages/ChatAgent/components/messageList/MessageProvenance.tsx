/**
 * The caption above a message nobody typed in this view, naming who sent it:
 * an agent's hand-off, an automation, a channel, a subagent's main agent. A
 * report-back is drawn as this caption alone, in place of its hidden message.
 *
 * Where the sender has a place in the app the caption links there. Read-only
 * views draw it without the link, as they draw a card's.
 */
import React from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Bot, CircleCheck, CircleX, Clock, CornerDownRight, Inbox, MessageCircle, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAllWorkspacesAgent } from '@/hooks/useAllWorkspacesAgent';
import type { MessageProvenance } from '@/types/chat';
import { useRouteLeaveGuard } from '../../contexts/RouteLeaveGuardContext';
import { useOpenDispatchedThread, type DispatcherContext } from '../../hooks/useOpenDispatchedThread';
import { Favicon } from '../Favicon';
import { messagingAppDomain, messagingAppName } from '../messaging/messageDelivery';
import { useMessageActions } from './MessageActionsContext';

const CAPTION = 'inline-flex max-w-full min-w-0 items-center gap-1.5 text-xs leading-4 text-(--color-text-tertiary)';
// The padding gives the hover fill room, and the negative margins and the shift
// take it back so a linked caption sits exactly where a plain one does: its
// text on the bubble's edge, its line no taller. The shift is a translate, not
// a negative margin: the caption sits in a box sized to it, and a negative
// right margin would shrink that box below the text and truncate it.
const LINKED = cn(
  CAPTION,
  '-my-0.5 translate-x-1.5 cursor-pointer rounded-md px-1.5 py-0.5 text-left outline-hidden transition-colors',
  'hover:bg-(--color-bg-hover) hover:text-(--color-text-secondary) focus-visible:ring-2 focus-visible:ring-ring',
);

interface MessageProvenanceProps {
  provenance: MessageProvenance;
  readOnly?: boolean;
  /** The thread this transcript belongs to when it hands work out, which an
   *  Analyst's thread opened from here links back to (as its hand-off card does). */
  flashContext?: DispatcherContext | null;
  className?: string;
}

export function MessageProvenanceLabel({ provenance, readOnly, flashContext, className }: MessageProvenanceProps): React.ReactElement | null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const guardLeave = useRouteLeaveGuard();
  const openDispatchedThread = useOpenDispatchedThread(flashContext);
  const { onOpenDispatcher, onOpenSubagentTask } = useMessageActions();

  let Icon: LucideIcon;
  let logo: React.ReactNode = null;
  let label: React.ReactNode;
  let title: string | undefined;
  let open: (() => void) | null = null;

  switch (provenance.kind) {
    case 'agent': {
      // A hand-off with no recorded dispatcher is named by the viewer's own
      // flags, which a share's viewer does not share with its owner; it stays
      // unlabelled there, as shares showed it before.
      if (!provenance.agent && readOnly) return null;
      Icon = Bot;
      label = provenance.agent === 'chief_of_staff'
        ? t('chat.provenance.fromChiefOfStaff')
        : provenance.agent === 'flash'
          ? t('chat.provenance.fromFlash')
          : <UnrecordedDispatcher />;
      const { threadId } = provenance;
      if (threadId && onOpenDispatcher) open = () => guardLeave(() => onOpenDispatcher(threadId));
      break;
    }
    case 'automation': {
      Icon = Clock;
      label = provenance.name
        ? t('chat.provenance.automationNamed', { name: provenance.name })
        : t('chat.provenance.automation');
      const { automationId } = provenance;
      if (automationId) open = () => guardLeave(() => navigate(`/automations?id=${encodeURIComponent(automationId)}`));
      break;
    }
    case 'channel': {
      // The app's own logo, as its tab in the file panel shows it.
      Icon = MessageCircle;
      const domain = messagingAppDomain(provenance.platform);
      if (domain) logo = <Favicon domain={domain} size={14} />;
      label = t('chat.provenance.viaChannel', { platform: messagingAppName(provenance.platform) });
      break;
    }
    case 'main_agent':
      Icon = CornerDownRight;
      label = t('chat.provenance.fromMainAgent');
      break;
    case 'analyst_report': {
      Icon = Inbox;
      label = provenance.workspaceName
        ? t('chat.provenance.reportFrom', { name: provenance.workspaceName })
        : t('chat.provenance.reportFromAnalyst');
      const { threadId, workspaceId } = provenance;
      if (threadId) open = () => openDispatchedThread(threadId, workspaceId);
      break;
    }
    case 'task_report': {
      Icon = provenance.failed ? CircleX : CircleCheck;
      label = t(provenance.failed ? 'chat.provenance.taskFailed' : 'chat.provenance.taskFinished', { id: provenance.displayId });
      // The display id alone says little; the task's own words say which.
      title = provenance.description ?? undefined;
      const { taskId, description } = provenance;
      if (taskId && onOpenSubagentTask) {
        open = () => onOpenSubagentTask({ subagentId: `task:${taskId}`, ...(description ? { description } : {}) });
      }
      break;
    }
  }
  // A long name truncates; the whole caption is a hover away.
  title ??= typeof label === 'string' ? label : undefined;

  const content = (
    <>
      {logo ?? <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />}
      <span className="min-w-0 truncate">{label}</span>
    </>
  );

  if (open && !readOnly) {
    return (
      <button type="button" className={cn(LINKED, className)} title={title} onClick={open}>
        {content}
        <ArrowUpRight aria-hidden="true" className="h-3 w-3 shrink-0" />
      </button>
    );
  }
  return (
    <span className={cn(CAPTION, className)} title={title}>
      {content}
    </span>
  );
}

/**
 * A hand-off recorded before the row named its dispatcher. Whichever agent
 * runs outside a workspace for this user now is the best reading, the same
 * one the thread's back button makes.
 */
function UnrecordedDispatcher(): React.ReactElement {
  const { t } = useTranslation();
  const allWorkspaces = useAllWorkspacesAgent();
  return <>{allWorkspaces ? t('chat.provenance.fromChiefOfStaff') : t('chat.provenance.fromFlash')}</>;
}
