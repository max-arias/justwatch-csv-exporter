import {
  buildScanSummary,
  parseJustWatchListDocument,
  type ScanResponse,
  type ScanState,
} from '../src/justwatch';
import { onMessage } from '../src/messaging';

const emptySummary = {
  scanned: 0,
  letterboxdRows: 0,
  traktRows: 0,
  unresolvedRows: 0,
};

let scanState: ScanState = {
  status: 'idle',
  items: [],
  summary: emptySummary,
};

let activeScan: Promise<void> | undefined;

export default defineContentScript({
  matches: ['https://www.justwatch.com/*'],
  main() {
    onMessage('scanJustWatchList', (message) => scanPage(message.data.autoScroll));
    onMessage('startJustWatchScan', (message) => startScan(message.data.autoScroll));
    onMessage('getJustWatchScanState', () => scanState);
  },
});

function startScan(autoScroll: boolean): ScanState {
  if (scanState.status === 'scanning') {
    return scanState;
  }

  scanState = {
    status: 'scanning',
    items: [],
    summary: emptySummary,
  };

  activeScan = scanPage(autoScroll)
    .then((response) => {
      scanState = {
        status: 'complete',
        ...response,
      };
    })
    .catch((error) => {
      scanState = {
        status: 'error',
        items: [],
        summary: emptySummary,
        error: error instanceof Error ? error.message : 'Scan failed',
      };
    })
    .finally(() => {
      activeScan = undefined;
    });

  void activeScan;

  return scanState;
}

async function scanPage(autoScroll: boolean): Promise<ScanResponse> {
  await prepareSeenListView();

  if (autoScroll) {
    await scrollUntilStable();
  }

  const items = parseJustWatchListDocument(document);
  // Detail-page fetching is intentionally disabled for now. The listing page
  // already provides enough data for Letterboxd exports, and fetching every
  // detail page can trigger JustWatch rate limits.
  const listingItemsOnly = items.map((item) => ({
    ...item,
    unresolvedReason:
      item.externalIds.length === 0
        ? 'Detail-page fetching disabled; external IDs were not present on the listing page'
        : item.unresolvedReason,
  }));

  return {
    items: listingItemsOnly,
    summary: buildScanSummary(listingItemsOnly),
  };
}

async function prepareSeenListView() {
  await waitFor(
    () => Boolean(document.querySelector('.list-layout-switcher__item')),
    15_000,
  );

  if (clickFirstLayoutOption()) {
    await waitFor(() => Boolean(document.querySelector('.list-layout-switcher__item')?.classList.contains('active')));
  }
}

function clickFirstLayoutOption(): boolean {
  const firstLayoutOption = document.querySelector<HTMLElement>('.list-layout-switcher__item');
  if (firstLayoutOption && !firstLayoutOption.classList.contains('active')) {
    firstLayoutOption.click();
    return true;
  }
  return false;
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000) {
  const startedAt = Date.now();
  while (!predicate() && Date.now() - startedAt < timeoutMs) {
    await delay(100);
  }
  if (!predicate()) {
    throw new Error('The JustWatch Seen list did not finish loading. Sign in and try again.');
  }
}

async function scrollUntilStable() {
  const targetCount = getExpectedTitleCount();
  let lastCount = 0;
  let stableRounds = 0;

  for (let round = 0; round < 80; round += 1) {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
    await delay(650);

    const count = document.querySelectorAll('.title-card').length;
    if (targetCount && count >= targetCount) return;

    if (count === lastCount) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
      lastCount = count;
    }

    if (stableRounds >= 4) return;
  }
}

function getExpectedTitleCount(): number | undefined {
  const amount = document.querySelector('[titlesamount]')?.getAttribute('titlesamount');
  if (!amount) return undefined;
  const parsed = Number.parseInt(amount, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
