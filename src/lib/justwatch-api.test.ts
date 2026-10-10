import { describe, expect, it, vi } from 'vitest';
import {
  fetchTitleList,
  JustWatchAuthError,
  JustWatchUnavailableError,
  retryDelay,
  type GraphqlRequest,
  type GraphqlResponse,
  type TitleListClient,
} from './justwatch-api';

const movie = {
  id: 'tm155787',
  objectType: 'MOVIE',
  content: {
    title: 'GoodFellas',
    originalReleaseYear: 1990,
    fullPath: '/de/Film/Good-Fellas-Drei-Jahrzehnte-in-der-Mafia',
    posterUrl: '/poster/316755229/{profile}/uno-de-los-nuestros.{format}',
    externalIds: { imdbId: 'tt0099685', tmdbId: '769' },
  },
  seenlistEntry: { createdAt: '2026-08-16T22:41:55.559Z' },
};

const show = {
  id: 'ts456569',
  objectType: 'SHOW',
  content: {
    title: 'Teach You a Lesson',
    originalReleaseYear: 2026,
    fullPath: '/jp/テレビ番組/teach-you-a-lesson',
    posterUrl: null,
    externalIds: { imdbId: null, tmdbId: '' },
  },
  tvShowTrackingEntry: { createdAt: '2026-07-29T12:38:10.051Z' },
  seenState: { progress: 40 },
};

function page(nodes: unknown[], endCursor: string | null, hasNextPage: boolean, totalCount = 3): GraphqlResponse {
  return {
    status: 200,
    body: { data: { titleListV2: { totalCount, pageInfo: { endCursor, hasNextPage }, edges: nodes.map((node) => ({ node })) } } },
  };
}

function client(...responses: GraphqlResponse[]) {
  const request = vi.fn<GraphqlRequest>();
  for (const response of responses) request.mockResolvedValueOnce(response);
  const sleep = vi.fn(async (_ms: number) => undefined);
  const renewSession = vi.fn(async () => undefined);
  const onProgress = vi.fn();
  const value: TitleListClient = { request, sleep, renewSession, onProgress };
  return { value, request, sleep, renewSession, onProgress };
}

