import type { ReactNode } from 'react';
import { BrandMark } from '@/pages/ChatAgent/components/mcp/BrandMark';
import type { SkillInfo } from '@/pages/ChatAgent/utils/api';
import { isEffectivelyEnabled } from '../../utils/provenance';
import { CellState, CommandChip, SurfaceCell } from '../surface/Surface';

/**
 * The cells a plugin's page lists its skills with, and the bare cell for a
 * component whose row is not in the lists (yet). A plugin's connectors use
 * the Connectors grid's own cells without their menu.
 */

/** A component the plugin lists whose row is not in the lists (yet). */
export function PluginBareCell({ name, onOpen }: { name: string; onOpen: () => void }) {
  return <SurfaceCell mark={<BrandMark name={name} kind="server" size="md" />} name={name} onOpen={onOpen} />;
}

/** A skill as a cell: no mark, its command only when it is not its name. */
export function SkillCell({
  name,
  skill,
  meta,
  trailing,
  menu,
  onOpen,
}: {
  name: string;
  skill: SkillInfo | null;
  /** Extra words after the command ("2 of 5 workspaces"). */
  meta?: ReactNode;
  /** Overrides the on/off state ("Plugin off"). */
  trailing?: ReactNode;
  menu?: ReactNode;
  onOpen: () => void;
}) {
  const command = skill?.command && skill.command !== name ? skill.command : null;
  const on = skill ? isEffectivelyEnabled(skill) : true;
  return (
    <SurfaceCell
      mark={<BrandMark name={name} kind="skill" size="md" />}
      name={name}
      meta={
        command || meta ? (
          <>
            {command && <CommandChip command={command} />}
            {meta && <span className="pp-cell-meta">{meta}</span>}
          </>
        ) : null
      }
      line={skill?.description || null}
      off={!on}
      trailing={trailing ?? (skill ? <CellState state={on ? 'on' : 'off'} /> : null)}
      menu={menu}
      onOpen={onOpen}
    />
  );
}
