// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { runsInHome, workspaceOf } from '../place';

describe("an automation's place before Home's id is known", () => {
  it('still reads a legacy flash row as Home, with no id to edit yet', () => {
    expect(runsInHome({ agent_mode: 'flash', workspace_id: 'ws-old' }, undefined)).toBe(true);
    expect(workspaceOf({ agent_mode: 'flash', workspace_id: 'ws-old' }, undefined)).toBeNull();
  });

  it('reads any other row by the workspace it names', () => {
    expect(runsInHome({ agent_mode: 'ptc', workspace_id: 'home-1' }, undefined)).toBe(false);
    expect(workspaceOf({ agent_mode: 'ptc', workspace_id: 'home-1' }, undefined)).toBe('home-1');
    expect(workspaceOf({ workspace_id: '' }, undefined)).toBeNull();
    expect(workspaceOf({ workspace_id: null }, 'home-1')).toBeNull();
  });
});
