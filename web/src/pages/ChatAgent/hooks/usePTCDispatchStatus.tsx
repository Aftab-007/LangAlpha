import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { useThreadRunStatus, type PublicRunStatus } from '@/lib/threadLifecycle/store';
import { getHandoffLiveness, type HandoffLiveness } from '../utils/api';
import { isLastingRefusal } from '../utils/api/errors';

/** UI-facing lifecycle of a dispatched PTC research run. */
export type PTCDispatchStatus =
  | 'starting'
  | 'running'
  | 'needs_input'
  | 'completed'
  | 'failed'
  | 'stopped';

const TERMINAL: ReadonlySet<PTCDispatchStatus> = new Set(['completed', 'failed', 'stopped']);

// A dispatched run that never registers (e.g. a continuation rejected by the
// per-user cap) stays 'starting' on every poll. Stop after this many polls so
// the turn doesn't watch a genuinely stuck dispatch forever. A real run flips to
// 'running' within seconds, so this only trips on a stuck dispatch, or on a read
// that keeps failing before it ever saw the run.
const STARTING_POLL_CAP = 30;
// The batched liveness read is cheap, but a Chief of Staff turn can register
// several dispatched runs at once, so stay responsive for the first few polls
// (quick completion / HITL prompt) then back off: a dispatched analysis runs
// for minutes.
const POLL_FAST_MS = 4_000;
const POLL_STEADY_MS = 10_000;
const POLL_FAST_COUNT = 5;

/** Map the backend's public status vocabulary (`WorkflowRunStatus`) onto the
 *  card's status. The cases enumerate that union's members so the mapping stays
 *  exhaustive: `idle`/`queued`/`recovering` (registered but no output yet) show
 *  "starting" and keep polling; `stopping` is still a live run. `raw` stays
 *  `unknown` — the wire boundary is untrusted, so the default absorbs anything
 *  off-vocabulary, including legacy pre-1.6 spellings (`active`). */
export function mapLivenessStatus(raw: unknown): PTCDispatchStatus {
  switch (raw) {
    case 'running':
    case 'stopping':
    case 'active': return 'running';
    case 'interrupted': return 'needs_input';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'cancelled': return 'stopped';
    case 'idle':
    case 'queued':
    case 'recovering': return 'starting';
    default: return 'starting';
  }
}

/**
 * Pure poll-cadence decision for the dispatch-status query. Both counters are
 * scoped to the current polling window (reset when polling re-arms on a wake),
 * not the query's lifetime: `pollCount` drives the fast→steady cadence,
 * `startingRounds` counts CONSECUTIVE still-'starting' results toward the cap.
 * Returns the next refetch interval in ms, or `false` to stop polling.
 * Exported for tests.
 */
export function nextDispatchPollInterval(
  status: PTCDispatchStatus,
  pollCount: number,
  startingRounds: number = pollCount,
): number | false {
  if (TERMINAL.has(status)) return false;
  if (status === 'starting' && startingRounds >= STARTING_POLL_CAP) return false;
  return pollCount < POLL_FAST_COUNT ? POLL_FAST_MS : POLL_STEADY_MS;
}

/**
 * Collapse a turn's per-run statuses into the single status that drives the
 * shared poll cadence: any in-flight run (running/needs_input) keeps the
 * fast→steady cadence alive; a still-`starting`-only set polls until the
 * starting cap then gives up; an all-terminal set stops.
 */
function aggregateStatus(statuses: PTCDispatchStatus[]): PTCDispatchStatus {
  if (statuses.some((s) => s === 'running' || s === 'needs_input')) return 'running';
  if (statuses.some((s) => s === 'starting')) return 'starting';
  return 'completed';
}

interface DispatchSlice {
  status: PTCDispatchStatus;
  /** Start of the thread's latest run (epoch ms), when the ledger has one. */
  startedAt?: number;
  /** When that run settled (epoch ms); absent while it is live. */
  finishedAt?: number;
  /** The thread's title, once it is named. */
  title?: string;
  /** The current name of the thread's workspace. */
  workspaceName?: string;
}

