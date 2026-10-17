/**
 * Where an automation runs. Every automation names a workspace, and Home's id
 * means All workspaces, where the Chief of Staff runs. A row written by an
 * older build may say `agent_mode: 'flash'` instead, and runs in Home
 * whatever its `workspace_id` says.
 *
 * Fields are read loosely, since the chat's automation cards hand over the
 * tool's own JSON rather than a typed row.
 */
export interface PlaceRow {
  agent_mode?: unknown;
  workspace_id?: unknown;
}

/** Whether the row runs in Home, and so reads as All workspaces. */
export function runsInHome(row: PlaceRow, homeId: string | undefined): boolean {
  return row.agent_mode === 'flash' || (!!homeId && row.workspace_id === homeId);
}

/** The workspace the row runs in: Home's id for a legacy flash row, which is
 *  null until Home's id is known. */
export function workspaceOf(row: PlaceRow, homeId: string | undefined): string | null {
  if (row.agent_mode === 'flash') return homeId ?? null;
  return typeof row.workspace_id === 'string' && row.workspace_id ? row.workspace_id : null;
}
