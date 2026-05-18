import {
  buildScanSummary,
  enrichItemsWithExternalIds,
  parseJustWatchListDocument,
  type ScanResponse,
} from '../src/justwatch';

export default defineContentScript({
  matches: ['https://www.justwatch.com/*'],
  main() {
    browser.runtime.onMessage.addListener((message) => {
      if (!message || message.type !== 'SCAN_JUSTWATCH_LIST') return;

      return scanPage(Boolean(message.autoScroll));
    });
  },
});

async function scanPage(autoScroll: boolean): Promise<ScanResponse> {
  if (autoScroll) {
    await scrollUntilStable();
  }

  const items = parseJustWatchListDocument(document);
  const enriched = await enrichItemsWithExternalIds(items, document.baseURI, fetchDetailPage);

  return {
    items: enriched,
    summary: buildScanSummary(enriched),
  };
}

async function fetchDetailPage(url: string): Promise<string> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
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