/** A hand-off's own run, read by its id. */
interface RunSlice {
  status: PTCDispatchStatus;
  startedAt?: number;
  finishedAt?: number;
}

/** What a hand-off reads beyond its thread. */
export interface DispatchPin {
  /** The hand-off's run, as the dispatch's result named it. */
  runId?: string;
  /** For a dispatch whose outcome is unknown: when it was made (epoch ms).
   *  A run the thread started before then is not the hand-off's. */
  since?: number;
}

interface DispatchWatch extends DispatchPin {
  threadId: string;
}

/** Where a hand-off stands as the reads and the feed have it. */
export interface DispatchRead {
  status: PTCDispatchStatus;
  startedAt?: number;
  finishedAt?: number;
}

/**
 * Whether the thread's latest run can be a hand-off made at `since`: one it
 * started, or one still live then, which a hand-off that steered in joined.
 * A run already over by then cannot be.
 */
function liveSince(thread: DispatchSlice | undefined, since: number): boolean {
  if (thread?.startedAt === undefined) return false;
  if (thread.startedAt >= since) return true;
  return thread.finishedAt === undefined ? !TERMINAL.has(thread.status) : thread.finishedAt >= since;
}

/**
 * Which run describes a hand-off. Its own run once that run is over: the
 * hand-off ended there, whatever the thread does later. While its run is live
 * it is the thread's latest, which the feed reaches first. An interrupted run
 * is answered by a new run on the thread, so a hand-off whose run stopped to
 * ask follows the thread. With no run to pin, the thread's latest run, unless
 * it was over before a dispatch of unknown outcome was made.
 */
function resolveDispatchRead(
  pin: DispatchPin,
  thread: DispatchSlice | undefined,
  run: RunSlice | undefined,
  pushed: PTCDispatchStatus | null,
): DispatchRead {
  if (run && TERMINAL.has(run.status)) {
    return { status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt };
  }
  if (pin.since !== undefined && !liveSince(thread, pin.since)) {
    return { status: 'starting' };
  }
  const status = pushed ?? thread?.status ?? 'starting';
  if (run && run.status !== 'needs_input') {
    return { status, startedAt: run.startedAt, finishedAt: run.finishedAt };
  }
  // The read's times are the run it read, the thread's latest then. A live
  // read is the same run a push has since settled; a settled one the push has
  // moved on from is an earlier run, whose start would time the new one.
  const timed = !!thread && (thread.status === 'running' || thread.status === status);
  return {
    status,
    startedAt: timed ? thread.startedAt : undefined,
    finishedAt: timed ? thread.finishedAt : undefined,
  };
}

/** One read as the provider caches it, with the ids it asked about: an id
 *  asked about and absent has no run yet, which is an answer too. */
interface LivenessRead extends HandoffLiveness {
  threadIds: readonly string[];
  runIds: readonly string[];
}

interface ReadSlices {
  threads: Map<string, DispatchSlice>;
  runs: Map<string, RunSlice>;
  readThreads: ReadonlySet<string>;
  readRuns: ReadonlySet<string>;
}

function parseMs(iso: string | null | undefined): number | undefined {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : undefined;
}

function slicesOf(read: LivenessRead | undefined): ReadSlices {
  const threads = new Map<string, DispatchSlice>();
  for (const row of read?.liveness ?? []) {
    threads.set(row.thread_id, {
      status: mapLivenessStatus(row.status),
      startedAt: parseMs(row.run_started_at),
      finishedAt: parseMs(row.run_finished_at),
      title: row.title?.trim() || undefined,
      workspaceName: row.workspace_name?.trim() || undefined,
    });
  }
  const runs = new Map<string, RunSlice>();
  for (const row of read?.runs ?? []) {
    runs.set(row.run_id, {
      status: mapLivenessStatus(row.status),
      startedAt: parseMs(row.run_started_at),
      finishedAt: parseMs(row.run_finished_at),
    });
  }
  return { threads, runs, readThreads: new Set(read?.threadIds), readRuns: new Set(read?.runIds) };
}

