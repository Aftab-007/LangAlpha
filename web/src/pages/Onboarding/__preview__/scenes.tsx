import { FrozenSceneTime } from '@/pages/Onboarding/engine/introScenes/clock';
import { INTRO_SCENES } from '@/pages/Onboarding/engine/introScenes';
import { SceneStage } from '@/pages/Onboarding/engine/introScenes/SceneStage';
import type { IntroVisualId } from '@/pages/Onboarding/registry';
import '@/pages/Onboarding/engine/pageIntro.css';

/** The intro modal's visual column at the full 980px dialog: 7/12 of it. */
const PANEL = { width: 572, height: 500 };

/**
 * One scene in a stand-in for the modal's visual panel. Without `frames` it
 * plays live; with them, each frame is the scene pinned at that time (ms),
 * laid out as a contact sheet so a whole script reads in one screenshot.
 */
export function ScenePreview({ visual, frames }: { visual: IntroVisualId; frames: number[] | null }) {
  const panel = (
    <div className="intro-visual flex items-center rounded-xl" style={PANEL}>
      <SceneStage visual={visual} />
    </div>
  );
  if (!frames) {
    return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>{panel}</div>;
  }
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(2, ${PANEL.width}px)`,
        gap: 16,
        padding: 16,
      }}
    >
      {frames.map((t) => (
        <div key={t}>
          <div
            style={{
              marginBottom: 4,
              fontFamily: 'ui-monospace, monospace',
              fontSize: 12,
              color: 'var(--color-text-tertiary)',
            }}
          >
            {visual} · {t}ms / {INTRO_SCENES[visual].length}ms
          </div>
          <FrozenSceneTime.Provider value={t}>{panel}</FrozenSceneTime.Provider>
        </div>
      ))}
    </div>
  );
}
