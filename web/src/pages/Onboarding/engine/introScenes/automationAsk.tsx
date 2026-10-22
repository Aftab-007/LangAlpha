import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Clock, Globe, PanelRight } from 'lucide-react';
import { useAgentNames } from '../introAgents';
import { CLOSE, Camera, REST, type Shot, VIEW, look } from './camera';
import { ActivityRow, Pill, Reply } from './chatParts';
import { useSceneTime } from './clock';
import { InputDock, Tag, Typed, UserBubble } from './kit';
import type { IntroScene } from './types';

/* The automations intro's chat step: setting an automation up by asking the
   Chief of Staff for it. The agent keeps each automation as a JSON file in
   `.agents/user/automations/` and edits it with its ordinary file tools, so
   the transcript draws those calls as the app draws a Read or a Write on
   one: the Automations clock glyph, the running verb, then the past-tense
   title with the file's name as its pill. Before it creates one it sums the
   automation up and waits for a yes. */
/* eslint-disable react-refresh/only-export-components -- scene module: a
   private scene component and its record entry */

/** The thread page at the size a resting shot frames whole: the camera's
    zoom never leaves the page's own edges. */
const PAGE = { width: VIEW.width / REST, height: VIEW.height / REST };

/** The chat column's width (px), centred on the page as the app sets it. */
const COL = 240;

/** The header's height and the column's inset under it: where the
    transcript's top edge falls. The push-in's own top edge sits just under
    it, so the camera cuts no line the transcript has not, and the composer
    keeps a margin at the foot of the view. */
const HEADER = 24;
const INSET = 12;
const TRANSCRIPT_TOP = HEADER + INSET;

/** When the thread's earlier exchanges happened: long before the scene, so
    they are on the page, settled, from the first frame. */
const EARLIER = -60_000;

/** The ask typed into the composer and sent, the agent's summary of what it
    would set up, the yes, the Write of the new file, and the line saying it
    is done. */
const ASK = {
  ask: 'Every weekday at 8, brief me on my holdings.',
  cps: 30,
  type: 500,
  send: 2200,
  summary:
    "**Here's what I'd set up:** Morning holdings brief, weekdays at 8:00 AM ET. Each run covers overnight moves, news and today's events for your holdings, in a new thread each time. Create it?",
  summaryAt: 2550,
  summaryCps: 140,
  yes: 'Yes.',
  typeYes: 5300,
  sendYes: 5700,
  write: 5950,
  written: 6400,
  file: 'morning-holdings-brief',
  created:
    "**Created.** The first brief runs tomorrow at 8:00 AM, and it's on your Automations page.",
  createdAt: 6500,
  createdCps: 150,
  length: 10000,
};

/** The whole page at rest, the composer and the newest lines above it as
    the ask is typed and answered; a short push in on the Write as it runs
    and the line saying the brief is set up, from the transcript's top edge
    down to the composer; and back out to the page. */
const ASK_SHOTS: [Shot, ...Shot[]] = [
  { at: 0, ...look(PAGE.width / 2, PAGE.height / 2, REST, PAGE) },
  {
    at: 6250,
    dur: 700,
    ...look(PAGE.width / 2, TRANSCRIPT_TOP + 2 + VIEW.height / 2 / CLOSE, CLOSE, PAGE),
  },
  { at: 9300, dur: 700, ...look(PAGE.width / 2, PAGE.height / 2, REST, PAGE) },
];

/** The thread page's header: back, then the thread's place. */
function TopTitle({ children }: { children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <ArrowLeft className="h-2.5 w-2.5 shrink-0" style={{ color: 'var(--iv-text-3)' }} />
      <span
        className="truncate text-[0.5rem] font-medium leading-none"
        style={{ color: 'var(--iv-text)' }}
      >
        {children}
      </span>
    </span>
  );
}

/** A message long enough to wrap, its lines spaced as the app's bubble
    spaces them. */
function Lines({ children }: { children: string }) {
  return <span className="block leading-[1.3]">{children}</span>;
}

/** A turn's tool calls, threaded on the timeline's rule: a short segment
    between one row's icon and the next, as the app draws it. */
function Timeline({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex flex-col gap-[10px]">
      <span
        aria-hidden
        className="absolute bottom-[10.5px] left-[3.5px] top-[10.5px] w-px"
        style={{ background: 'var(--color-border-default)' }}
      />
      {children}
    </div>
  );
}

/** One call on an automation's file: the clock glyph, `reading` or
    `updating automations...` while it runs, then `Read` or `Updated
    automations` with the file's name. */
