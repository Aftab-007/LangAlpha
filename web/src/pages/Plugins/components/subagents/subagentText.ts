import type { TFunction } from 'i18next';
import { modelLabel } from '@/lib/modelLabel';
import { effortLabelFor } from '@/lib/modelTuning';
import type { ModelMetadataEntry } from '@/hooks/useFilteredModels';
import type {
  SkillInfo,
  SubagentAudience,
  SubagentBaseValues,
  SubagentBrokerages,
  SubagentProblem,
  SubagentProblemCode,
  SubagentTool,
  SubagentView,
  SubagentsResponse,
} from '@/pages/ChatAgent/utils/api';
import { SUBAGENT_INHERIT } from '@/pages/ChatAgent/utils/api';

/**
 * The Subagents pane's vocabulary: what each problem, tool, field and source
 * is called. Keys are written out, never built, so the locale sweep sees each
 * one and a code the server adds later cannot ship as a raw key.
 */

/** A problem's words where a row has room for one short phrase. */
const PROBLEM_KEYS: Record<SubagentProblemCode, string> = {
  model_unavailable: 'plugins.subagents.problem.modelUnavailable',
  skill_missing: 'plugins.subagents.problem.skillMissing',
  connector_missing: 'plugins.subagents.problem.connectorMissing',
  search_not_on_plan: 'plugins.subagents.problem.searchNotOnPlan',
  search_unavailable: 'plugins.subagents.problem.searchUnavailable',
  depth_not_offered: 'plugins.subagents.problem.depthNotOffered',
  effort_not_offered: 'plugins.subagents.problem.effortNotOffered',
  description_matches: 'plugins.subagents.problem.descriptionMatches',
  base_removed: 'plugins.subagents.problem.baseRemoved',
  name_collision: 'plugins.subagents.problem.nameCollision',
};

export function problemText(
  t: TFunction,
  problem: SubagentProblem,
  providerName: (name: string) => string,
): string {
  const key = PROBLEM_KEYS[problem.code];
  if (!key) return t('plugins.subagents.problem.unknown');
  const detail = problem.detail ?? '';
  return t(key, {
    name: detail,
    provider: detail ? providerName(detail) : t('plugins.subagents.problem.thisProvider'),
  });
}

/** Weakest reach first, the order the switches are listed in. */
export const TOOL_ORDER: readonly SubagentTool[] = ['web', 'market_data', 'code', 'shell'];

export const TOOL_COPY: Record<SubagentTool, { label: string; desc: string; short: string }> = {
  web: {
    label: 'plugins.subagents.tool.web',
    desc: 'plugins.subagents.tool.webDesc',
    short: 'plugins.subagents.tool.webShort',
  },
  market_data: {
    label: 'plugins.subagents.tool.marketData',
    desc: 'plugins.subagents.tool.marketDataDesc',
    short: 'plugins.subagents.tool.marketDataShort',
  },
  code: {
    label: 'plugins.subagents.tool.code',
    desc: 'plugins.subagents.tool.codeDesc',
    short: 'plugins.subagents.tool.codeShort',
  },
  shell: {
    label: 'plugins.subagents.tool.shell',
    desc: 'plugins.subagents.tool.shellDesc',
    short: 'plugins.subagents.tool.shellShort',
  },
};

/** The Preset menu: the four tool sets the folder README names too. */
export const PRESETS: ReadonlyArray<{ id: string; label: string; tools: readonly SubagentTool[] }> = [
  { id: 'research', label: 'plugins.subagents.preset.research', tools: ['web'] },
  { id: 'analyst', label: 'plugins.subagents.preset.analyst', tools: ['web', 'market_data', 'code', 'shell'] },
  { id: 'data', label: 'plugins.subagents.preset.data', tools: ['market_data', 'code', 'shell'] },
  { id: 'writer', label: 'plugins.subagents.preset.writer', tools: ['code', 'shell'] },
];

export function sameTools(a: readonly SubagentTool[], b: readonly SubagentTool[]): boolean {
  return a.length === b.length && a.every((tool) => b.includes(tool));
}

/** In the switches' order, whatever order the file wrote them in. */
export function orderedTools(tools: readonly SubagentTool[]): SubagentTool[] {
  return TOOL_ORDER.filter((tool) => tools.includes(tool));
}

export function capitalize(text: string, locale: string): string {
  return text ? text.charAt(0).toLocaleUpperCase(locale) + text.slice(1) : text;
}

/** "Market data, code, shell": a run of the short names, as a meta line or a
 *  fact reads them. */
export function toolsSummary(t: TFunction, tools: readonly SubagentTool[], locale: string): string {
  const words = orderedTools(tools).map((tool) => t(TOOL_COPY[tool].short));
  if (words.length === 0) return t('plugins.subagents.tool.none');
  return capitalize(words.join(t('plugins.shell.summary.sep')), locale);
}

