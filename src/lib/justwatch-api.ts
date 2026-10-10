import type { ListKind, ListTitle, TitleList } from '../types';

export const GRAPHQL_URL = 'https://apis.justwatch.com/graphql';
/** Same page size the JustWatch site uses. */
const PAGE_SIZE = 20;
/** Pause between pages so a large list never floods JustWatch. */
const PAGE_DELAY_MS = 400;
/** Attempts per page for transient failures (network, timeout, 429, 5xx). */
const MAX_ATTEMPTS = 4;
const BACKOFF_BASE_MS = 2_000;
const MAX_RETRY_DELAY_MS = 60_000;
/** Pages allowed beyond what `totalCount` implies, for entries added mid-load. */
const EXTRA_PAGES = 5;
/** Absolute page ceiling (20,000 titles) in case JustWatch reports nonsense. */
const MAX_PAGES = 1_000;
const POSTER_PROFILE = 's166';
const POSTER_FORMAT = 'jpg';
const GENERIC_ERROR = 'Something went wrong. Please try again.';

export const TITLE_LIST_QUERY = `query GetTitleList($country: Country!, $language: Language!, $listType: TitleListTypeV2!, $after: String, $first: Int!) {
  titleListV2(country: $country, titleListType: $listType, sortBy: LAST_ADDED, first: $first, after: $after, filter: {includeTitlesWithoutUrl: true}) {
    totalCount
    pageInfo { endCursor hasNextPage }
    edges {
      node {
        id
        objectType
        content(country: $country, language: $language) {
          title
          originalReleaseYear
          fullPath
          posterUrl
          externalIds { imdbId tmdbId }
        }
        watchlistEntryV2 { createdAt }
        ... on Movie { seenlistEntry { createdAt } }
        ... on Show {
          tvShowTrackingEntry { createdAt }
          seenState(country: $country) { progress }
        }
      }
    }
  }
}`;

const LIST_TYPES: Record<ListKind, string> = { seen: 'SEENLIST', watchlist: 'WATCHLIST' };

export interface GraphqlRequestBody {
  query: string;
  variables: Record<string, unknown>;
}

export interface GraphqlResponse {
  /** HTTP status, or 0 when the request failed or timed out before a response. */
  status: number;
  body: unknown;
  /** Value of the `Retry-After` response header, if any. */
  retryAfter?: string | null;
}

/** Sends one GraphQL request with the user's JustWatch session. */
export type GraphqlRequest = (body: GraphqlRequestBody) => Promise<GraphqlResponse>;

export interface TitleListClient {
  request: GraphqlRequest;
  /** Obtains a fresh session after JustWatch rejects the current one. */
  renewSession: () => Promise<void>;
  onProgress?: (loaded: number, total: number) => void;
  sleep?: (ms: number) => Promise<void>;
}

/** JustWatch rejected the session, even after renewing it once. */
export class JustWatchAuthError extends Error {
  constructor() {
    super(GENERIC_ERROR);
    this.name = 'JustWatchAuthError';
  }
}

/** JustWatch kept failing or rate limiting after all retries. */
export class JustWatchUnavailableError extends Error {
  constructor() {
    super('JustWatch is not responding right now. Please try again in a few minutes.');
    this.name = 'JustWatchUnavailableError';
  }
}

interface TitleListNode {
  id: string;
  objectType: string;
  content?: {
    title?: string | null;
    originalReleaseYear?: number | null;
    fullPath?: string | null;
    posterUrl?: string | null;
    externalIds?: { imdbId?: string | null; tmdbId?: string | null } | null;
  } | null;
  watchlistEntryV2?: { createdAt?: string | null } | null;
  seenlistEntry?: { createdAt?: string | null } | null;
  tvShowTrackingEntry?: { createdAt?: string | null } | null;
  seenState?: { progress?: number | null } | null;
}

interface TitleListPage {
  totalCount: number;
  pageInfo: { endCursor?: string | null; hasNextPage: boolean };
  edges: Array<{ node: TitleListNode }>;
}

interface GraphqlBody {
  data?: { titleListV2?: TitleListPage | null } | null;
  errors?: Array<{ message?: string; extensions?: { code?: string } }>;
}

type PageOutcome =
  | { kind: 'page'; page: TitleListPage }
  | { kind: 'auth' }
  | { kind: 'retry' }
  | { kind: 'fail'; detail: string };

const AUTH_ERROR_CODES: Record<string, true> = { AUTHORIZATION_REQUIRED: true, UNAUTHENTICATED: true, FORBIDDEN: true };

