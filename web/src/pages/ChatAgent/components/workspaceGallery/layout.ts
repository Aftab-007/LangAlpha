/**
 * The gallery's horizontal frame, shared by every band of it (the header, the
 * banner and toolbar, the grid, and reorder mode's list) so they all start at
 * one left edge.
 *
 * Each band spans the whole width beside the sidebar and centres its column
 * inside, so the grid's scrollbar sits at the window's edge rather than beside
 * the last card. The scrollbar takes a lane from the scrolled band only, which
 * would centre it a few pixels left of the bands above; every band therefore
 * reserves that lane (`scrollbar-gutter`, which needs an overflow other than
 * visible), and where scrollbars overlay the page instead, none does. A phone
 * has no column to line up and overlays its scrollbars, so it reserves nothing.
 */
export const GALLERY_FRAME = 'px-4 md:px-8 md:[scrollbar-gutter:stable]';

/**
 * The column itself: wide enough to fill a laptop, capped so a line on an
 * ultrawide monitor stays one the eye can follow.
 */
export const GALLERY_COLUMN = 'mx-auto w-full max-w-[1440px]';

/** Reorder mode's list: one row per workspace, which reads best narrow. */
export const REORDER_COLUMN = 'mx-auto w-full max-w-3xl';
