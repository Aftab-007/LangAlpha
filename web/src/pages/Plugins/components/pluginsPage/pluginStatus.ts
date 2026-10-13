import type { TFunction } from 'i18next';
import { serverKeyRefs } from '@/hooks/useSecretUsage';
import type { CatalogServer, MarketplaceEntry, PluginInfo } from '@/pages/ChatAgent/utils/api';
import {
  connectorState,
  pluginConnectors,
  pluginProblem,
  type ConnectorState,
  type PluginProblem,
} from '../../utils/connectorState';
import { isBundled } from '../../utils/pluginSurface';
import { connectorNeedsUser } from '../connectors/attention';

const KEY_REJECTED = 'mcp.probe.rowCredentialRejected';

/** What fixes a plugin's problem, which its cell and its page both offer. */
export type PluginFix =
  /** A key a check found missing: Secrets' add form, with its name. */
  | { kind: 'addKey'; key: string }
  /** A key a server refused: that key's own form, or Secrets when the
   *  refusing connectors read more than one, since which is wrong is not
   *  known. `by` are those connectors. */
  | { kind: 'replaceKey'; key: string | null; by: CatalogServer[] }
  /** The sign-in `server` waits on. */
  | { kind: 'signIn' }
  /** Anything else, which `server`'s own page says how to fix. */
  | { kind: 'open' };

/**
 * A plugin read the way every surface says it: the problem `pluginProblem`
 * settles on, the connector it is about, and what fixes it. A switched-off
 * plugin has no problem: nothing reaches the agent from it until it is back
 * on, so there is nothing to fix yet.
 */
export interface PluginStatus {
  problem: PluginProblem | null;
  /** Whether the problem is the user's to act on, the rule every attention
   *  count reads. Narrower than `problem`: a connector nothing has checked
   *  offers Connect without anything having gone wrong with it. */
  needsUser: boolean;
  /** The connector the problem reports: the one whose reason the line names. */
  server: CatalogServer | null;
  fix: PluginFix | null;
  /** Vault names a problem connector asks for and the vault does not hold. */
  missingKeys: string[];
  /** Every vault name the plugin's connectors read, for the Keys block. */
  keys: string[];
}

export function pluginStatus(plugin: PluginInfo, servers: CatalogServer[]): PluginStatus {
  const own = pluginConnectors(plugin, servers).map((server) => ({ server, state: connectorState(server) }));
  const keys = unique(own.flatMap(({ server }) => serverKeyRefs(server)));
  const problem = plugin.enabled ? pluginProblem(plugin, servers) : null;
  if (!problem) return { problem, needsUser: false, server: null, fix: null, missingKeys: [], keys };

  const inProblem = own.filter(({ state }) => state.kind === problem.kind);
  const reported = (state: ConnectorState) =>
    problem.kind === 'connect' || (state.kind === 'failing' && state.noteKey === problem.noteKey);
  const server = inProblem.find(({ state }) => reported(state))?.server ?? null;
  const missingKeys = unique(inProblem.flatMap(({ server }) => server.probe?.missing_secrets ?? []));
  const needsUser = own.some(({ server, state }) => connectorNeedsUser(server, state));

  return { problem, needsUser, server, fix: fixFor(problem, inProblem, missingKeys), missingKeys, keys };
}

