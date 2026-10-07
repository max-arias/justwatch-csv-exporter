import type { browser, Browser } from 'wxt/browser';
import type { SeenList } from '../types';
import { fetchSeenList, GRAPHQL_URL, type GraphqlRequestBody, type GraphqlResponse } from './justwatch-api';
import { isJustWatchUrl, JUSTWATCH_HOME, JUSTWATCH_ORIGIN } from './justwatch-url';

const LOAD_TIMEOUT_MS = 30_000;
/** How long a page we opened may take to provide a session. */
const OWN_TAB_SESSION_TIMEOUT_MS = 15_000;
/** A user's existing tab gets less time; we fall back to opening our own. */
const EXISTING_TAB_SESSION_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 20_000;
/** Extra time for script injection on top of the in-page timeout. */
const INJECTION_GRACE_MS = 10_000;
const GENERIC_ERROR = 'Something went wrong. Please try again.';

type BrowserApi = Pick<typeof browser, 'tabs' | 'scripting'>;
type TabsApi = typeof browser.tabs;
type ScriptingApi = typeof browser.scripting;

export interface PageSession {
  country?: string;
  signedIn: boolean;
  accessToken?: string;
  deviceId?: string;
  /** Whether the JustWatch app has stored its user state, i.e. the page really is JustWatch. */
  appLoaded: boolean;
}

export interface JustWatchSession {
  country: string;
  accessToken: string;
  deviceId?: string;
}

export class SignedOutError extends Error {
  constructor() {
    super('You are not signed in to JustWatch. Sign in on this page, then press Reload.');
    this.name = 'SignedOutError';
  }
}

/** Signed in, but the page has no unexpired access token. */
class StaleSessionError extends Error {
  constructor() {
    super(GENERIC_ERROR);
    this.name = 'StaleSessionError';
  }
}

/**
 * Loads the signed-in user's Seen list through JustWatch's own API, using the
 * session of a JustWatch page. An open JustWatch tab is reused; otherwise a
 * background tab is opened and closed again afterwards. The user's current tab
 * is never navigated.
 */
export async function loadSeenList(
  api: BrowserApi,
  onProgress?: (loaded: number, total: number) => void,
): Promise<SeenList> {
  const source = new TabSessionSource(api);
  try {
    await source.start();
    return await fetchSeenList(
      { request: (body) => source.request(body), renewSession: () => source.renew(), onProgress },
      source.country,
    );
  } finally {
    await source.dispose();
  }
}

class TabSessionSource {
  #ownTabId: number | undefined;
  #tabId = -1;
  #session: JustWatchSession | undefined;

  constructor(private readonly api: BrowserApi) {}

  get country(): string {
    return this.#requireSession().country;
  }

  async start(): Promise<void> {
    const existing = await findJustWatchTab(this.api.tabs);
    if (existing !== undefined) {
      try {
        // No wait for the tab's full load (ads can delay it): the session read
        // below runs once the document is ready and waits for the app's state.
        await this.#use(existing, EXISTING_TAB_SESSION_TIMEOUT_MS);
        return;
      } catch (error) {
        if (error instanceof SignedOutError) throw error;
        // The user's tab was unusable (stale token, navigated away, …): use our own.
      }
    }
    await this.#use(await this.#openOwnTab(), OWN_TAB_SESSION_TIMEOUT_MS);
  }

  /** After JustWatch rejects the token: a freshly loaded page refreshes an expired one. */
  async renew(): Promise<void> {
    await this.#use(await this.#openOwnTab(), OWN_TAB_SESSION_TIMEOUT_MS);
  }