interface DispatchStatusContextValue {
  register: (watch: DispatchWatch) => void;
  unregister: (watch: DispatchWatch) => void;
  /** Read again now: a push said the thread's run settled, and the last read
   *  does not say when. */
  settle: (threadId: string) => void;
  /** The resolved reads, distributed via context. */
  read: ReadSlices;
}

const DispatchStatusContext = createContext<DispatchStatusContextValue | null>(null);

const watchKey = ({ threadId, runId, since }: DispatchWatch) =>
  JSON.stringify([threadId, runId ?? null, since ?? null]);

function watchOf(key: string): DispatchWatch {
  const [threadId, runId, since] = JSON.parse(key) as [string, string | null, number | null];
  return { threadId, ...(runId ? { runId } : {}), ...(since !== null ? { since } : {}) };
}

/** Sorted, deduped, and joined, so an unchanged set keeps its identity. */
function idSet(values: Iterable<string | undefined>): string {
  return [...new Set([...values].filter((v): v is string => !!v))].sort().join(',');
}

const splitIds = (joined: string): string[] => (joined ? joined.split(',') : []);

/**
 * Runs ONE batched dispatch-liveness query for every hand-off in a Chief of
 * Staff turn. Each hand-off registers what it watches (its thread, and its own
 * run once the dispatch named it); the provider polls the sorted id sets once
 * and distributes a slice per thread and per run via context, collapsing N
 * per-card `/status` polls into a single request on a single timer.
 */
