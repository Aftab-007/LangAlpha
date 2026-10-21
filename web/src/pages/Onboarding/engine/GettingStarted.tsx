import { useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { ArrowUpRight, Check, ChevronRight, X } from 'lucide-react';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useOnboarding, type GettingStartedTaskState } from '../OnboardingProvider';
import type { GettingStartedTaskDef } from '../registry';

/** Progress as a ring, drawn in the sidebar where an icon would be. */
function ProgressRing({
  done,
  total,
  className,
}: {
  done: number;
  total: number;
  className?: string;
}) {
  const r = 7;
  const length = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 18 18" className={className} aria-hidden>
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        opacity={0.25}
      />
      {done > 0 && (
        <circle
          cx="9"
          cy="9"
          r={r}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - done / total)}
          transform="rotate(-90 9 9)"
          style={{
            stroke: 'var(--color-accent-primary)',
            transition: 'stroke-dashoffset 300ms ease-out',
          }}
        />
      )}
    </svg>
  );
}

function TaskMark({ done, next }: { done: boolean; next: boolean }) {
  if (done) {
    return (
      <span
        className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: 'var(--color-accent-primary)' }}
        aria-hidden
      >
        <Check
          className="h-3 w-3"
          strokeWidth={3}
          style={{ color: 'var(--color-text-on-accent)' }}
        />
      </span>
    );
  }
  return (
    <span
      className="mt-px h-[18px] w-[18px] shrink-0 rounded-full border-[1.5px]"
      style={{
        borderColor: next ? 'var(--color-accent-primary)' : 'var(--color-border-strong)',
      }}
      aria-hidden
    />
  );
}

/**
 * The list the sidebar's "Get started" entry opens: what is done, what comes
 * next with a line on it, and the rest by name. Presentational, so the dev
 * preview draws it without the provider.
 */
