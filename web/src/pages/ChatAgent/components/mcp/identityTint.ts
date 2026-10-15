/**
 * The eight identity tints a name hashes to, shared by the monogram tile and
 * the subagent tile so one name keeps one tint on every surface.
 */

// Literal pairs (not computed names) so the tokenRefs guard can see them.
const TINTS: ReadonlyArray<readonly [bg: string, fg: string]> = [
  ['var(--color-identity-0-bg)', 'var(--color-identity-0-fg)'],
  ['var(--color-identity-1-bg)', 'var(--color-identity-1-fg)'],
  ['var(--color-identity-2-bg)', 'var(--color-identity-2-fg)'],
  ['var(--color-identity-3-bg)', 'var(--color-identity-3-fg)'],
  ['var(--color-identity-4-bg)', 'var(--color-identity-4-fg)'],
  ['var(--color-identity-5-bg)', 'var(--color-identity-5-fg)'],
  ['var(--color-identity-6-bg)', 'var(--color-identity-6-fg)'],
  ['var(--color-identity-7-bg)', 'var(--color-identity-7-fg)'],
];

/** djb2 over the name → a stable tint index. Exported for tests. */
export function identityIndex(name: string): number {
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) + hash + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % TINTS.length;
}

/** The name's [background, foreground] pair, for a tile that draws something
 *  other than the monogram on the same tint. */
export function identityTint(name: string): readonly [bg: string, fg: string] {
  return TINTS[identityIndex(name)];
}
