import { saveCsv } from '../src/lib/download';
import { loadSeenList } from '../src/lib/justwatch-session';
import { lastScan } from '../src/lib/scan-state';
import { onMessage } from '../src/messaging';

export default defineBackground(() => {
  // One load at a time: there is one stored result, and parallel loads would
  // only double the requests sent to JustWatch.
  let activeLoad: Promise<void> | undefined;

  onMessage('loadSeenList', () => {
    activeLoad ??= recordLoad().finally(() => {
      activeLoad = undefined;
    });
    return activeLoad;
  });

  // A service worker restart drops any in-flight load. The popup asks for this
  // check on open (which also wakes the worker), so it never spins forever.
  onMessage('settleScanState', async () => {
    const state = await lastScan.getValue();
    if (state?.status === 'loading' && !activeLoad) {
      await lastScan.setValue({
        status: 'error',
        error: 'The previous load was interrupted. Press Reload to try again.',
        finishedAt: new Date().toISOString(),
      });
    }
  });

  onMessage('saveCsv', ({ data: { filename, csv } }) => saveCsv(browser.downloads, filename, csv));
});

/** Loads the Seen list; the outcome (including errors) is published through `lastScan`. */
async function recordLoad(): Promise<void> {
  const startedAt = new Date().toISOString();
  await lastScan.setValue({ status: 'loading', startedAt });
  try {
    const list = await loadSeenList(browser, (loaded, total) => {
      void lastScan.setValue({ status: 'loading', startedAt, loaded, total });
    });
    await lastScan.setValue({ status: 'complete', list, finishedAt: new Date().toISOString() });
  } catch (error) {
    console.warn('JustWatch Seen list load failed', error);
    await lastScan.setValue({
      status: 'error',
      error: error instanceof Error ? error.message : 'Something went wrong. Please try again.',
      finishedAt: new Date().toISOString(),
    });
  }
}
