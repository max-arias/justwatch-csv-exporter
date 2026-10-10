import { afterEach, describe, expect, it, vi } from 'vitest';
import type { browser, Browser } from 'wxt/browser';
import type { GraphqlResponse } from './justwatch-api';
import {
  findJustWatchTab,
  loadTitleList,
  waitForJustWatch,
  readPageSession,
  readSession,
  SignedOutError,
  type PageSession,
} from './justwatch-session';

type UpdatedListener = (id: number, change: { status?: string }, tab: Browser.tabs.Tab) => void;
type Tab = Browser.tabs.Tab;

const signedIn: PageSession = { country: 'de', signedIn: true, accessToken: 'token', deviceId: 'device', appLoaded: true };
const okPage: GraphqlResponse = {
  status: 200,
  body: { data: { titleListV2: { totalCount: 1, pageInfo: { endCursor: null, hasNextPage: false }, edges: [{ node: {
    id: 'tm1', objectType: 'MOVIE', content: { title: 'GoodFellas', originalReleaseYear: 1990, fullPath: '/de/Film/x', externalIds: { imdbId: 'tt0099685' } },
  } }] } } },
};

/** Fake tabs + scripting. Sessions and API responses are looked up per tab. */
function harness(initialTabs: Array<Partial<Tab>>, sessions: Record<number, PageSession>, posts: Record<number, GraphqlResponse[]>) {
  const tabs = new Map<number, Tab>(initialTabs.map((tab) => [tab.id!, { active: false, discarded: false, ...tab } as Tab]));
  const updated = new Set<UpdatedListener>();
  const removed = new Set<(id: number) => void>();
  let nextId = 100;
  const tabsApi = {
    query: vi.fn(async () => [...tabs.values()].filter((tab) => tab.url?.startsWith('https://www.justwatch.com/'))),
    get: vi.fn(async (id: number) => {
      const tab = tabs.get(id);
      if (!tab) throw new Error('No tab');
      return tab;
    }),
    create: vi.fn(async ({ url, active }: { url: string; active: boolean }) => {
      const tab = { id: nextId++, url, active, status: 'complete', discarded: false } as Tab;
      tabs.set(tab.id!, tab);
      sessions[tab.id!] ??= signedIn;
      return tab;
    }),
    remove: vi.fn(async (id: number) => {
      tabs.delete(id);
      for (const listener of removed) listener(id);
    }),
    onUpdated: { addListener: (fn: UpdatedListener) => updated.add(fn), removeListener: (fn: UpdatedListener) => updated.delete(fn) },
    onRemoved: { addListener: (fn: (id: number) => void) => removed.add(fn), removeListener: (fn: (id: number) => void) => removed.delete(fn) },
  };
  const executeScript = vi.fn(async ({ target, func }: { target: { tabId: number }; func: unknown }) => {
    if (!tabs.has(target.tabId)) throw new Error('No tab with id');
    const result = func === readPageSession ? sessions[target.tabId] : posts[target.tabId]?.shift() ?? okPage;
    return [{ result }];
  });
  const api = { tabs: tabsApi, scripting: { executeScript } } as unknown as Pick<typeof browser, 'tabs' | 'scripting'>;
  return {
    api,
    tabs,
    tabsApi,
    executeScript,
    updated,
    removed,
    complete(id: number, url: string) {
      const tab = { ...tabs.get(id)!, url, status: 'complete' } as Tab;
      tabs.set(id, tab);
      for (const listener of updated) listener(id, { status: 'complete' }, tab);
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('loadTitleList', () => {
  it('opens a background tab when no JustWatch tab exists, and closes it afterwards', async () => {
    const h = harness([{ id: 1, url: 'https://example.com/form', active: true, status: 'complete' }], {}, {});
    const list = await loadTitleList(h.api, 'seen');
    expect(list.titles.map((title) => title.title)).toEqual(['GoodFellas']);
    expect(h.tabsApi.create).toHaveBeenCalledWith({ url: 'https://www.justwatch.com/', active: false });
    expect(h.tabs.get(1)?.url).toBe('https://example.com/form');
    expect(h.tabs.has(100)).toBe(false);
  });

  it('keeps the background tab if the user switched to it', async () => {
    const h = harness([], {}, {});
    h.executeScript.mockImplementationOnce(async ({ target }) => {
      h.tabs.set(target.tabId, { ...h.tabs.get(target.tabId)!, active: true });
      return [{ result: signedIn }];
    });
    await loadTitleList(h.api, 'seen');
    expect(h.tabsApi.remove).not.toHaveBeenCalled();
  });

  it('uses an existing JustWatch tab without opening another', async () => {
    const h = harness([{ id: 7, url: 'https://www.justwatch.com/jp', status: 'complete' }], { 7: signedIn }, {});
    await loadTitleList(h.api, 'seen');
    expect(h.tabsApi.create).not.toHaveBeenCalled();
    expect(h.executeScript.mock.calls.every(([options]) => options.target.tabId === 7)).toBe(true);
  });

  it('reports a signed-out user from an existing tab without opening another', async () => {
    const h = harness([{ id: 7, url: 'https://www.justwatch.com/us', status: 'complete' }], { 7: { ...signedIn, signedIn: false, accessToken: undefined } }, {});
    await expect(loadTitleList(h.api, 'seen')).rejects.toBeInstanceOf(SignedOutError);
    expect(h.tabsApi.create).not.toHaveBeenCalled();
  });

  it('falls back to its own tab when an existing tab has no usable token', async () => {
    const h = harness([{ id: 7, url: 'https://www.justwatch.com/us', status: 'complete' }], { 7: { ...signedIn, accessToken: undefined } }, {});
    await loadTitleList(h.api, 'seen');
    expect(h.tabsApi.create).toHaveBeenCalledTimes(1);
    expect(h.executeScript.mock.calls.at(-1)?.[0].target.tabId).toBe(100);
  });

  it('renews a rejected session in a freshly loaded tab and retries there', async () => {
    const h = harness([{ id: 7, url: 'https://www.justwatch.com/us', status: 'complete' }], { 7: signedIn }, { 7: [{ status: 401, body: null }] });
    await expect(loadTitleList(h.api, 'seen')).resolves.toMatchObject({ total: 1 });
    expect(h.tabsApi.create).toHaveBeenCalledTimes(1);
    expect(h.executeScript.mock.calls.at(-1)?.[0].target.tabId).toBe(100);
  });

  it('turns a tab that disappears mid-load into a friendly error', async () => {
    const h = harness([{ id: 7, url: 'https://www.justwatch.com/us', status: 'complete' }], { 7: signedIn }, {});
    h.executeScript.mockImplementationOnce(async () => [{ result: signedIn }]);
    h.executeScript.mockImplementationOnce(async () => {
      throw new Error('Frame with ID 0 was removed.');
    });
    await expect(loadTitleList(h.api, 'seen')).rejects.toThrow('Something went wrong. Please try again.');
  });
});

describe('findJustWatchTab', () => {
  it('prefers the active loaded tab and skips discarded ones', async () => {
    const h = harness([
      { id: 1, url: 'https://www.justwatch.com/us', status: 'complete', discarded: true, active: true },
      { id: 2, url: 'https://www.justwatch.com/uk', status: 'loading' },
      { id: 3, url: 'https://www.justwatch.com/de', status: 'complete' },
      { id: 4, url: 'https://www.justwatch.com/fr', status: 'complete', active: true },
    ], {}, {});
    expect(await findJustWatchTab(h.api.tabs)).toBe(4);
    h.tabs.delete(4);
    expect(await findJustWatchTab(h.api.tabs)).toBe(3);
  });
});

describe('waitForJustWatch', () => {
  it('waits for a JustWatch tab that is still loading', async () => {
    const h = harness([{ id: 12, url: 'https://www.justwatch.com/de', status: 'loading' }], {}, {});
    const opening = waitForJustWatch(h.api.tabs, 12);
    await vi.waitFor(() => expect(h.updated.size).toBe(1));
    h.complete(99, 'https://www.justwatch.com/de');
    h.complete(12, 'https://www.justwatch.com/de');
    await opening;
    expect(h.updated.size).toBe(0);
    expect(h.removed.size).toBe(0);
  });

  it('fails when the load ends outside JustWatch', async () => {
    const h = harness([{ id: 12, url: 'https://www.justwatch.com/de', status: 'loading' }], {}, {});
    const opening = waitForJustWatch(h.api.tabs, 12);
    await vi.waitFor(() => expect(h.updated.size).toBe(1));
    h.complete(12, 'https://accounts.example.com/login');
    await expect(opening).rejects.toThrow('Something went wrong');
  });

  it('fails when the tab is closed', async () => {
    const h = harness([{ id: 12, url: 'https://www.justwatch.com/uk', status: 'loading' }], {}, {});
    const opening = waitForJustWatch(h.api.tabs, 12);
    await vi.waitFor(() => expect(h.removed.size).toBe(1));
    await h.api.tabs.remove(12);
    await expect(opening).rejects.toThrow('tab was closed');
  });

  it('times out a stalled load', async () => {
    vi.useFakeTimers();
    const h = harness([{ id: 12, url: 'https://www.justwatch.com/uk', status: 'loading' }], {}, {});
    const failed = expect(waitForJustWatch(h.api.tabs, 12)).rejects.toThrow('took too long');
    await vi.advanceTimersByTimeAsync(30_000);
    await failed;
    expect(h.updated.size).toBe(0);
  });
});

function jwt(expiresInSeconds: number) {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `eyJhbGciOiJSUzI1NiJ9.${payload}.signature`;
}

function setUser(user: Record<string, unknown>) {
  localStorage.setItem('jw/user', JSON.stringify(user));
}

describe('readPageSession', () => {
  it('waits for the page to refresh an expired token and reads the country from the Lists link', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<a data-testid="navbar-watchlist" href="https://www.justwatch.com/fr/lists/public-lists">Listes</a>';
    setUser({ jwId: 'device', jwLoginId: 'login', accessToken: jwt(-10) });
    let session: PageSession | undefined;
    void readPageSession(15_000).then((result) => { session = result; });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(session).toBeUndefined();
    const fresh = jwt(3_600);
    setUser({ jwId: 'device', jwLoginId: 'login', accessToken: fresh });
    await vi.advanceTimersByTimeAsync(250);

    expect(session).toEqual({ country: 'fr', signedIn: true, accessToken: fresh, deviceId: 'device', appLoaded: true });
  });

  it('returns immediately for a signed-out visitor instead of waiting for a token', async () => {
    document.body.innerHTML = '<a data-testid="navbar-watchlist" href="https://www.justwatch.com/ar/lists/public-lists">Listas</a>';
    setUser({ jwId: 'device', jwLoginId: null, accessToken: null });
    await expect(readPageSession(15_000)).resolves.toEqual({
      country: 'ar', signedIn: false, accessToken: undefined, deviceId: 'device', appLoaded: true,
    });
  });

  it('reports a page without the JustWatch app, such as a block page', async () => {
    document.body.innerHTML = '<h1>403 Forbidden</h1>';
    await expect(readPageSession(0)).resolves.toMatchObject({ country: undefined, appLoaded: false });
  });

  it('ignores a Lists link pointing to another site', async () => {
    document.body.innerHTML = '<a data-testid="navbar-watchlist" href="https://example.com/us/lists">Lists</a>';
    setUser({ jwLoginId: 'login', accessToken: jwt(3_600) });
    await expect(readPageSession(0)).resolves.toMatchObject({ country: undefined });
  });
});

describe('readSession', () => {
  const scripting = (session: unknown) =>
    ({ executeScript: vi.fn().mockResolvedValue([{ result: session }]) }) as unknown as typeof browser.scripting;

  it.each([
    [{ signedIn: false, appLoaded: false }, 'did not load properly'],
    [{ signedIn: true, accessToken: 'x', appLoaded: true }, 'Could not detect your JustWatch country'],
    [{ country: 'us', signedIn: false, appLoaded: true }, 'not signed in'],
    [{ country: 'us', signedIn: true, appLoaded: true }, 'Something went wrong'],
  ])('explains why the session is unusable: %o', async (session, message) => {
    await expect(readSession(scripting(session), 12, 0)).rejects.toThrow(message);
  });
});
