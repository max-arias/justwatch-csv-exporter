import {
  buildScanSummary,
  parseJustWatchListDocument,
  type ScanResponse,
} from '../src/justwatch';
import { onMessage } from '../src/messaging';

export default defineContentScript({
  matches: ['https://www.justwatch.com/*'],
  main() {
    onMessage('scanJustWatchList', (message) => scanPage(message.data.autoScroll));
  },
});

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
  if (clickMyListsTab()) {
    await waitFor(() => Boolean(findLinkByText('My Lists')?.closest('.navigation-tab-item')?.classList.contains('active')));
  }

  if (clickSeenTab()) {
    await waitFor(() => Boolean(findTabByText('Seen')?.classList.contains('active')));
  }

  if (clickFirstLayoutOption()) {
    await waitFor(() => Boolean(document.querySelector('.list-layout-switcher__item.active')));
  }
}

function clickMyListsTab(): boolean {
  const myListsLink = findLinkByText('My Lists');
  const myListsTab = myListsLink?.closest<HTMLElement>('.navigation-tab-item');
  if (myListsLink && !myListsTab?.classList.contains('active')) {
    myListsLink.click();
    return true;
  }
  return false;
}

function clickSeenTab(): boolean {
  const seenTab = findTabByText('Seen');
  if (seenTab && !seenTab.classList.contains('active')) {
    seenTab.click();
    return true;
  }
  return false;
}

function clickFirstLayoutOption(): boolean {
  const firstLayoutOption = document.querySelector<HTMLElement>('.list-layout-switcher__item');
  if (firstLayoutOption && !firstLayoutOption.classList.contains('active')) {
    firstLayoutOption.click();
    return true;
  }
  return false;
}

function findLinkByText(text: string): HTMLAnchorElement | undefined {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>('a'))
    .find((anchor) => anchor.textContent?.trim() === text);
}

function findTabByText(text: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>('.watchlist-inner-tab-navigation__item'))
    .find((tab) => tab.textContent?.trim() === text);
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000) {
  const startedAt = Date.now();
  while (!predicate() && Date.now() - startedAt < timeoutMs) {
    await delay(100);
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
