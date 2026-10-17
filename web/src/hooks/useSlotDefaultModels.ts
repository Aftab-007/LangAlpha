import { useAllModels } from './useAllModels';
import { usePreferences } from './usePreferences';
import { slotDefaultModel, modelPrefs, type ModelSlot } from '@/lib/modelPreferences';

/**
 * The account's default model for each slot, as the composer, the
 * thread model controls and a default change all read it.
 *
 * `null` until the preference is read: before that the server may run a
 * stored model this client cannot name, and claiming the deployment default
 * in its place would send that model, and its tuning, by mistake. A read that
 * found no preferences row (a reset deletes it) is known, and runs the
 * deployment's defaults.
 */
export function useSlotDefaultModels(): Record<ModelSlot, string | null> {
  const { preferences, isLoaded } = usePreferences();
  const { systemDefaults } = useAllModels();
  if (!isLoaded) return { default: null, background: null };
  const prefs = modelPrefs(preferences);
  return {
    default: slotDefaultModel(prefs, systemDefaults, 'default'),
    background: slotDefaultModel(prefs, systemDefaults, 'background'),
  };
}

/** The account's Default slot, which every composer and thread starts on. */
export function useDefaultModel(): string | null {
  return useSlotDefaultModels().default;
}
