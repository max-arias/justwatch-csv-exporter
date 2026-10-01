import { afterEach, describe, expect, it, vi } from 'vitest';
import type { browser, Browser } from 'wxt/browser';
vi.mock('./scan-message', () => ({ startScanMessage: vi.fn() }));
import { prepareSeenPage, scanSeenPage } from './seen-page';
import { startScanMessage } from './scan-message';

function harness(url: string | undefined, status = 'complete') {
  let tab = { id: 12, url, status } as Browser.tabs.Tab;
  const updated = new Set<(id: number, change: { status?: string }, tab: Browser.tabs.Tab) => void>();
  const removed = new Set<(id: number) => void>();
  const executeScript = vi.fn().mockResolvedValue([{ result: 'https://www.justwatch.com/uk/lists/public-lists' }]);
  const api = {
    tabs: {
      get: vi.fn(async () => tab),
      update: vi.fn(async (_id: number, options: { url: string }) => {
        tab = { ...tab, url: options.url, status: 'loading' };
        return tab;
      }),
      onUpdated: {
        addListener: (fn: Parameters<typeof updated.add>[0]) => updated.add(fn),
        removeListener: (fn: Parameters<typeof updated.add>[0]) => updated.delete(fn),
      },
      onRemoved: {
        addListener: (fn: Parameters<typeof removed.add>[0]) => removed.add(fn),
        removeListener: (fn: Parameters<typeof removed.add>[0]) => removed.delete(fn),
      },
    },
    scripting: { executeScript },
  };
  return {
    api: api as unknown as Pick<typeof browser, 'tabs' | 'scripting'>,
    update: api.tabs.update,
    executeScript,
    updated,
    removed,
    complete(completedUrl = tab.url, id = 12) {
      if (id === 12) tab = { ...tab, url: completedUrl, status: 'complete' };
      for (const listener of updated) listener(id, { status: 'complete' }, { ...tab, status: 'complete' });
    },
  };
}

