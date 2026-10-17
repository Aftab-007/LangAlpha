/** Whether a workspace row is the user's Home, where All workspaces runs.
 *  Read `is_home`, not the status: Home's status is its lifecycle, like
 *  any workspace's. */
export function isHomeWorkspace(
  row: { is_home?: unknown; status?: unknown } | null | undefined,
): boolean {
  if (!row) return false;
  // A backend before is_home sends none, and marks Home by a 'flash' status.
  if (row.is_home === undefined) return row.status === 'flash';
  return row.is_home === true;
}
