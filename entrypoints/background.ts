import { saveCsv } from '../src/lib/download';
import { loadTitleList } from '../src/lib/justwatch-session';
import { scanStates } from '../src/lib/scan-state';
import { onMessage } from '../src/messaging';
import type { ListKind } from '../src/types';

export default defineBackground(() => {
  // One load at a time across both lists: parallel loads would only multiply
  // the requests sent to JustWatch.
  let activeLoad: { kind: ListKind; promise: Promise<void> } | undefined;

  onMessage('loadList', ({ data: kind }) => {
    if (activeLoad?.kind === kind) return activeLoad.promise;
    if (activeLoad) throw new Error('Another list is still loading. Try again when it finishes.');
    const promise = recordLoad(kind).finally(() => {
      activeLoad = undefined;
    });
    activeLoad = { kind, promise };
    return promise;
  });

  // A service worker restart drops any in-flight load. The popup asks for this
  // check on open (which also wakes the worker), so it never spins forever.
  onMessage('settleScanState', async () => {
    for (const kind of ['seen', 'watchlist'] as const) {
      const state = await scanStates[kind].getValue();
      if (state?.status !== 'loading' || activeLoad?.kind === kind) continue;
      await scanStates[kind].setValue({
        status: 'error',
        error: 'The previous load was interrupted. Please load the list again.',
        finishedAt: new Date().toISOString(),
      });
    }
  });

  onMessage('saveCsv', ({ data: { filename, csv } }) => saveCsv(browser.downloads, filename, csv));
});

/** Loads one list; the outcome (including errors) is published through `scanStates[kind]`. */
async function recordLoad(kind: ListKind): Promise<void> {
  const item = scanStates[kind];
  const startedAt = new Date().toISOString();
  await item.setValue({ status: 'loading', startedAt });
  try {
    const list = await loadTitleList(browser, kind, (loaded, total) => {
      void item.setValue({ status: 'loading', startedAt, loaded, total });
    });
    await item.setValue({ status: 'complete', list, finishedAt: new Date().toISOString() });
  } catch (error) {
    console.warn('JustWatch list load failed', kind, error);
    await item.setValue({
      status: 'error',
      error: error instanceof Error ? error.message : 'Something went wrong. Please try again.',
      finishedAt: new Date().toISOString(),
    });
  }
}