export function DispatchStatusProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [watchKeys, setWatchKeys] = useState<string[]>([]);
  // Ref-count registrations so two cards on the same hand-off share one entry
  // and one card unmounting doesn't drop a watch another card still holds.
  const countsRef = useRef<Map<string, number>>(new Map());
  // Latest distributed slices, readable from the stable `register` callback.
  const slicesRef = useRef<Map<string, DispatchSlice>>(new Map());
  // Poll-cadence counters scoped to the CURRENT polling window. The query's
  // update counts are cumulative for its life, so deriving cadence from them
  // directly makes the starting cap trip instantly (and skips the fast window)
  // on any later dispatch; these reset whenever polling re-arms instead.
  const cadenceRef = useRef({ polls: 0, startingRounds: 0, lastSettledCount: 0 });

  const register = useCallback((watch: DispatchWatch) => {
    const key = watchKey(watch);
    const counts = countsRef.current;
    const threadWatched = [...counts.keys()].some((k) => k !== key && watchOf(k).threadId === watch.threadId);
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    if (next === 1) setWatchKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    // A hand-off with no run of its own registering on a thread already read,
    // whose run already finished, is a RESUMED dispatch: the id sets (and thus
    // the query key) are unchanged, so the dormant query would keep serving
    // the stale terminal slice forever. Re-arm the cadence window and wake
    // every id-set variant. Terminal-gated so re-renders during live polling
    // never add fetches. A run of its own is a new key, read on its own.
    if (watch.runId || (next === 1 && !threadWatched)) return;
    const current = slicesRef.current.get(watch.threadId)?.status;
    if (current && TERMINAL.has(current)) {
      cadenceRef.current.polls = 0;
      cadenceRef.current.startingRounds = 0;
      void queryClient.invalidateQueries({ queryKey: queryKeys.threads.dispatchLivenessAll() });
    }
  }, [queryClient]);

  const unregister = useCallback((watch: DispatchWatch) => {
    const key = watchKey(watch);
    const counts = countsRef.current;
    const next = (counts.get(key) ?? 0) - 1;
    if (next > 0) {
      counts.set(key, next);
      return;
    }
    counts.delete(key);
    setWatchKeys((prev) => prev.filter((k) => k !== key));
  }, []);

  const watches = useMemo(() => watchKeys.map(watchOf), [watchKeys]);
  // Joined strings first, so a new watch on a thread and run already read
  // keeps the id arrays, and the query key, as they were.
  const idsJoined = idSet(watches.map((w) => w.threadId));
  const runsJoined = idSet(watches.map((w) => w.runId));
  const sortedIds = useMemo(() => splitIds(idsJoined), [idsJoined]);
  const sortedRuns = useMemo(() => splitIds(runsJoined), [runsJoined]);
  // The ids the query reads, for `settle`: a refetch runs even while the query
  // is disabled, so asking before a thread's id is read would send a read
  // without it, and the read its registration starts answers it anyway.
  const readIdsRef = useRef<readonly string[]>(sortedIds);
  useEffect(() => {
    readIdsRef.current = sortedIds;
  }, [sortedIds]);

  // A changed id set is a NEW cache entry (its settle count restarts at 0), so
  // the cadence window restarts with it.
  useEffect(() => {
    cadenceRef.current = { polls: 0, startingRounds: 0, lastSettledCount: 0 };
  }, [sortedIds, sortedRuns]);

  const { data, refetch } = useQuery({
    queryKey: queryKeys.threads.dispatchLiveness(sortedIds, sortedRuns),
    queryFn: async (): Promise<LivenessRead> => ({
      threadIds: sortedIds,
      runIds: sortedRuns,
      ...(await getHandoffLiveness(sortedIds, sortedRuns)),
    }),
    enabled: sortedIds.length > 0,
    staleTime: 2_000,
    // A new hand-off is a new key; the others keep what they read meanwhile
    // rather than drop back to 'starting' for a round trip.
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const { threads, runs } = slicesOf(query.state.data as LivenessRead | undefined);
      // Each hand-off as the poll alone resolves it: one whose own run is
      // over keeps nothing alive, whatever its thread runs since. Omitted ids
      // map to 'starting' (keep watching), matching mapLivenessStatus.
      const statuses = watches.map((w) =>
        resolveDispatchRead(w, threads.get(w.threadId), w.runId ? runs.get(w.runId) : undefined, null).status);
      const aggregate = aggregateStatus(statuses);
      // Advance window-scoped counters once per SETTLED fetch, deduped on the
      // cumulative settle count since this callback re-evaluates more often.
      // A failure counts too: the query keeps the last answer, so the round
      // reads as that answer did. Counting only successes held a failing
      // endpoint on the fast cadence forever.
      const cadence = cadenceRef.current;
      const settled = query.state.dataUpdateCount + query.state.errorUpdateCount;
      if (settled !== cadence.lastSettledCount) {
        cadence.lastSettledCount = settled;
        cadence.polls += 1;
        cadence.startingRounds = aggregate === 'starting' ? cadence.startingRounds + 1 : 0;
      }
      // A 403 answers the same next time. A 401 is an expired session that
      // can come back, so it only backs off.
      if (isLastingRefusal(query.state.error)) return false;
      return nextDispatchPollInterval(aggregate, cadence.polls, cadence.startingRounds);
    },
    // The app's one retry, except for the refusal that stops the poll above.
    retry: (failureCount, err) => failureCount < 1 && !isLastingRefusal(err),
  });

  const read = useMemo(() => slicesOf(data), [data]);

  useEffect(() => {
    slicesRef.current = read.threads;
  }, [read]);

  // A push can settle a run before the poll reads it, and the poll stops once
  // its own read is terminal, so a push that settles a run gets one read of
  // its own. Joining a read already in flight keeps N cards on one thread to
  // one request.
  const settle = useCallback((threadId: string) => {
    if (readIdsRef.current.includes(threadId)) void refetch({ cancelRefetch: false });
  }, [refetch]);

  const value = useMemo<DispatchStatusContextValue>(
    () => ({ register, unregister, settle, read }),
    [register, unregister, settle, read],
  );

  // JSX, not createElement: the compiler reads a plain call that is handed
  // the ref-backed callbacks as a ref read in render, and skips the provider.
  return <DispatchStatusContext value={value}>{children}</DispatchStatusContext>;
}