export function GettingStartedPanel({
  tasks,
  doneCount,
  onSelect,
  onDismiss,
  focusRef,
}: {
  tasks: GettingStartedTaskState[];
  doneCount: number;
  onSelect: (def: GettingStartedTaskDef) => void;
  onDismiss: () => void;
  /** Receives the next task's button, for the opening focus. */
  focusRef?: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useTranslation();
  const next = tasks.findIndex((task) => !task.done);

  return (
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {t('onboarding.gettingStarted.title')}
          </h2>
          <p
            className="mt-0.5 text-xs tabular-nums"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            {t('onboarding.gettingStarted.progress', {
              done: doneCount,
              total: tasks.length,
            })}
          </p>
        </div>
        <PopoverClose
          aria-label={t('common.close')}
          className="-mr-1.5 -mt-1 rounded-md p-1.5 transition-colors hover:bg-(--color-bg-subtle) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          <X className="h-3.5 w-3.5" />
        </PopoverClose>
      </div>

      <div
        className="mx-4 mt-3 h-1 overflow-hidden rounded-full"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={tasks.length}
        aria-valuenow={doneCount}
        style={{ backgroundColor: 'var(--color-bg-elevated)' }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{
            width: `${(doneCount / tasks.length) * 100}%`,
            backgroundColor: 'var(--color-accent-primary)',
          }}
        />
      </div>

      <ul className="flex flex-col gap-0.5 p-2">
        {tasks.map(({ def, done }, i) => {
          const isNext = i === next;
          return (
            <li key={def.id}>
              <button
                ref={isNext ? focusRef : undefined}
                type="button"
                disabled={done}
                onClick={() => onSelect(def)}
                className="group flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors enabled:hover:bg-(--color-bg-subtle) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                <TaskMark done={done} next={isNext} />
                <span className="min-w-0 flex-1">
                  <span
                    className="block text-sm"
                    style={{
                      color: done ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
                      fontWeight: isNext ? 600 : 500,
                    }}
                  >
                    {t(def.titleKey)}
                  </span>
                  {isNext && (
                    <span
                      className="mt-0.5 block text-xs leading-relaxed"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      {t(def.descKey)}
                    </span>
                  )}
                </span>
                {!done &&
                  (def.external ? (
                    <ArrowUpRight
                      className="mt-0.5 h-4 w-4 shrink-0"
                      style={{ color: 'var(--color-text-tertiary)' }}
                      aria-hidden
                    />
                  ) : (
                    <ChevronRight
                      className={cn(
                        'mt-0.5 h-4 w-4 shrink-0 transition-opacity',
                        !isNext &&
                          'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
                      )}
                      style={{ color: 'var(--color-text-tertiary)' }}
                      aria-hidden
                    />
                  ))}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="border-t px-4 py-2.5" style={{ borderColor: 'var(--color-border-muted)' }}>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded text-xs transition-colors hover:text-(--color-text-secondary) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          {t('onboarding.gettingStarted.dismiss')}
        </button>
      </div>
    </div>
  );
}

/**
 * The sidebar's "Get started" entry: a row above the account in the panel, a
 * ring above the avatar in the rail. It opens the checklist beside the
 * sidebar, so the list never sits over a page. Presentational, like the panel.
 */
export function GettingStartedEntry({
  variant,
  tasks,
  doneCount,
  onSelect,
  onDismiss,
  defaultOpen = false,
}: {
  variant: 'row' | 'rail';
  tasks: GettingStartedTaskState[];
  doneCount: number;
  onSelect: (def: GettingStartedTaskDef) => void;
  onDismiss: () => void;
  defaultOpen?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  // The list opens on the task that comes next, so Enter starts it.
  const nextRef = useRef<HTMLButtonElement>(null);
  const title = t('onboarding.gettingStarted.title');
  const progress = t('onboarding.gettingStarted.progress', {
    done: doneCount,
    total: tasks.length,
  });
  const ring = (
    <ProgressRing
      done={doneCount}
      total={tasks.length}
      className={variant === 'row' ? 'sidebar-panel-item-icon' : 'sidebar-nav-icon'}
    />
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {variant === 'row' ? (
        <PopoverTrigger asChild>
          <button
            type="button"
            className="sidebar-panel-item sidebar-guide"
            aria-label={`${title}, ${progress}`}
          >
            {ring}
            <span className="min-w-0 flex-1 truncate text-left">{title}</span>
            <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>
              {doneCount}/{tasks.length}
            </span>
          </button>
        </PopoverTrigger>
      ) : (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="sidebar-nav-item sidebar-guide"
                  aria-label={`${title}, ${progress}`}
                >
                  {ring}
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {title} · {doneCount}/{tasks.length}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      <PopoverContent
        side="right"
        align="end"
        sideOffset={variant === 'row' ? 18 : 16}
        className="w-80 rounded-xl p-0"
        onOpenAutoFocus={(e) => {
          if (!nextRef.current) return;
          e.preventDefault();
          nextRef.current.focus();
        }}
      >
        <GettingStartedPanel
          tasks={tasks}
          doneCount={doneCount}
          focusRef={nextRef}
          onSelect={(def) => {
            setOpen(false);
            onSelect(def);
          }}
          onDismiss={onDismiss}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The entry, wired to the onboarding state. Absent once every task is done,
 * the guide is hidden, or the welcome flow's conversation has the screen.
 *
 * Tasks complete via route visits or a derived signal (the saved investing
 * profile, a workspace); picking a pending one goes to it.
 */
export function GettingStartedLauncher({ variant }: { variant: 'row' | 'rail' }) {
  const { gettingStarted } = useOnboarding();
  const navigate = useNavigate();

  if (!gettingStarted.visible) return null;
  const { tasks, doneCount, dismiss, completeTask } = gettingStarted;

  const select = (def: GettingStartedTaskDef) => {
    if (!def.external) {
      navigate(def.to);
      return;
    }
    // Cross-app page — no route of ours to observe, so a successful open is
    // the completion signal. null = popup blocked; leave the task pending so
    // the user can retry. No 'noopener' feature string: that makes open()
    // return null even on success, which would read as "blocked" and leave the
    // task permanently pending. Sever the opener on the returned handle
    // instead.
    const win = window.open(def.to, '_blank');
    if (win) {
      win.opener = null;
      completeTask(def.id);
    }
  };

  return (
    <GettingStartedEntry
      variant={variant}
      tasks={tasks}
      doneCount={doneCount}
      onSelect={select}
      onDismiss={dismiss}
    />
  );
}
