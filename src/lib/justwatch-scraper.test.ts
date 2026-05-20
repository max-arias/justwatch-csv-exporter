import { describe, expect, it, vi } from 'vitest';
import { buildLetterboxdCsv, buildTraktCsv, countLetterboxdRows, countTraktRows } from './csv';
import {
  buildScanSummary,
  enrichItemsWithExternalIds,
  extractExternalIds,
  parseJustWatchListHtml,
} from './justwatch-scraper';

const fixture = `
  <div class="title-card">
    <div class="title-card-basic">
      <a href="/ar/pelicula/the-anaconda">
        <picture><img alt="Anaconda" src="https://images.justwatch.com/poster/335935477/s166/the-anaconda.jpg"></picture>
      </a>
      <a href="/ar/pelicula/the-anaconda" class="title-card-heading-wrapper">
        <h2 class="title-card-heading"> Anaconda <span class="title-card-heading__info"> (2025) </span></h2>
      </a>
    </div>
  </div>
  <div class="title-card">
    <div class="title-card-basic">
      <a href="/ar/serie/the-expanse">
        <picture><img alt="The Expanse" src="https://images.justwatch.com/poster/123/s166/the-expanse.jpg"></picture>
      </a>
      <a href="/ar/serie/the-expanse" class="title-card-heading-wrapper">
        <h2 class="title-card-heading"> The Expanse <span class="title-card-heading__info"> (2015) </span></h2>
      </a>
    </div>
  </div>
`;

const detailedCardFixture = `
  <div class="title-card">
    <a href="/ar/pelicula/the-anaconda">
      <picture><img alt="Anaconda" src="https://images.justwatch.com/poster/335935477/s166/the-anaconda.jpg"></picture>
    </a>
    <div class="title-card-basic__info">
      <div class="title-card-basic__header">
        <a href="/ar/pelicula/the-anaconda" class="title-card-heading-wrapper">
          <h2 class="title-card-heading"> Anaconda <span class="title-card-heading__info"> (2025) </span></h2>
        </a>
        <button class="mark-as-seen-button is-marked"></button>
      </div>
      <div class="title-card-basic__description">
        <p>A group of friends are going through a mid-life crisis.</p>
      </div>
      <div class="jw-scoring-listing">
        <div class="jw-scoring-listing__rating--group jw-scoring-listing__rating--no-link">
          <img alt="IMDB" src="/appassets/img/imdb-logo.png">
          <div class="nowrap">5.6 </div>
        </div>
      </div>
      <span class="watch-now-button-contents">
        <img alt="HBO Max" title="HBO Max" src="https://images.justwatch.com/icon/332884837/s40/max.jpeg">
        Watch Again
      </span>
    </div>
  </div>
`;