const homeUrl = 'https://www.justwatch.com/';
const seenUrl = 'https://www.justwatch.com/uk/lists/my-lists?inner_tab=seenlist';

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('Seen-page preparation', () => {
  it.each(['us', 'uk', 'de', 'in', 'au', 'be-nl'])('preserves %s and waits for the requested tab, not another tab', async (country) => {
    const h = harness(`https://www.justwatch.com/${country}/lists/my-lists?inner_tab=watchlist`);
    let ready = false;
    const preparation = prepareSeenPage(h.api, 12).then(() => { ready = true; });
    await vi.waitFor(() => expect(h.update).toHaveBeenCalledWith(12, {
      url: `https://www.justwatch.com/${country}/lists/my-lists?inner_tab=seenlist`,
    }));
    expect(ready).toBe(false);
    h.complete(undefined, 99);
    await Promise.resolve();
    expect(ready).toBe(false);
    h.complete();
    await preparation;
    expect(ready).toBe(true);
    expect(h.executeScript).not.toHaveBeenCalled();
    expect(h.updated.size).toBe(0);
    expect(h.removed.size).toBe(0);
  });

  it('does not reload an already loaded Seen page', async () => {
    const h = harness(seenUrl);
    await prepareSeenPage(h.api, 12);
    expect(h.update).not.toHaveBeenCalled();
    expect(h.executeScript).not.toHaveBeenCalled();
  });

  it('waits for an already loading Seen page without restarting navigation', async () => {
    const h = harness(seenUrl, 'loading');
    const preparation = prepareSeenPage(h.api, 12);
    await vi.waitFor(() => expect(h.updated.size).toBe(1));
    expect(h.update).not.toHaveBeenCalled();
    h.complete();
    await preparation;
    expect(h.updated.size).toBe(0);
  });

  it.each(['https://example.com/us/', 'https://www.justwatch.com.evil.example/us/', undefined])(
    'opens JustWatch and discovers the country from Lists when starting at %s', async (url) => {
      const h = harness(url);
      const preparation = prepareSeenPage(h.api, 12);
      await vi.waitFor(() => expect(h.update).toHaveBeenNthCalledWith(1, 12, { url: homeUrl }));
      expect(h.executeScript).not.toHaveBeenCalled();
      h.complete();
      await vi.waitFor(() => expect(h.update).toHaveBeenNthCalledWith(2, 12, { url: seenUrl }));
      h.complete();
      await preparation;
      expect(h.updated.size).toBe(0);
      expect(h.removed.size).toBe(0);
    },
  );

  it('uses a regional homepage redirect without needing the Lists link', async () => {
    const h = harness('https://example.com/');
    const preparation = prepareSeenPage(h.api, 12);
    await vi.waitFor(() => expect(h.update).toHaveBeenCalledWith(12, { url: homeUrl }));
    h.complete('https://www.justwatch.com/de/');
    await vi.waitFor(() => expect(h.update).toHaveBeenLastCalledWith(12, {
      url: 'https://www.justwatch.com/de/lists/my-lists?inner_tab=seenlist',
    }));
    h.complete();
    await preparation;
    expect(h.executeScript).not.toHaveBeenCalled();
  });

  it('waits for a localized Lists link to appear on the homepage', async () => {
    vi.useFakeTimers();
    const h = harness(homeUrl);
    h.executeScript.mockImplementation(async ({ func }: { func: () => Promise<string | undefined> }) => [{ result: await func() }]);
    const preparation = prepareSeenPage(h.api, 12);
    await vi.advanceTimersByTimeAsync(200);
    expect(h.update).not.toHaveBeenCalled();
    document.body.innerHTML = '<a data-testid="navbar-watchlist" href="https://www.justwatch.com/fr/lists/public-lists">Listes</a>';
    await vi.advanceTimersByTimeAsync(100);
    expect(h.update).toHaveBeenCalledWith(12, {
      url: 'https://www.justwatch.com/fr/lists/my-lists?inner_tab=seenlist',
    });
    h.complete();
    await preparation;
  });

  it('reports a missing Lists link instead of guessing a country', async () => {
    vi.useFakeTimers();
    const h = harness(homeUrl);
    h.executeScript.mockImplementation(async ({ func }: { func: () => Promise<string | undefined> }) => [{ result: await func() }]);
    const preparation = prepareSeenPage(h.api, 12);
    const failed = expect(preparation).rejects.toThrow('Could not detect your JustWatch country');
    await vi.advanceTimersByTimeAsync(15_000);
    await failed;
    expect(h.update).not.toHaveBeenCalled();
  });

  it('rejects a Lists link pointing to a different site', async () => {
    const h = harness(homeUrl);
    h.executeScript.mockResolvedValue([{ result: 'https://example.com/us/lists/public-lists' }]);
    await expect(prepareSeenPage(h.api, 12)).rejects.toThrow('Could not detect your JustWatch country');
    expect(h.update).not.toHaveBeenCalled();
  });

  it('rejects a login redirect instead of treating it as the Seen page', async () => {
    const h = harness('https://www.justwatch.com/uk/');
    const preparation = prepareSeenPage(h.api, 12);
    const failed = expect(preparation).rejects.toThrow('Sign in to JustWatch');
    await vi.waitFor(() => expect(h.update).toHaveBeenCalled());
    h.complete('https://www.justwatch.com/uk/login');
    await failed;
    expect(h.updated.size).toBe(0);
  });

  it('stops waiting when the tab is closed', async () => {
    const h = harness(seenUrl, 'loading');
    const preparation = prepareSeenPage(h.api, 12);
    const failed = expect(preparation).rejects.toThrow('tab was closed');
    await vi.waitFor(() => expect(h.removed.size).toBe(1));
    for (const listener of h.removed) listener(12);
    await failed;
    expect(h.updated.size).toBe(0);
  });

  it('reports a stalled navigation', async () => {
    vi.useFakeTimers();
    const h = harness(seenUrl, 'loading');
    const preparation = prepareSeenPage(h.api, 12);
    const failed = expect(preparation).rejects.toThrow('Timed out');
    await vi.advanceTimersByTimeAsync(25_000);
    await failed;
    expect(h.updated.size).toBe(0);
    expect(h.removed.size).toBe(0);
  });
});

describe('automatic current-tab extraction', () => {
  it('starts extraction only after country discovery and Seen-page loading finish', async () => {
    const h = harness('https://example.com/');
    const scan = scanSeenPage(h.api, 12, { autoScroll: true });
    await vi.waitFor(() => expect(h.update).toHaveBeenCalledWith(12, { url: homeUrl }));
    expect(startScanMessage).not.toHaveBeenCalled();
    h.complete();
    await vi.waitFor(() => expect(h.update).toHaveBeenCalledWith(12, { url: seenUrl }));
    expect(startScanMessage).not.toHaveBeenCalled();
    h.complete(undefined, 99);
    await Promise.resolve();
    expect(startScanMessage).not.toHaveBeenCalled();
    h.complete();
    await scan;
    expect(startScanMessage).toHaveBeenCalledTimes(1);
  });

  it('starts extraction without reloading when already on Seen', async () => {
    const h = harness(seenUrl);
    await scanSeenPage(h.api, 12, { autoScroll: true });
    expect(h.update).not.toHaveBeenCalled();
    expect(startScanMessage).toHaveBeenCalledTimes(1);
  });

  it('does not start extraction when navigation ends on a different page', async () => {
    const h = harness('https://www.justwatch.com/uk/');
    const scan = scanSeenPage(h.api, 12, { autoScroll: true });
    const failed = expect(scan).rejects.toThrow('Could not open');
    await vi.waitFor(() => expect(h.update).toHaveBeenCalled());
    h.complete('https://www.justwatch.com/uk/login');
    await failed;
    expect(startScanMessage).not.toHaveBeenCalled();
  });
});
