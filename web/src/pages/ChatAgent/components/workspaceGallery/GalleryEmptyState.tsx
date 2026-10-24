import { Plus, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useWelcomeOffer } from '@/pages/Onboarding/welcome/useWelcomeOffer';

interface GalleryEmptyStateProps {
  /** A search that matched nothing says so; it does not re-pitch the product. */
  isFiltered: boolean;
  onNewWorkspace: () => void;
}

export function GalleryEmptyState({ isFiltered, onNewWorkspace }: GalleryEmptyStateProps) {
  const { t } = useTranslation();
  const welcomeOffer = useWelcomeOffer();

  if (isFiltered) {
    return (
      <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
        {t('workspace.noWorkspacesFound')}
      </p>
    );
  }

  return (
    <>
      <p className="text-lg font-medium mb-2" style={{ color: 'var(--color-text-primary)' }}>
        {t('workspace.welcomeTitle')}
      </p>
      {/* Only names the profile when its button is here to back it. */}
      <p className="text-sm mb-8 max-w-sm" style={{ color: 'var(--color-text-tertiary)' }}>
        {welcomeOffer
          ? t('workspace.welcomeDesc')
          : t('workspace.welcomeDescCreate', "Create a workspace to keep a project's threads and files together.")}
      </p>
      <div className="flex flex-col sm:flex-row items-center gap-3">
        {welcomeOffer && (
          <button
            onClick={() => welcomeOffer.open()}
            className="flex items-center gap-2 px-6 py-3 rounded-lg transition-all hover:opacity-90 active:scale-[0.985]"
            style={{
              backgroundColor: 'var(--color-btn-primary-bg)',
              color: 'var(--color-btn-primary-text)',
            }}
          >
            <SlidersHorizontal className="h-5 w-5" />
            <span className="font-medium">{t('onboarding.welcome.entry')}</span>
          </button>
        )}
        <button
          onClick={onNewWorkspace}
          className="flex items-center gap-2 px-6 py-3 rounded-lg border transition-all hover:bg-foreground/5 hover:scale-[1.01] active:scale-[0.985]"
          style={{
            borderColor: 'var(--color-border-muted)',
            color: 'var(--color-text-primary)',
          }}
        >
          <Plus className="h-5 w-5" />
          <span className="font-medium">{t('workspace.createWorkspace')}</span>
        </button>
      </div>
    </>
  );
}

export default GalleryEmptyState;