describe('JustWatch parsing', () => {
  it('parses rendered list cards', () => {
    const items = parseJustWatchListHtml(fixture, 'https://www.justwatch.com/ar/list/test');

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: 'Anaconda',
      year: '2025',
      type: 'movie',
      href: '/ar/pelicula/the-anaconda',
      posterId: '335935477',
      posterUrl: 'https://images.justwatch.com/poster/335935477/s166/the-anaconda.jpg',
    });
    expect(items[1]).toMatchObject({
      title: 'The Expanse',
      year: '2015',
      type: 'show',
    });
  });

  it('parses extra data from the detailed Seen list layout', () => {
    const [item] = parseJustWatchListHtml(detailedCardFixture, 'https://www.justwatch.com/ar/lists/my-lists');

    expect(item).toMatchObject({
      title: 'Anaconda',
      year: '2025',
      type: 'movie',
      href: '/ar/pelicula/the-anaconda',
      posterId: '335935477',
      description: 'A group of friends are going through a mid-life crisis.',
      imdbRating: '5.6',
      watchProvider: 'HBO Max',
      seen: true,
    });
  });

  it('extracts external IDs from detail markup', () => {
    expect(extractExternalIds('{"imdbId":"tt12345678","tmdb_id":123,"tvdbId":456}')).toEqual([
      { kind: 'imdb_id', value: 'tt12345678' },
      { kind: 'tmdb_id', value: '123' },
      { kind: 'tvdb_id', value: '456' },
    ]);
  });

  it('builds CSVs for supported import targets', () => {
    const [movie, show] = parseJustWatchListHtml(fixture);
    const items = [
      { ...movie, externalIds: [{ kind: 'imdb_id' as const, value: 'tt0012345' }] },
      { ...show, externalIds: [] },
    ];

    expect(buildLetterboxdCsv(items)).toContain('Anaconda,2025');
    expect(buildLetterboxdCsv(items)).not.toContain('The Expanse');
    expect(buildTraktCsv(items)).toBe(
      'title,year,type,action\r\nAnaconda,2025,movie,watched\r\nThe Expanse,2015,show,watched\r\n',
    );
    expect(buildScanSummary(items)).toEqual({
      scanned: 2,
      letterboxdRows: 1,
      traktRows: 2,
      unresolvedRows: 1,
    });
  });

  it('filters exports by movies and series', () => {
    const items = parseJustWatchListHtml(fixture);

    expect(buildLetterboxdCsv(items, { movies: false, series: true })).toBe('Title,Year\r\n');
    expect(buildTraktCsv(items, { movies: true, series: false })).toBe(
      'title,year,type,action\r\nAnaconda,2025,movie,watched\r\n',
    );
    expect(buildTraktCsv(items, { movies: false, series: true })).toBe(
      'title,year,type,action\r\nThe Expanse,2015,show,watched\r\n',
    );
    expect(countLetterboxdRows(items, { movies: true, series: true })).toBe(1);
    expect(countTraktRows(items, { movies: true, series: true })).toBe(2);
  });

  it('throttles detail page fetches so JustWatch is not overloaded', async () => {
    const items = parseJustWatchListHtml(fixture, 'https://www.justwatch.com/ar/list/test');
    const delay = vi.fn().mockResolvedValue(undefined);
    const fetchHtml = vi.fn().mockResolvedValue('{"imdbId":"tt12345678"}');

    const enriched = await enrichItemsWithExternalIds(
      items,
      'https://www.justwatch.com/ar/list/test',
      fetchHtml,
      { delayBetweenRequestsMs: 1500, delay },
    );

    expect(fetchHtml).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
    expect(delay).toHaveBeenCalledWith(1500);
    expect(enriched.every((item) => item.externalIds.length === 1)).toBe(true);
  });

  it('stops fetching detail pages after a rate-limit response', async () => {
    const items = parseJustWatchListHtml(fixture, 'https://www.justwatch.com/ar/list/test');
    const fetchHtml = vi.fn().mockRejectedValue(new Error('Failed to fetch https://example.test: 429'));

    const enriched = await enrichItemsWithExternalIds(
      items,
      'https://www.justwatch.com/ar/list/test',
      fetchHtml,
      { delayBetweenRequestsMs: 0 },
    );

    expect(fetchHtml).toHaveBeenCalledTimes(1);
    expect(enriched).toHaveLength(2);
    expect(enriched[0].unresolvedReason).toContain('rate limited');
    expect(enriched[1].unresolvedReason).toContain('Skipped detail fetch because JustWatch rate limited');
  });

  it('caps detail page fetches per scan', async () => {
    const items = parseJustWatchListHtml(fixture, 'https://www.justwatch.com/ar/list/test');
    const fetchHtml = vi.fn().mockResolvedValue('{"imdbId":"tt12345678"}');

    const enriched = await enrichItemsWithExternalIds(
      items,
      'https://www.justwatch.com/ar/list/test',
      fetchHtml,
      { delayBetweenRequestsMs: 0, maxDetailRequests: 1 },
    );

    expect(fetchHtml).toHaveBeenCalledTimes(1);
    expect(enriched[0].externalIds).toEqual([{ kind: 'imdb_id', value: 'tt12345678' }]);
    expect(enriched[1].unresolvedReason).toContain('safe request limit');
  });
});
