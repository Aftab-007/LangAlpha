import { Camera, CLOSE, REST, type Shot } from './camera';
import { Finished, ease, useSceneTime } from './clock';
import type { Waypoint } from './kit';
import type { IntroScene } from './types';
import type { IntroVisualId } from '../../registry';
import { EARLIER, PAGE, shot, wide } from './chatParts';
import { Dashboard, PTC_HEADER_H } from './chatDashboard';
import { CapexThread, PTC_CHAT } from './capexThread';
import { POPOVER_W, SharedFileBar, ShareDialog, SharePopover } from './shareParts';

/* The thread intro's last step: share the conversation, or the one file. It
   opens on the Analyst's capex thread from the chat intro, finished. */
/* eslint-disable react-refresh/only-export-components -- scene module:
   private scene components, one record export */

/** The share scene's script (ms): the conversation's popover, opened, its
    link switched on, file browsing allowed and the link copied; then the
    dashboard's own share dialog, opened from the file's header, its file
    list back, switched on, its link copied; then that link as a visitor
    opens it. */
const SHARE = {
  popover: 900,
  on: 1650,
  files: 2350,
  copied: 2950,
  dialog: 3850,
  listed: 4350,
  fileOn: 5350,
  fileCopied: 6000,
  visitor: 6750,
  length: 10600,
};

/** The header's share button, and where the popover hangs from it: its
    right edge on the button's, just under the header. */
const SHARE_BUTTON = { x: PTC_CHAT - 9 - 8, y: PTC_HEADER_H / 2 };
const SHARE_POPOVER = { right: PTC_CHAT - 9, top: PTC_HEADER_H + 1 };

/** The file header's share link button (`Link2`), second of its four. */
const FILE_LINK = { x: PAGE.width - 4.5 - 16 * 2.5 - 4.5 * 2, y: PTC_HEADER_H + 9.5 };

/** The pointer: up to the header's share button, then the popover's
    switch, the file browsing box and the copy button; across to the
    dashboard's share link, whose press also closes the popover; then the
    dialog's switch, its copy button, and the visitor's view. */
const SHARE_POINTER: Waypoint[] = [
  { at: 300, x: 96, y: 170 },
  { at: SHARE.popover - 50, ...SHARE_BUTTON },
  { at: SHARE.on - 50, x: SHARE_POPOVER.right - 8 - 9.5, y: SHARE_POPOVER.top + 8 + 5 },
  { at: SHARE.files - 50, x: SHARE_POPOVER.right - POPOVER_W + 8 + 3, y: 83 },
  { at: SHARE.copied - 50, x: SHARE_POPOVER.right - 8 - 7, y: SHARE_POPOVER.top + 32 },
  { at: SHARE.dialog - 50, ...FILE_LINK },
  { at: SHARE.fileOn - 50, x: 307, y: 154 },
  { at: SHARE.fileCopied - 50, x: 310, y: 124 },
  { at: SHARE.visitor - 50, x: 100, y: 231 },
  { at: SHARE.visitor + 900, x: 372, y: 300 },
];

/** The camera pushes in on the popover as it opens, steps back to take in
    the file's header and the dialog over the page, closes on the dialog,
    then rests on the visitor's page and pulls out to all of it. */
const SHARE_SHOTS: [Shot, ...Shot[]] = [
  shot(0, 160, 132, REST),
  shot(1300, 134, 110, CLOSE, 600),
  shot(3800, 200, 150, REST, 700),
  shot(4700, 200, 165, 1.4, 600),
  shot(7350, 160, 132, REST, 600),
  wide(9500, 900),
];

function ShareThread() {
  const now = useSceneTime();
  const sharing = now >= SHARE.popover && now < SHARE.dialog;
  const visitor = ease(now, SHARE.visitor + 150, 350);
  return (
    <Camera
      shots={SHARE_SHOTS}
      cursor={SHARE_POINTER}
      clicks={[
        SHARE.popover,
        SHARE.on,
        SHARE.files,
        SHARE.copied,
        SHARE.dialog,
        SHARE.fileOn,
        SHARE.fileCopied,
        SHARE.visitor,
      ]}
    >
      <div className="relative" style={PAGE}>
        {/* the thread as the Analyst left it */}
        <Finished>
          <CapexThread sharing={sharing} shared={now >= SHARE.on} />
        </Finished>
        {sharing && (
          <SharePopover
            at={SHARE.popover}
            on={SHARE.on}
            files={SHARE.files}
            copied={SHARE.copied}
            style={{ left: SHARE_POPOVER.right - POPOVER_W, top: SHARE_POPOVER.top }}
          />
        )}
        {now >= SHARE.dialog && visitor < 1 && (
          <ShareDialog
            at={SHARE.dialog}
            listed={SHARE.listed}
            on={SHARE.fileOn}
            copied={SHARE.fileCopied}
          />
        )}
        {/* the file's link as a visitor opens it: the page alone, under the
            shared file's bar */}
        {visitor > 0 && (
          <div
            className="absolute inset-0 flex flex-col"
            style={{ background: 'var(--color-bg-page)', opacity: visitor }}
          >
            <SharedFileBar name="capex-tracker.html" />
            <Dashboard at={EARLIER} />
          </div>
        )}
      </div>
    </Camera>
  );
}

export const shareScenes = {
  shareThread: { Scene: ShareThread, length: SHARE.length, anchor: 'right' },
} satisfies Partial<Record<IntroVisualId, IntroScene>>;
