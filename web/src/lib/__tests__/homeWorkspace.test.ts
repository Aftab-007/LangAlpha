import { describe, expect, it } from 'vitest';
import { isHomeWorkspace } from '../homeWorkspace';

describe('isHomeWorkspace', () => {
  it('reads is_home whatever the status, since that is Home lifecycle', () => {
    expect(isHomeWorkspace({ is_home: true, status: 'running' })).toBe(true);
    expect(isHomeWorkspace({ is_home: true, status: 'unbound' })).toBe(true);
    expect(isHomeWorkspace({ is_home: false, status: 'running' })).toBe(false);
    // A server that sends is_home is believed over a leftover 'flash'.
    expect(isHomeWorkspace({ is_home: false, status: 'flash' })).toBe(false);
  });

  it("reads a 'flash' status as Home when the row has no is_home, as from a backend before it", () => {
    expect(isHomeWorkspace({ status: 'flash' })).toBe(true);
    expect(isHomeWorkspace({ status: 'running' })).toBe(false);
    expect(isHomeWorkspace({})).toBe(false);
  });

  it('reads no row as not Home', () => {
    expect(isHomeWorkspace(null)).toBe(false);
    expect(isHomeWorkspace(undefined)).toBe(false);
  });
});