/** What a user's row can set, in the words a sentence about it uses. */
const FIELD_KEYS: Record<string, string> = {
  enabled: 'plugins.subagents.field.enabled',
  model: 'plugins.subagents.field.model',
  effort: 'plugins.subagents.field.effort',
  tools: 'plugins.subagents.field.tools',
  search_provider: 'plugins.subagents.field.searchProvider',
  search_depth: 'plugins.subagents.field.searchDepth',
  connectors: 'plugins.subagents.field.connectors',
  brokerages: 'plugins.subagents.field.brokerages',
  preferred_connectors: 'plugins.subagents.field.preferredConnectors',
  preferred_skills: 'plugins.subagents.field.preferredSkills',
};

/** "model and effort", or null when the row sets nothing this pane names. */
export function fieldsPhrase(
  t: TFunction,
  fields: readonly string[],
  locale: string,
  join: (items: string[], locale: string) => string,
): string | null {
  const words = fields.filter((f) => FIELD_KEYS[f]).map((f) => t(FIELD_KEYS[f]));
  return words.length > 0 ? join(words, locale) : null;
}

const BROKERAGE_KEYS: Record<SubagentBrokerages, string> = {
  off: 'plugins.subagents.brokerageState.off',
  on: 'plugins.subagents.brokerageState.on',
};

export function brokerageText(t: TFunction, value: SubagentBrokerages): string {
  return t(BROKERAGE_KEYS[value] ?? BROKERAGE_KEYS.off);
}

export const AUDIENCES: readonly SubagentAudience[] = ['analyst', 'chief_of_staff'];

const AUDIENCE_KEYS: Record<SubagentAudience, { choice: string; fact: string }> = {
  analyst: {
    choice: 'plugins.subagents.audience.analyst',
    fact: 'plugins.subagents.audience.analystFact',
  },
  chief_of_staff: {
    choice: 'plugins.subagents.audience.chiefOfStaff',
    fact: 'plugins.subagents.audience.chiefOfStaffFact',
  },
};

export function audienceChoice(t: TFunction, audience: SubagentAudience): string {
  return t(AUDIENCE_KEYS[audience].choice);
}

export function audienceFacts(t: TFunction, audiences: readonly SubagentAudience[]): string {
  return AUDIENCES.filter((a) => audiences.includes(a))
    .map((a) => t(AUDIENCE_KEYS[a].fact))
    .join(t('plugins.shell.summary.sep'));
}

/** Where a subagent comes from, as its Info and header say it. */
export function sourceText(t: TFunction, view: SubagentView): string {
  if (view.source === 'custom') return t('plugins.subagents.source.custom');
  if (view.source === 'plugin' && view.plugin) {
    return t('plugins.subagents.source.plugin', { plugin: view.plugin.display_name });
  }
  return t('plugins.subagents.source.builtin');
}

/** "Built in: X" or "From Filings Toolkit: X", the side of a base's aside
 *  heading. */
export function baseSide(t: TFunction, view: SubagentView, value: string): string {
  return view.source === 'plugin' && view.plugin
    ? t('plugins.subagents.sideFrom', { plugin: view.plugin.display_name, value })
    : t('plugins.subagents.sideBuiltIn', { value });
}

/** A custom subagent with the user's text, or a base whose file the user
 *  can only tune. */
export function isCustom(view: SubagentView): boolean {
  return view.kind === 'custom';
}

/** Whether no agent hands work to a subagent with these audiences: the
 *  Chief of Staff is off and the analyst is not among them. */
export function reachesNoAgent(audiences: readonly SubagentAudience[], allWorkspaces: boolean): boolean {
  return !allWorkspaces && !audiences.includes('analyst');
}

/** Whether its page offers the choice of agent. With the Chief of Staff off
 *  only while no agent reaches it, so it can be handed back to the analyst. */
export function offersAudience(view: SubagentView, allWorkspaces: boolean): boolean {
  return isCustom(view) && (allWorkspaces || reachesNoAgent(view.available_to, allWorkspaces));
}

export function countCustom(data: SubagentsResponse): number {
  return data.subagents.filter(isCustom).length;
}

/** An override whose base is gone: only removing it works. Not every
 *  `base_removed`: a row written against a base the name no longer resolves
 *  to also carries it, while its view is the current base, on and editable. */
export function isOrphan(view: SubagentView): boolean {
  return view.kind === 'base' && view.base === null;
}

export function hasProblem(view: SubagentView, code: SubagentProblemCode, detail?: string): boolean {
  return view.problems.some((p) => p.code === code && (detail === undefined || p.detail === detail));
}

/** Whether a base has a row of the user's to reset: their changes, or a row
 *  written against a base the name no longer resolves to, which no turn reads. */
export function isResettable(view: SubagentView): boolean {
  return view.kind === 'base' && !isOrphan(view) && (view.edited || hasProblem(view, 'base_removed'));
}

/** A skill a Preferred chip can name, and whether it is switched off. */
export interface PreferredSkillOption {
  name: string;
  command: string | null;
  off: boolean;
}

/**
 * The account's skills, one per name: a subagent works in any workspace, so
 * a skill one workspace holds is not one it can count on. One switched off,
 * itself or with its plugin, stays listed so a chip naming it can say so.
 */
