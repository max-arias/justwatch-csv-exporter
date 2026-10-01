import type { browser, Browser } from 'wxt/browser';
import type { ScanJustWatchListPayload } from '../messaging';
import { startScanMessage } from './scan-message';

const JUSTWATCH_HOME = 'https://www.justwatch.com/';

function countryFromUrl(tabUrl?: string): string | undefined {
  const url = new URL(tabUrl ?? JUSTWATCH_HOME);
  return url.origin === 'https://www.justwatch.com'
    ? url.pathname.match(/^\/([a-z]{2}(?:-[a-z]{2})?)(?:\/|$)/)?.[1]
    : undefined;
}

export async function scanSeenPage(
  browserApi: Pick<typeof browser, 'tabs' | 'scripting'>,
  tabId: number,
  data: ScanJustWatchListPayload,
) {
  await prepareSeenPage(browserApi, tabId);
  return startScanMessage(browserApi, tabId, data);
}

export async function prepareSeenPage(
  browserApi: Pick<typeof browser, 'tabs' | 'scripting'>,
  tabId: number,
): Promise<void> {
  let tab = await browserApi.tabs.get(tabId);
  let country = countryFromUrl(tab.url);
  if (!country) {
    tab = await loadPage(browserApi.tabs, tabId, JUSTWATCH_HOME, tab.url !== JUSTWATCH_HOME, true);
    country = countryFromUrl(tab.url) ?? await discoverCountry(browserApi.scripting, tabId);
  }
  const url = `https://www.justwatch.com/${country}/lists/my-lists?inner_tab=seenlist`;
  if (tab.url !== url || tab.status !== 'complete') {
    await loadPage(browserApi.tabs, tabId, url, tab.url !== url);
  }
}

async function discoverCountry(scripting: typeof browser.scripting, tabId: number): Promise<string> {
  const results = await scripting.executeScript({
    target: { tabId },
    func: async () => {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const link = document.querySelector<HTMLAnchorElement>('a[data-testid="navbar-watchlist"]');
        if (link?.href) return link.href;
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 100);
        await promise;
      }
      return undefined;
    },
  });
  const country = countryFromUrl(results[0]?.result);
  if (!country) {
    throw new Error('Could not detect your JustWatch country from the Lists link. Try opening the extension again.');
  }
  return country;
}

function loadPage(
  tabs: typeof browser.tabs,
  tabId: number,
  url: string,
  navigate: boolean,
  allowHomeRedirect = false,
): Promise<Browser.tabs.Tab> {
  const { promise, resolve, reject } = Promise.withResolvers<Browser.tabs.Tab>();
  const finish = (tab?: Browser.tabs.Tab, error?: Error) => {
    clearTimeout(timer);
    tabs.onUpdated.removeListener(onUpdated);
    tabs.onRemoved.removeListener(onRemoved);
    if (error) reject(error);
    else resolve(tab!);
  };
  const checkLoaded = (tab: Browser.tabs.Tab) => {
    if (tab.status !== 'complete') return;
    const validUrl = tab.url === url || (allowHomeRedirect && tab.url?.startsWith(JUSTWATCH_HOME));
    if (validUrl) finish(tab);
    else finish(undefined, new Error('Could not open the JustWatch Seen page. Sign in to JustWatch and try again.'));
  };
  const onUpdated = (updatedTabId: number, change: { status?: string }, tab: Browser.tabs.Tab) => {
    if (updatedTabId === tabId && change.status === 'complete') checkLoaded(tab);
  };
  const onRemoved = (removedTabId: number) => {
    if (removedTabId === tabId) finish(undefined, new Error('The JustWatch tab was closed.'));
  };
  const timer = setTimeout(() => finish(undefined, new Error('Timed out loading JustWatch. Try again.')), 25_000);
  tabs.onUpdated.addListener(onUpdated);
  tabs.onRemoved.addListener(onRemoved);

  void (async () => {
    try {
      if (navigate) await tabs.update(tabId, { url });
      checkLoaded(await tabs.get(tabId));
    } catch (error) {
      finish(undefined, error instanceof Error ? error : new Error('Could not load JustWatch.'));
    }
  })();
  return promise;
}
