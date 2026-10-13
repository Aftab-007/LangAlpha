import { useTranslation } from 'react-i18next';
import { deletePlugin, setPluginEnabled, type PluginInfo } from '@/pages/ChatAgent/utils/api';
import type { BulkRunOptions } from '../components/useBulkSelection';
import { buildBulkActions, type BulkActions } from '../utils/bulkActions';
import { hasLifecycle } from '../utils/pluginSurface';
import { pluginRowKey } from '../utils/rowKeys';
import type { PluginListSurface } from './usePluginListSurface';

/**
 * The select-mode actions for Plugins: switch on, switch off, uninstall. No
 * workspaces entry: a plugin is on or off for the account, and its connectors
 * and skills each carry their own reach. Built-in plugins switch but never
 * uninstall, which the bar says rather than leaving the count to explain.
 */
export function usePluginBulkActions(
  /** The rows on screen, not the whole account: see useBulkSelection. */
  visible: readonly PluginInfo[],
  surface: PluginListSurface,
  /** Starts the sign-in a switch-on was refused for, until a connector is
   *  signed in to. */
  signIn?: BulkRunOptions['signIn'],
): BulkActions {
  const { t } = useTranslation();
  const selected = visible.filter((p) => surface.selection.selected.has(pluginRowKey(p)));
  return buildBulkActions(t, surface, selected, {
    noun: 'plugin',
    key: pluginRowKey,
    name: (p) => p.name,
    isOn: (p) => p.enabled,
    setEnabled: (p, on) => setPluginEnabled(p.name, on),
    remove: {
      verb: 'uninstall',
      labelKey: 'plugins.bulk.uninstall',
      confirmKey: 'plugins.bulk.confirmUninstall',
      eligible: hasLifecycle,
      run: (p) => deletePlugin(p.name),
    },
    keptKey: 'plugins.bulk.keptPlugins',
    signIn,
  });
}