export function preferredSkillOptions(
  skills: readonly Pick<SkillInfo, 'name' | 'command' | 'enabled' | 'plugin_enabled' | 'workspace_id'>[],
): PreferredSkillOption[] {
  const seen = new Map<string, PreferredSkillOption>();
  for (const s of skills) {
    if (s.workspace_id) continue;
    const off = !s.enabled || s.plugin_enabled === false;
    // A name listed twice reads as the row that is on.
    const prev = seen.get(s.name);
    if (prev && (off || !prev.off)) continue;
    seen.set(s.name, { name: s.name, command: s.command, off });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What Add skill offers: a skill a turn loads and nobody chose yet. One
 * switched off, itself or with its plugin, is nothing to reach for, as the
 * turn drops it; one the server leaves out of `valid`, behind a feature the
 * user hasn't turned on, the turn never loads.
 */
export function addableSkills(
  options: readonly PreferredSkillOption[],
  valid: readonly string[],
  chosen: readonly string[],
): PreferredSkillOption[] {
  return options.filter((s) => !s.off && valid.includes(s.name) && !chosen.includes(s.name));
}

/** Whether Depth shows: for a provider with levels to choose from, or to
 *  clear a saved level the provider lacks, which nothing else on a custom
 *  subagent can. */
export function showsDepth(depths: readonly { name: string }[], saved: string | null): boolean {
  return depths.length > 1 || (!!saved && !depths.some((d) => d.name === saved));
}

/** "Opus 5.5 · High", "Thread's model": the model half of a row's meta. */
export function modelMeta(
  t: TFunction,
  values: Pick<SubagentBaseValues, 'model' | 'effort'>,
  metadata: Record<string, ModelMetadataEntry>,
): string[] {
  const parts = [values.model ? modelLabel(values.model, metadata) : t('plugins.subagents.threadsModel')];
  const effort = effortLabelFor(t, values.effort);
  if (effort) parts.push(effort);
  return parts;
}

/** The base's own value for a field, or undefined on a custom subagent. */
export function baseValue<K extends keyof SubagentBaseValues>(
  view: SubagentView,
  key: K,
): SubagentBaseValues[K] | undefined {
  return view.base ? view.base[key] : undefined;
}

/** Fields where null means "follow the thread" (or the user's own setting). */
const INHERITABLE: ReadonlySet<keyof SubagentBaseValues> = new Set([
  'model',
  'effort',
  'search_provider',
  'search_depth',
]);

/** Lists the agent reads in order: preferred connectors lead its roster and
 *  preferred skills preload in it. The others are sets. */
const ORDERED: ReadonlySet<string> = new Set(['preferred_connectors', 'preferred_skills']);

/**
 * What one control sends. On a base, a value equal to what the base ships
 * with goes as null, which drops the user's key rather than pinning a copy
 * of today's base value that would hold once the base moves on. Choosing to
 * follow the thread on a base that pins a value goes as `inherit`, since a
 * null there would clear the key and land back on the pin.
 */
export function fieldWrite<K extends keyof SubagentBaseValues>(
  view: SubagentView,
  key: K,
  value: SubagentBaseValues[K],
): SubagentBaseValues[K] | null {
  if (!view.base) return value;
  const shipped = view.base[key];
  const same = Array.isArray(value) && Array.isArray(shipped)
    ? value.length === shipped.length &&
      value.every((v, i) => (ORDERED.has(key) ? (shipped as unknown[])[i] === v : (shipped as unknown[]).includes(v)))
    : value === shipped;
  if (same) return null;
  if (value === null && INHERITABLE.has(key)) return SUBAGENT_INHERIT as SubagentBaseValues[K];
  return value;
}

const SECTION_OPEN = /^\s*<([a-z][a-z0-9_-]*)>\s*$/i;
const SECTION_CLOSE = /^\s*<\/([a-z][a-z0-9_-]*)>\s*$/i;

/**
 * A built-in's instructions as Preview shows them. They are prompt text, cut
 * into sections by tags on lines of their own (`<task>` ... `</task>`), and
 * Markdown reads an opening tag as raw HTML, which swallows the section's own
 * formatting up to the next blank line. Each opening tag becomes a heading
 * named after it and each closing tag a break; Source still shows the text
 * as the subagent reads it.
 */
export function promptSectionsAsMarkdown(text: string): string {
  let fenced = false;
  return text
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (fenced) return line;
      const open = SECTION_OPEN.exec(line);
      if (open) {
        const name = open[1].replace(/[_-]+/g, ' ');
        return `\n## ${name.charAt(0).toUpperCase()}${name.slice(1)}\n`;
      }
      return SECTION_CLOSE.test(line) ? '' : line;
    })
    .join('\n');
}

/** Same rule for the custom subagent's name as the server's. */
export const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;
export const RESERVED_NAMES: ReadonlySet<string> = new Set(['main']);

/** Characters as the server counts them: code points, not UTF-16 units. */
export function charLength(text: string): number {
  return Array.from(text).length;
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