/** Lifecycle-store status → card status; null while the store has nothing
 *  ('idle') so the pre-ledger dispatch window falls through to the poll. */
export function mapLifecycleStatus(s: PublicRunStatus): PTCDispatchStatus | null {
  switch (s) {
    case 'running':
    case 'stopping': return 'running';
    case 'interrupted': return 'needs_input';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'cancelled': return 'stopped';
    case 'queued':
    case 'recovering': return 'starting';
    default: return null;
  }
}

/** A hand-off's status as `useDispatchStatus` reads it. */
export interface DispatchStatusView extends DispatchRead {
  title?: string;
  workspaceName?: string;
  /** Whether a read or the feed has spoken yet, or nothing is watched. Until
   *  then the status is the default, not news. */
  read: boolean;
}

/**
 * Read one hand-off's liveness. The lifecycle store (user feed) is the primary
 * source for the thread once its run is ledger-known: settles arrive as
 * pushes, not on the next poll tick. The provider's batched poll is retained as
 * the pre-ledger fallback: a just-dispatched run has no lifecycle row yet, and
 * only the poll can distinguish "still registering" from "never registered".
 * A pinned run (`pin.runId`) is read by its id too, and once it is over it
 * alone says how the hand-off ended (see `resolveDispatchRead`). Registers the
 * watch while `enabled` so the provider's batched query covers it; reads
 * nothing otherwise. Returns 'starting' when no source has resolved it yet.
 * The thread's title and its workspace's current name come from the poll.
 */
export function useDispatchStatus(
  threadId: string | undefined,
  enabled: boolean,
  pin: DispatchPin = {},
): DispatchStatusView {
  const ctx = useContext(DispatchStatusContext);
  // Pull the stable register fns out of the context value (whose identity
  // changes every poll) so this effect doesn't re-run — and re-register — on
  // each distribution.
  const register = ctx?.register;
  const unregister = ctx?.unregister;
  const active = enabled && !!threadId;
  const { runId, since } = pin;

  useEffect(() => {
    if (!register || !unregister || !active || !threadId) return;
    const watch = { threadId, runId, since };
    register(watch);
    return () => unregister(watch);
  }, [register, unregister, active, threadId, runId, since]);

  const pushed = mapLifecycleStatus(useThreadRunStatus(active && threadId ? threadId : ''));
  const watched = active && !!threadId && !!ctx;
  // Until a read asks about the pinned run, the one on hand is kept from
  // before the pin, and its thread may be on an earlier run.
  const current = watched && (!runId || ctx.read.readRuns.has(runId));
  const named = watched ? ctx.read.threads.get(threadId) : undefined;
  const thread = current ? named : undefined;
  const run = watched && runId ? ctx.read.runs.get(runId) : undefined;
  const resolved = resolveDispatchRead({ runId, since }, thread, run, pushed);
  const pinnedOver = !!run && TERMINAL.has(run.status);

  // A push that settled the run, when the last read cannot say when: the read
  // was live, or of another run (the push moved here while this view watched).
  // A pinned run that is over needs nothing more.
  const settle = ctx?.settle;
  const settledByPush = pushed !== null && TERMINAL.has(pushed);
  const finishKnown = resolved.finishedAt !== undefined && resolved.status === pushed;
  const lastPushedRef = useRef(pushed);
  useEffect(() => {
    const moved = lastPushedRef.current !== pushed;
    lastPushedRef.current = pushed;
    if (settle && active && threadId && !pinnedOver && settledByPush && (moved || !finishKnown)) settle(threadId);
  }, [settle, active, threadId, pinnedOver, pushed, settledByPush, finishKnown]);

  return {
    ...resolved,
    title: named?.title,
    workspaceName: named?.workspaceName,
    read: !watched || pushed !== null || (current && ctx.read.readThreads.has(threadId)),
  };
}
