import { onMessage } from '../src/messaging';
import { scanSeenPage } from '../src/lib/seen-page';
import type { ScanState } from '../src/types';

export default defineBackground(() => {
  const scans = new Map<number, Promise<ScanState>>();
  onMessage('scanJustWatchSeenPage', (message) => {
    const { tabId, autoScroll } = message.data;
    const existing = scans.get(tabId);
    if (existing) return existing;
    const scan = scanSeenPage(browser, tabId, { autoScroll }).finally(() => {
      scans.delete(tabId);
    });
    scans.set(tabId, scan);
    return scan;
  });
});
