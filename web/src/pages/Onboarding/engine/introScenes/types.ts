import type { ComponentType } from 'react';

/** A scene for the intro modal's visual panel, and how to stage it. */
export interface IntroScene {
  Scene: ComponentType;
  /** Script length in ms; the clock holds the last frame, then plays it again. */
  length: number;
  /**
   * The mockup is rendered oversized and bleeds off one edge of the visual
   * panel (landing-page style). The anchored side stays fully visible, so
   * each scene anchors the side its hot region lives on; the other side crops.
   */
  anchor: 'left' | 'right' | 'center';
}