  request(body: GraphqlRequestBody): Promise<GraphqlResponse> {
    return postFromTab(this.api.scripting, this.#tabId, this.#requireSession(), body);
  }

  async dispose(): Promise<void> {
    if (this.#ownTabId !== undefined) await closeIfUnused(this.api.tabs, this.#ownTabId);
  }

  async #use(tabId: number, timeoutMs: number): Promise<void> {
    this.#session = await readSession(this.api.scripting, tabId, timeoutMs);
    this.#tabId = tabId;
  }

  /** Opens a new background JustWatch tab, replacing one we opened earlier. */
  async #openOwnTab(): Promise<number> {
    if (this.#ownTabId !== undefined) await this.api.tabs.remove(this.#ownTabId).catch(() => undefined);
    this.#ownTabId = undefined;
    const tab = await this.api.tabs.create({ url: JUSTWATCH_HOME, active: false });
    if (tab.id === undefined) throw new Error(GENERIC_ERROR);
    this.#ownTabId = tab.id;
    await waitForJustWatch(this.api.tabs, tab.id);
    return tab.id;
  }

  #requireSession(): JustWatchSession {
    if (!this.#session) throw new Error(GENERIC_ERROR);
    return this.#session;
  }
}

/** Prefers the active, loaded JustWatch tab; skips discarded tabs, which cannot run scripts. */
export async function findJustWatchTab(tabs: TabsApi): Promise<number | undefined> {
  const candidates = (await tabs.query({ url: `${JUSTWATCH_ORIGIN}/*` }))
    .filter((tab) => tab.id !== undefined && !tab.discarded);
  const tab = candidates.find((candidate) => candidate.active && candidate.status === 'complete')
    ?? candidates.find((candidate) => candidate.status === 'complete')
    ?? candidates[0];
  return tab?.id;
}

async function closeIfUnused(tabs: TabsApi, tabId: number): Promise<void> {
  try {
    // Leave it open if the user switched to it in the meantime.
    if (!(await tabs.get(tabId)).active) await tabs.remove(tabId);
  } catch {
    // Already closed.
  }
}

export async function readSession(scripting: ScriptingApi, tabId: number, timeoutMs: number): Promise<JustWatchSession> {
  const session = await runInPage(scripting, tabId, readPageSession, [timeoutMs], timeoutMs + INJECTION_GRACE_MS);
  if (!session) throw new Error(GENERIC_ERROR);
  if (!session.country && !session.appLoaded) {
    throw new Error('JustWatch did not load properly. Open justwatch.com, check that it loads, then try again.');
  }
  if (!session.country) throw new Error('Could not detect your JustWatch country. Reload JustWatch and try again.');
  if (!session.signedIn) throw new SignedOutError();
  if (!session.accessToken) throw new StaleSessionError();
  return { country: session.country, accessToken: session.accessToken, deviceId: session.deviceId };
}

/**
 * Runs inside the JustWatch page. Must be self-contained: it is serialized by
 * `scripting.executeScript`. Waits until the page knows its country and has an
 * unexpired access token (the page refreshes it while loading).
 */
export async function readPageSession(timeoutMs: number): Promise<PageSession> {
  const countryOf = (href: string | null | undefined) => {
    if (!href) return undefined;
    try {
      const url = new URL(href, location.href);
      if (url.origin !== 'https://www.justwatch.com') return undefined;
      return url.pathname.match(/^\/([a-z]{2}(?:-[a-z]{2})?)(?:\/|$)/)?.[1];
    } catch {
      return undefined;
    }
  };
  const expiresAt = (token: string) => {
    try {
      const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const exp = JSON.parse(atob(payload)).exp;
      return typeof exp === 'number' ? exp * 1000 : undefined;
    } catch {
      return undefined;
    }
  };
  const read = (): PageSession => {
    let user: { accessToken?: unknown; jwId?: unknown; jwLoginId?: unknown } | null = null;
    try {
      user = JSON.parse(localStorage.getItem('jw/user') ?? 'null');
    } catch {
      user = null;
    }
    const token = typeof user?.accessToken === 'string' ? user.accessToken : undefined;
    const expiry = token ? expiresAt(token) : undefined;
    // Same 30 s margin the page's auth library uses before refreshing a token itself.
    const usable = token !== undefined && (expiry === undefined || expiry > Date.now() + 30_000);
    return {
      country: countryOf(location.href)
        ?? countryOf(document.querySelector('a[data-testid="navbar-watchlist"]')?.getAttribute('href')),
      signedIn: Boolean(user?.jwLoginId),
      accessToken: usable ? token : undefined,
      deviceId: typeof user?.jwId === 'string' ? user.jwId : undefined,
      appLoaded: user !== null,
    };
  };

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const session = read();
    const settled = session.accessToken !== undefined || (session.appLoaded && !session.signedIn);
    if ((session.country && settled) || Date.now() >= deadline) return session;
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 250);
    await promise;
  }
}

