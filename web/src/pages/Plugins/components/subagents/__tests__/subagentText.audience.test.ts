import { describe, expect, it } from 'vitest';
import type { SubagentAudience, SubagentView } from '@/pages/ChatAgent/utils/api';
import { offersAudience } from '../subagentText';

const view = (kind: 'custom' | 'base', available_to: SubagentAudience[]): SubagentView =>
  ({ name: 'r4-audience', kind, available_to }) as unknown as SubagentView;

describe('offersAudience', () => {
  it('offers the choice on a custom subagent while the Chief of Staff is on', () => {
    expect(offersAudience(view('custom', ['chief_of_staff']), true)).toBe(true);
    expect(offersAudience(view('custom', ['analyst']), true)).toBe(true);
  });

  it('with the Chief of Staff off, offers it only to hand the subagent back to the analyst', () => {
    // The analyst's roster leaves it out, so without the choice no agent could reach it.
    expect(offersAudience(view('custom', ['chief_of_staff']), false)).toBe(true);
    expect(offersAudience(view('custom', ['analyst', 'chief_of_staff']), false)).toBe(false);
  });

  it("never on a base, whose audience the user can't change", () => {
    expect(offersAudience(view('base', ['chief_of_staff']), false)).toBe(false);
    expect(offersAudience(view('base', ['analyst']), true)).toBe(false);
  });
});