describe('fetchTitleList', () => {
  it('follows cursors with a pause between pages and maps titles regardless of URL language', async () => {
    const c = client(
      page([movie, { id: 'tse1', objectType: 'SHOW_SEASON', content: { title: 'Season 1' } }], 'Mg==', true),
      page([show], 'Mw==', false),
    );

    const list = await fetchTitleList(c.value, 'de', 'seen');

    expect(c.request.mock.calls.map(([body]) => body.variables)).toEqual([
      expect.objectContaining({ country: 'DE', listType: 'SEENLIST', after: undefined }),
      expect.objectContaining({ country: 'DE', after: 'Mg==' }),
    ]);
    expect(c.sleep.mock.calls).toEqual([[400]]);
    expect(c.onProgress.mock.calls).toEqual([[2, 3], [3, 3]]);
    expect(list).toEqual({
      total: 3,
      skipped: 1,
      titles: [
        {
          id: 'tm155787',
          type: 'movie',
          title: 'GoodFellas',
          year: 1990,
          imdbId: 'tt0099685',
          tmdbId: '769',
          url: 'https://www.justwatch.com/de/Film/Good-Fellas-Drei-Jahrzehnte-in-der-Mafia',
          posterUrl: 'https://images.justwatch.com/poster/316755229/s166/uno-de-los-nuestros.jpg',
          addedAt: '2026-08-16T22:41:55.559Z',
          showProgress: undefined,
        },
        {
          id: 'ts456569',
          type: 'show',
          title: 'Teach You a Lesson',
          year: 2026,
          imdbId: undefined,
          tmdbId: undefined,
          url: 'https://www.justwatch.com/jp/%E3%83%86%E3%83%AC%E3%83%93%E7%95%AA%E7%B5%84/teach-you-a-lesson',
          posterUrl: undefined,
          addedAt: '2026-07-29T12:38:10.051Z',
          showProgress: 40,
        },
      ],
    });
  });

  it('requests the watchlist and dates titles by when they were added to it', async () => {
    const c = client(page([{ ...movie, watchlistEntryV2: { createdAt: '2025-06-28T03:12:47.931Z' } }], null, false, 1));

    const list = await fetchTitleList(c.value, 'us', 'watchlist');

    expect(c.request.mock.calls[0][0].variables).toEqual(expect.objectContaining({ listType: 'WATCHLIST' }));
    expect(list.titles[0].addedAt).toBe('2025-06-28T03:12:47.931Z');
  });

  it('drops a title repeated on the next page when the list shifts mid-load', async () => {
    const c = client(page([movie], 'MQ==', true, 2), page([movie, show], null, false, 2));
    const list = await fetchTitleList(c.value, 'us', 'seen');
    expect(list.titles.map((title) => title.id)).toEqual(['tm155787', 'ts456569']);
  });

  it('stops on a missing or repeated cursor instead of looping', async () => {
    const missing = client(page([movie], null, true, 1));
    await fetchTitleList(missing.value, 'us', 'seen');
    expect(missing.request).toHaveBeenCalledTimes(1);

    const repeated = client(page([movie], 'MQ==', true, 50), page([show], 'MQ==', true, 50));
    await fetchTitleList(repeated.value, 'us', 'seen');
    expect(repeated.request).toHaveBeenCalledTimes(2);
  });

  it('never requests far more pages than the reported total implies', async () => {
    let calls = 0;
    const request = vi.fn<GraphqlRequest>(async (body) => {
      calls += 1;
      return page([{ ...movie, id: `tm${String(body.variables.after)}` }], `c${calls}`, true, 20);
    });
    const sleep = vi.fn(async () => undefined);
    await fetchTitleList({ request, sleep, renewSession: vi.fn() }, 'us', 'seen');
    expect(request).toHaveBeenCalledTimes(6);
  });

  it('backs off and retries rate limits, server errors, and timeouts', async () => {
    const c = client({ status: 429, body: null }, { status: 0, body: null }, { status: 503, body: null }, page([movie], null, false, 1));
    await expect(fetchTitleList(c.value, 'us', 'seen')).resolves.toMatchObject({ titles: [{ id: 'tm155787' }] });
    expect(c.sleep.mock.calls).toEqual([[2_000], [4_000], [8_000]]);
  });

  it('gives up after repeated failures with a friendly error', async () => {
    const c = client(...Array.from({ length: 4 }, () => ({ status: 502, body: null })));
    await expect(fetchTitleList(c.value, 'us', 'seen')).rejects.toBeInstanceOf(JustWatchUnavailableError);
    expect(c.request).toHaveBeenCalledTimes(4);
  });

  it('treats a GraphQL rate-limit error as retryable', async () => {
    const c = client(
      { status: 200, body: { data: null, errors: [{ message: 'Too Many Requests', extensions: { code: 'RATE_LIMITED' } }] } },
      page([movie], null, false, 1),
    );
    await expect(fetchTitleList(c.value, 'us', 'seen')).resolves.toMatchObject({ total: 1 });
    expect(c.request).toHaveBeenCalledTimes(2);
  });

  it('renews the session once when JustWatch rejects it, then retries the same page', async () => {
    const c = client(page([movie], 'MQ==', true, 2), { status: 401, body: null }, page([show], null, false, 2));
    await expect(fetchTitleList(c.value, 'us', 'seen')).resolves.toMatchObject({ total: 2 });
    expect(c.renewSession).toHaveBeenCalledTimes(1);
    expect(c.request.mock.calls[2][0].variables.after).toBe('MQ==');
  });

  it('fails when the renewed session is rejected too', async () => {
    const auth = { status: 200, body: { data: null, errors: [{ message: 'no auth', extensions: { code: 'AUTHORIZATION_REQUIRED' } }] } };
    const c = client(auth, auth);
    await expect(fetchTitleList(c.value, 'us', 'seen')).rejects.toBeInstanceOf(JustWatchAuthError);
    expect(c.renewSession).toHaveBeenCalledTimes(1);
  });

  it('fails without retrying on other GraphQL errors, keeping the detail as the cause', async () => {
    const c = client({ status: 200, body: { data: null, errors: [{ message: 'Cannot query field', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }] } });
    const error = await fetchTitleList(c.value, 'us', 'seen').catch((caught: Error) => caught);
    expect(error).toMatchObject({ message: 'Something went wrong. Please try again.', cause: 'Cannot query field' });
    expect(c.request).toHaveBeenCalledTimes(1);
  });
});

describe('retryDelay', () => {
  it('honours Retry-After when longer than the backoff, but never waits over a minute', () => {
    expect(retryDelay(1, '10')).toBe(10_000);
    expect(retryDelay(2, '1')).toBe(4_000);
    expect(retryDelay(1, '3600')).toBe(60_000);
    expect(retryDelay(1, 'garbage')).toBe(2_000);
  });
});
