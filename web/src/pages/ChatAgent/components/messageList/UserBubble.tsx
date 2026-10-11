/**
 * A user-role message's bubble, under the caption naming who sent it when
 * someone other than the user here did. The transcript, its report-back rows
 * and a subagent's opening prompt all draw it, so a caption sits the same
 * distance above its bubble in each.
 */
import React from 'react';
import { cn } from '@/lib/utils';
import type { MessageProvenance } from '@/types/chat';
import { MessageProvenanceLabel } from './MessageProvenance';

type CaptionProps = React.ComponentProps<typeof MessageProvenanceLabel>;

interface UserBubbleProps {
  provenance?: MessageProvenance;
  readOnly?: boolean;
  flashContext?: CaptionProps['flashContext'];
  isMobile?: boolean;
  /** Goes on the outermost element: the captioned column, or the bubble alone. */
  className?: string;
  /** The bubble's content. A report-back passes none: its caption is the whole
   *  row, in place of a message written for the model. */
  children?: React.ReactNode;
}

export function UserBubble({ provenance, readOnly, flashContext, isMobile, className, children }: UserBubbleProps): React.ReactElement | null {
  const bubble = children === undefined ? null : (
    <div
      className={cn('overflow-hidden rounded-xl', isMobile ? 'px-3 py-2' : 'px-4 py-3', !provenance && className)}
      style={{ backgroundColor: 'var(--color-bg-elevated)', color: 'var(--color-text-primary)' }}
    >
      {children}
    </div>
  );
  if (!provenance) return bubble;
  return (
    <div className={cn('flex min-w-0 max-w-full flex-col items-end gap-1.5', className)}>
      <MessageProvenanceLabel provenance={provenance} readOnly={readOnly} flashContext={flashContext} />
      {bubble}
    </div>
  );
}
