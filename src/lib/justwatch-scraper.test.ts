import { describe, expect, it } from 'vitest';
import { buildLetterboxdCsv, buildTraktCsv, buildUnresolvedCsv } from './csv';
import {
  buildScanSummary,
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
    });
    expect(items[1]).toMatchObject({
      title: 'The Expanse',
      year: '2015',
      type: 'show',
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
    expect(buildTraktCsv(items)).toBe('imdb_id,tmdb_id,tvdb_id,type\r\ntt0012345,,,movie\r\n');
    expect(buildUnresolvedCsv(items)).toContain('The Expanse,2015,show');
    expect(buildScanSummary(items)).toEqual({
      scanned: 2,
      letterboxdRows: 1,
      traktRows: 1,
      unresolvedRows: 1,
    });
  });
});