function AutomationRow({
  write,
  file,
  at,
  done,
}: {
  write: boolean;
  file: string;
  at: number;
  done: number;
}) {
  const { t } = useTranslation();
  return (
    <ActivityRow
      icon={Clock}
      verb={t(`toolArtifact.inProgress.${write ? 'updating' : 'reading'}_automations`)}
      title={t(`toolArtifact.completed.${write ? 'updated' : 'read'}_automations`)}
      after={<Pill>{file}</Pill>}
      at={at}
      done={done}
    />
  );
}

function AutomationAsk() {
  const { t } = useTranslation();
  const names = useAgentNames();
  const now = useSceneTime();
  const composer =
    now >= ASK.type && now < ASK.send ? (
      <Typed text={ASK.ask} at={ASK.type} cps={ASK.cps} />
    ) : now >= ASK.typeYes && now < ASK.sendYes ? (
      <Typed text={ASK.yes} at={ASK.typeYes} cps={ASK.cps} />
    ) : undefined;
  return (
    <Camera shots={ASK_SHOTS}>
      <div className="flex flex-col" style={PAGE}>
        {/* the thread's header: back, its place, the agent it runs with, and
            the file panel's toggle */}
        <div
          className="flex shrink-0 items-center gap-2 border-b px-2.5"
          style={{ height: HEADER, borderColor: 'var(--iv-border)' }}
        >
          <TopTitle>{t('agents.allWorkspaces')}</TopTitle>
          <Tag>{names.home}</Tag>
          <PanelRight
            className="ml-auto h-2.5 w-2.5 shrink-0"
            style={{ color: 'var(--iv-text-3)' }}
          />
        </div>
        <div
          className="mx-auto flex min-h-0 flex-1 flex-col gap-1.5 pb-2.5"
          style={{ width: COL, paddingTop: INSET }}
        >
          {/* the transcript settles on the composer: the newest lines just
              above it, the oldest running off the top as the turn grows */}
          <div className="flex min-h-0 flex-1 flex-col justify-end gap-1.5 overflow-hidden">
            <UserBubble at={EARLIER} className="ml-12">
              When does AVGO report?
            </UserBubble>
            <ActivityRow
              icon={Globe}
              verb={t('toolArtifact.inProgress.searchingQuery', { query: 'AVGO earnings date' })}
              title={t('toolArtifact.tool.webSearch')}
              after={<Pill>AVGO earnings date</Pill>}
              at={EARLIER}
              done={EARLIER}
            />
            <Reply text="**Thursday, Dec 10**, after the close." at={EARLIER} />
            <UserBubble at={EARLIER} className="ml-12">
              <Lines>I&apos;m off next week. Back on Monday, November 2.</Lines>
            </UserBubble>
            <Reply
              text="**Noted.** Your automations keep running while you're away, and each run's results wait in the feed. Want any of them paused?"
              at={EARLIER}
            />
            <UserBubble at={EARLIER} className="ml-12">
              <Lines>Pause the AVGO earnings preview until I&apos;m back.</Lines>
            </UserBubble>
            {/* the file is read, then written back with its status paused */}
            <Timeline>
              <AutomationRow
                write={false}
                file="avgo-earnings-preview"
                at={EARLIER}
                done={EARLIER}
              />
              <AutomationRow write file="avgo-earnings-preview" at={EARLIER} done={EARLIER} />
            </Timeline>
            <Reply
              text="**Paused.** It won't run again until you turn it back on, here or on the Automations page."
              at={EARLIER}
            />
            {/* the ask, the summary it waits on, the yes, and the new file */}
            <UserBubble at={ASK.send + 60} className="ml-12">
              <Lines>{ASK.ask}</Lines>
            </UserBubble>
            <Reply text={ASK.summary} at={ASK.summaryAt} cps={ASK.summaryCps} />
            <UserBubble at={ASK.sendYes + 60}>{ASK.yes}</UserBubble>
            <AutomationRow write file={ASK.file} at={ASK.write} done={ASK.written} />
            <Reply text={ASK.created} at={ASK.createdAt} cps={ASK.createdCps} />
          </div>
          <InputDock text={composer} sendAt={[ASK.send, ASK.sendYes]} />
        </div>
      </div>
    </Camera>
  );
}

/** The scene's entry in the automations record. Centred: the chat column
    sits in the middle of the page. */
export const askScene: IntroScene = {
  Scene: AutomationAsk,
  length: ASK.length,
  anchor: 'center',
};
