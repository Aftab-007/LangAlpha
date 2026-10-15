/**
 * What an uninstall says it removes, before and after. Subagents are a third
 * kind a plugin carries, so a count that left them out would promise less
 * than the uninstall takes, and the user's changes to them go with them.
 */
import { describe, expect, it } from 'vitest';

import i18n from '@/i18n';
import type { PluginInfo } from '@/pages/ChatAgent/utils/api/plugins';
import type { SubagentView } from '@/pages/ChatAgent/utils/api/subagents';

import { changedSubagents, uninstallLines } from '../pluginsPage/pluginStatus';

const t = i18n.getFixedT('en-US');

const removed = (connectors: number, skills: number, subagents: number, changed = 0) => ({
  connectors,
  skills,
  subagents,
  changedSubagents: changed,
});

describe('uninstallLines', () => {
  it.each([
    [removed(2, 1, 3), 'Removes 2 connectors, 1 skill and 3 subagents from every workspace.'],
    [removed(0, 0, 2), 'Removes 2 subagents from every workspace.'],
    [removed(0, 3, 1), 'Removes 3 skills and 1 subagent from every workspace.'],
    [removed(1, 2, 0), 'Removes 1 connector and 2 skills from every workspace.'],
  ])('names every kind it removes: %o', (counts, line) => {
    expect(uninstallLines(t, counts, [], 'before')).toEqual([line]);
  });

  it('says the user changes to its subagents go too, only when there are some', () => {
    expect(uninstallLines(t, removed(0, 0, 2, 1), [], 'before')).toEqual([
      'Removes 2 subagents from every workspace.',
      'Your changes to its subagents are removed too.',
    ]);
    expect(uninstallLines(t, removed(0, 0, 2, 1), [], 'after')).toEqual([
      'Removed 2 subagents.',
      'Your changes to its subagents were removed too.',
    ]);
    expect(uninstallLines(t, removed(0, 0, 2, 0), [], 'after')).toEqual(['Removed 2 subagents.']);
    // A server that predates plugin subagents reports none removed.
    expect(uninstallLines(t, removed(1, 0, 0, 1), [], 'after')).toEqual(['Removed 1 connector.']);
  });
});

describe('changedSubagents', () => {
  const plugin = { name: 'acme' } as PluginInfo;
  const view = (name: string, edited: boolean, source: SubagentView['source'], from: string | null) =>
    ({
      name,
      edited,
      source,
      plugin: from ? { name: from, display_name: from } : null,
    }) as SubagentView;

  it("counts only this plugin's edited subagents", () => {
    expect(
      changedSubagents(plugin, [
        view('screener', true, 'plugin', 'acme'),
        view('writer', false, 'plugin', 'acme'),
        view('other', true, 'plugin', 'other-plugin'),
        view('research', true, 'builtin', null),
      ]),
    ).toBe(1);
  });

  it('claims none before the list is read', () => {
    expect(changedSubagents(plugin, undefined)).toBe(0);
  });
});