/** Sends a GraphQL request from the JustWatch page so JustWatch's CORS policy applies as it does for the site. */
async function postFromTab(
  scripting: ScriptingApi,
  tabId: number,
  session: JustWatchSession,
  body: GraphqlRequestBody,
): Promise<GraphqlResponse> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${session.accessToken}`,
  };
  if (session.deviceId) headers['device-id'] = session.deviceId;
  const response = await runInPage(
    scripting,
    tabId,
    postFromPage,
    [GRAPHQL_URL, JSON.stringify(body), headers, REQUEST_TIMEOUT_MS],
    REQUEST_TIMEOUT_MS + INJECTION_GRACE_MS,
  );
  if (!response) throw new Error(GENERIC_ERROR);
  return response;
}

/** Runs inside the JustWatch page; must be self-contained. Network failures and timeouts return status 0. */
export async function postFromPage(
  url: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<GraphqlResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    const json = await response.json().catch(() => null);
    return { status: response.status, body: json, retryAfter: response.headers.get('retry-after') };
  } catch {
    return { status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs `func` in the page's main world. Injection failures (tab closed,
 * navigated away, crashed) and hangs become a friendly error.
 */
async function runInPage<Args extends unknown[], Result>(
  scripting: ScriptingApi,
  tabId: number,
  func: (...args: Args) => Promise<Result>,
  args: Args,
  timeoutMs: number,
): Promise<Result | undefined> {
  const { promise: timedOut, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(() => reject(new Error('Script injection timed out')), timeoutMs);
  try {
    const [injection] = await Promise.race([
      scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args }),
      timedOut,
    ]);
    return injection?.result as Result | undefined;
  } catch (error) {
    throw new Error(GENERIC_ERROR, { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves once the tab finishes loading a JustWatch page. */
export function waitForJustWatch(tabs: TabsApi, tabId: number): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const finish = (error?: Error) => {
    clearTimeout(timer);
    tabs.onUpdated.removeListener(onUpdated);
    tabs.onRemoved.removeListener(onRemoved);
    if (error) reject(error);
    else resolve();
  };
  const onUpdated = (updatedTabId: number, change: { status?: string }, tab: Browser.tabs.Tab) => {
    if (updatedTabId !== tabId || change.status !== 'complete') return;
    if (isJustWatchUrl(tab.url)) finish();
    else finish(new Error(GENERIC_ERROR));
  };
  const onRemoved = (removedTabId: number) => {
    if (removedTabId === tabId) finish(new Error('The JustWatch tab was closed. Please try again.'));
  };
  const timer = setTimeout(
    () => finish(new Error('JustWatch took too long to load. Check your connection and try again.')),
    LOAD_TIMEOUT_MS,
  );
  tabs.onUpdated.addListener(onUpdated);
  tabs.onRemoved.addListener(onRemoved);

  // The tab may have finished loading before the listener was attached. A
  // non-JustWatch "complete" state (e.g. about:blank right after creation) is ignored.
  void tabs.get(tabId).then(
    (tab) => {
      if (tab.status === 'complete' && isJustWatchUrl(tab.url)) finish();
    },
    () => finish(new Error('The JustWatch tab was closed. Please try again.')),
  );
  return promise;
}