function fixFor(
  problem: PluginProblem,
  inProblem: { server: CatalogServer; state: ConnectorState }[],
  missingKeys: string[],
): PluginFix {
  if (missingKeys.length > 0) return { kind: 'addKey', key: missingKeys[0] };
  if (problem.kind === 'connect') return { kind: 'signIn' };
  if (problem.noteKey !== KEY_REJECTED) return { kind: 'open' };
  const by = inProblem.flatMap(({ server, state }) =>
    state.kind === 'failing' && state.noteKey === KEY_REJECTED ? [server] : [],
  );
  const refs = unique(by.flatMap(serverKeyRefs));
  // A refusal that names no stored key has no key to replace.
  if (refs.length === 0) return { kind: 'open' };
  return { kind: 'replaceKey', key: refs.length === 1 ? refs[0] : null, by };
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/** The short reason for a probe note, as a plugin cell words it. Literal keys
 *  so the locale check can see each one. */
const REASON_KEY: Record<string, string> = {
  'mcp.probe.rowCredentialRejected': 'plugins.pluginsPage.reason.rejected',
  'mcp.probe.rowMissingSecrets': 'plugins.pluginsPage.reason.missing',
  'mcp.probe.rowCredential': 'plugins.pluginsPage.reason.credential',
  'mcp.probe.rowUnreachable': 'plugins.pluginsPage.reason.unreachable',
  'mcp.probe.rowOauth': 'plugins.pluginsPage.reason.signIn',
};

export function reasonLabel(t: TFunction, noteKey: string): string {
  return t(REASON_KEY[noteKey] ?? noteKey);
}

/** The one line a plugin cell shows, and whether it is the problem. A newer
 *  version in the catalog takes the description's place, never a problem's. */
export function statusLine(
  t: TFunction,
  plugin: PluginInfo,
  status: PluginStatus,
  updateAvailable = false,
): { text: string; warn: boolean } {
  const { problem, server, missingKeys } = status;
  if (problem?.kind === 'failing') {
    const reason = reasonLabel(t, problem.noteKey);
    return {
      text:
        problem.count === 1 && server
          ? t('plugins.pluginsPage.problemOn', { reason, server: server.name })
          : t('plugins.pluginsPage.problemOnCount', { reason, count: problem.count }),
      warn: true,
    };
  }
  if (problem?.kind === 'connect') {
    // A connector that never got past the vault still offers Connect, but the
    // missing value is the thing to tell.
    if (missingKeys.length > 0) {
      return { text: t('plugins.pluginsPage.keyMissing', { key: missingKeys[0] }), warn: true };
    }
    return {
      text:
        problem.count === 1 && server
          ? t('plugins.pluginsPage.signInTo', { server: server.name })
          : t('plugins.pluginsPage.signInCount', { count: problem.count }),
      warn: false,
    };
  }
  if (updateAvailable) return { text: t('plugins.pluginsPage.updateAvailable'), warn: false };
  return { text: plugin.description, warn: false };
}

/**
 * What an uninstall removes and what outlives it, one sentence each, worded
 * alike before (the page's note) and after (the toast). Only what is there
 * is said: an empty count is left out, and the keys sentence names stored
 * keys the plugin's connectors read, which uninstall leaves in Secrets.
 * Edited parts survive too, but they no longer say which plugin they came
 * from, so neither side can name them and neither claims any.
 */
export function uninstallLines(
  t: TFunction,
  removed: { connectors: number; skills: number },
  keptKeys: readonly string[],
  when: 'before' | 'after',
): string[] {
  const lines: string[] = [];
  const parts = [
    removed.connectors > 0 ? t('plugins.pluginsPage.connectorCount', { count: removed.connectors }) : null,
    removed.skills > 0 ? t('plugins.card.skillCount', { count: removed.skills }) : null,
  ].filter((p): p is string => p !== null);
  if (parts.length > 0) {
    const what = parts.length === 2 ? t('plugins.card.partsAnd', { connectors: parts[0], skills: parts[1] }) : parts[0];
    lines.push(
      when === 'before'
        ? t('plugins.pluginsPage.uninstallNote', { what })
        : t('plugins.card.uninstalledRemoved', { what }),
    );
  }
  if (keptKeys.length === 1) lines.push(t('plugins.pluginsPage.keyStays', { key: keptKeys[0] }));
  else if (keptKeys.length > 1) lines.push(t('plugins.pluginsPage.keysStay', { n: keptKeys.length }));
  return lines;
}

/** "7 connectors", "20 skills", "4 connectors, 2 skills". */
export function partsLabel(t: TFunction, plugin: PluginInfo): string {
  const servers = plugin.components.filter((c) => c.kind === 'mcp').length;
  const skills = plugin.components.filter((c) => c.kind === 'skill').length;
  const connectorText = t('plugins.pluginsPage.connectorCount', { count: servers });
  const skillText = t('plugins.card.skillCount', { count: skills });
  if (servers > 0 && skills > 0) {
    return t('plugins.card.componentCount', { servers: connectorText, skills: skillText });
  }
  if (servers > 0) return connectorText;
  if (skills > 0) return skillText;
  return t('plugins.pluginsPage.empty');
}

export type PluginOrigin = 'builtIn' | 'catalog' | 'git' | 'uploaded';

/**
 * How the package got here. A catalog install and a pasted git URL are both
 * stored as a git source, so only the catalog naming the plugin as one of its
 * entries (`useCatalogPlugins`) tells them apart. Before the catalog answers,
 * a git source reads as the catalog's, as it did before it could be told.
 */
export function pluginOrigin(
  plugin: PluginInfo,
  catalog: ReadonlyMap<string, MarketplaceEntry> | null,
): PluginOrigin {
  if (isBundled(plugin)) return 'builtIn';
  if (plugin.source_type === 'zip' || !plugin.source_ref) return 'uploaded';
  return catalog === null || catalog.has(plugin.name) ? 'catalog' : 'git';
}

const ORIGIN_LABEL: Record<PluginOrigin, string> = {
  builtIn: 'plugins.pluginsPage.sourceBuiltIn',
  catalog: 'plugins.pluginsPage.sourceCatalog',
  git: 'plugins.pluginsPage.sourceGit',
  uploaded: 'plugins.pluginsPage.sourceUploaded',
};

/** How the package got here, in the words of its group. */
export function sourceLabel(
  t: TFunction,
  plugin: PluginInfo,
  catalog: ReadonlyMap<string, MarketplaceEntry> | null,
): string {
  return t(ORIGIN_LABEL[pluginOrigin(plugin, catalog)]);
}

/** The keys among `keys` the vault holds. A vault that has not been read
 *  holds none, so a sentence about kept keys is left out rather than guessed. */
export function storedKeys(keys: readonly string[], vaultNames: ReadonlySet<string> | null): string[] {
  return vaultNames ? keys.filter((key) => vaultNames.has(key)) : [];
}
