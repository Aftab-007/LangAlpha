import { cn } from '@/lib/utils';
import { identityTint } from './identityTint';

/**
 * The per-item identity mark on Plugins / MCP rows: a rounded tile whose tint
 * derives from the item's name, with the name's initial as a monogram. The
 * same name always lands on the same tint, on every surface — that stability
 * is the whole point, so never salt the hash with the item's kind or origin.
 * Purely decorative: the accessible name of a row stays its text.
 */

function monogram(name: string): string {
  // First grapheme (handles CJK + astral chars), uppercased for latin.
  const first = [...name.trim()][0] ?? '?';
  return first.toUpperCase();
}

/** Geometry only, shared with `BrandMark` so a real logo and the monogram it
 *  falls back to occupy the same box on the same row. */
export const TILE_SIZES = {
  xs: 'h-[18px] w-[18px] rounded-[5px]',
  sm: 'h-7 w-7 rounded-md',
  md: 'h-[34px] w-[34px] rounded-lg',
  lg: 'h-10 w-10 rounded-lg',
  xl: 'h-14 w-14 rounded-[13px]',
} as const;

const TEXT_SIZES = {
  xs: 'text-[0.625rem]',
  sm: 'text-[0.75rem]',
  md: 'text-[0.8125rem]',
  lg: 'text-base',
  xl: 'text-xl',
} as const;

export type TileSize = keyof typeof TILE_SIZES;

export function IdentityTile({
  name,
  size = 'sm',
  className = '',
}: {
  name: string;
  size?: TileSize;
  /** Extra geometry from the caller (e.g. a round mask on the model picker). */
  className?: string;
}) {
  const [bg, fg] = identityTint(name);
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-semibold select-none',
        TILE_SIZES[size],
        TEXT_SIZES[size],
        className,
      )}
      style={{ color: fg, backgroundColor: bg }}
    >
      {monogram(name)}
    </span>
  );
}
