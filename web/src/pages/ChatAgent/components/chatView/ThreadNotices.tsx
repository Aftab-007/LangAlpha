import type React from 'react';
import type { ComposerMode } from '@/lib/modelPreferences';
import type { DefaultModelOffer, RetiredModel } from '../../hooks/useThreadModel';
import { RetiredModelNotice, ThreadModelBanner } from './ThreadModelBanner';
import { ThreadSubagentsBanner } from './ThreadSubagentsBanner';

/** What `useThreadModel` raises above a composer. */
interface ModelNotices {
  retired: RetiredModel | null;
  offer: DefaultModelOffer | null;
  dismissOffer: () => void;
}

/** What `useThreadSubagents` raises above a composer. */
interface SubagentsNotices {
  offer: boolean | null;
  closeOffer: () => void;
  expireOffer: () => void;
}

/* The rows a thread's composer settings raise above it: why the thread moved
   off a retired model, and the offers to make a model pick or a subagents flip
   the default. Every host renders them from here, so the chat view and the
   market panels show the same rows. The chat view takes the offers alone and
   shows the retired line under its last reply, since its composer floats over
   the transcript and a bare line of text there reads as part of it. */
export function ThreadNotices({
  model,
  subagents,
  mode,
}: {
  model: ModelNotices;
  subagents: SubagentsNotices;
  mode: ComposerMode;
}): React.ReactElement {
  return (
    <>
      {/* Inset like the offer rows beside it. */}
      {model.retired && <RetiredModelNotice {...model.retired} className="px-3" />}
      <ThreadOffers model={model} subagents={subagents} mode={mode} />
    </>
  );
}

export function ThreadOffers({
  model,
  subagents,
  mode,
}: {
  model: Omit<ModelNotices, 'retired'>;
  subagents: SubagentsNotices;
  mode: ComposerMode;
}): React.ReactElement {
  return (
    <>
      {model.offer && <ThreadModelBanner {...model.offer} mode={mode} onDismiss={model.dismissOffer} />}
      {subagents.offer !== null && (
        // Keyed by the value, so an offer for the other side starts its own clock.
        <ThreadSubagentsBanner
          key={String(subagents.offer)}
          allowed={subagents.offer}
          onDismiss={subagents.closeOffer}
          onExpire={subagents.expireOffer}
        />
      )}
    </>
  );
}
