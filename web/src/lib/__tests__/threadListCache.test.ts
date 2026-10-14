import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { patchThreadTitle } from '@/lib/threadListCache';

describe('patchThreadTitle', () => {
  it('reaches the hand-off cards\' liveness reads, which stop polling once a run settles', () => {
    const qc = new QueryClient();
    const key = queryKeys.threads.dispatchLiveness(['t-1', 't-2']);
    qc.setQueryData(key, [
      { thread_id: 't-1', status: 'completed', title: 'Build a demo-ready' },
      { thread_id: 't-2', status: 'running', title: 'Other' },
    ]);

    patchThreadTitle(qc, 't-1', 'Credit Cycle Dashboard', '2026-10-14T00:00:00Z');

    expect(qc.getQueryData(key)).toEqual([
      { thread_id: 't-1', status: 'completed', title: 'Credit Cycle Dashboard' },
      { thread_id: 't-2', status: 'running', title: 'Other' },
    ]);
  });
});