export async function fetchTitleList(client: TitleListClient, country: string, kind: ListKind): Promise<TitleList> {
  const sleep = client.sleep ?? defaultSleep;
  const titles = new Map<string, ListTitle>();
  const visitedCursors = new Set<string>();
  let skipped = 0;
  let total = 0;
  let pages = 0;
  let maxPages = MAX_PAGES;
  let after: string | undefined;

  do {
    if (pages > 0) await sleep(PAGE_DELAY_MS);
    const page = await fetchPage(client, sleep, country, kind, after);
    pages += 1;
    total = page.totalCount;
    maxPages = Math.min(MAX_PAGES, Math.ceil(total / PAGE_SIZE) + EXTRA_PAGES);

    for (const { node } of page.edges) {
      const title = toListTitle(node, kind);
      if (!title) skipped += 1;
      // Offset cursors shift if the list changes mid-load; keep the first copy.
      else if (!titles.has(title.id)) titles.set(title.id, title);
    }
    client.onProgress?.(titles.size + skipped, total);

    const next = page.pageInfo.hasNextPage && page.edges.length > 0 ? page.pageInfo.endCursor : undefined;
    after = next && !visitedCursors.has(next) ? next : undefined;
    if (after) visitedCursors.add(after);
  } while (after && pages < maxPages);

  return { titles: [...titles.values()], total, skipped };
}

async function fetchPage(
  client: TitleListClient,
  sleep: (ms: number) => Promise<void>,
  country: string,
  kind: ListKind,
  after: string | undefined,
): Promise<TitleListPage> {
  const body = {
    query: TITLE_LIST_QUERY,
    variables: { country: country.toUpperCase(), language: 'en', listType: LIST_TYPES[kind], first: PAGE_SIZE, after },
  };
  let renewed = false;

  for (let attempt = 1; ; attempt += 1) {
    const response = await client.request(body);
    const outcome = classifyResponse(response);
    if (outcome.kind === 'page') return outcome.page;
    if (outcome.kind === 'fail') throw new Error(GENERIC_ERROR, { cause: outcome.detail });
    if (outcome.kind === 'auth') {
      if (renewed) throw new JustWatchAuthError();
      renewed = true;
      await client.renewSession();
      continue;
    }
    if (attempt >= MAX_ATTEMPTS) throw new JustWatchUnavailableError();
    await sleep(retryDelay(attempt, response.retryAfter));
  }
}

export function classifyResponse({ status, body }: GraphqlResponse): PageOutcome {
  if (status === 401 || status === 403) return { kind: 'auth' };
  if (status === 0 || status === 408 || status === 429 || status >= 500) return { kind: 'retry' };

  const response = body as GraphqlBody | null;
  const errors = response?.errors ?? [];
  if (errors.some((error) => AUTH_ERROR_CODES[error.extensions?.code ?? ''])) return { kind: 'auth' };
  if (errors.some((error) => /rate.?limit|too many requests/i.test(`${error.extensions?.code} ${error.message}`))) {
    return { kind: 'retry' };
  }

  const page = response?.data?.titleListV2;
  if (status === 200 && page && Array.isArray(page.edges)) return { kind: 'page', page };
  return { kind: 'fail', detail: errors[0]?.message ?? `HTTP ${status}` };
}

/** Exponential backoff (2s, 4s, 8s…), or the server's `Retry-After`, capped at a minute. */
export function retryDelay(attempt: number, retryAfter: string | null | undefined): number {
  const backoff = BACKOFF_BASE_MS * 2 ** (attempt - 1);
  if (!retryAfter) return Math.min(backoff, MAX_RETRY_DELAY_MS);
  const seconds = Number(retryAfter);
  const requested = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
  return Number.isFinite(requested) ? Math.min(Math.max(requested, backoff), MAX_RETRY_DELAY_MS) : backoff;
}

function toListTitle(node: TitleListNode, kind: ListKind): ListTitle | undefined {
  const type = node.objectType === 'MOVIE' ? 'movie' : node.objectType === 'SHOW' ? 'show' : undefined;
  const content = node.content;
  if (!type || !content?.title || !node.id) return undefined;

  return {
    id: node.id,
    type,
    title: content.title,
    year: content.originalReleaseYear ?? undefined,
    imdbId: content.externalIds?.imdbId || undefined,
    tmdbId: content.externalIds?.tmdbId || undefined,
    url: new URL(content.fullPath ?? '/', 'https://www.justwatch.com').toString(),
    posterUrl: posterUrl(content.posterUrl),
    addedAt: (kind === 'watchlist'
      ? node.watchlistEntryV2?.createdAt
      : type === 'movie' ? node.seenlistEntry?.createdAt : node.tvShowTrackingEntry?.createdAt) ?? undefined,
    showProgress: type === 'show' ? node.seenState?.progress ?? undefined : undefined,
  };
}

function posterUrl(template: string | null | undefined): string | undefined {
  if (!template) return undefined;
  const path = template.replace('{profile}', POSTER_PROFILE).replace('{format}', POSTER_FORMAT);
  return new URL(path, 'https://images.justwatch.com').toString();
}

function defaultSleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}
