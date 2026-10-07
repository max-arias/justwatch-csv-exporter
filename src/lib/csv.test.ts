import { describe, expect, it } from 'vitest';
import { buildLetterboxdCsv, buildTraktCsv } from './csv';
import type { SeenTitle } from '../types';

const base = { url: 'https://www.justwatch.com/us/movie/x' };
const titles: SeenTitle[] = [
  { ...base, id: 'tm1', type: 'movie', title: 'Good Luck, Have Fun, Don\'t Die', year: 2026, imdbId: 'tt1', tmdbId: '11', seenAt: '2026-08-16T22:58:20.841Z' },
  { ...base, id: 'tm2', type: 'movie', title: 'Untracked "Short"', tmdbId: '22' },
  { ...base, id: 'tm5', type: 'movie', title: '=HYPERLINK("x")', year: 2001, imdbId: 'tt5' },
  { ...base, id: 'ts3', type: 'show', title: 'The Expanse', year: 2015, imdbId: 'tt3', seenAt: '2026-07-29T12:38:10.051Z' },
  { ...base, id: 'ts4', type: 'show', title: 'No IDs', year: 2020 },
];

describe('CSV exports', () => {
  it('exports only movies to Letterboxd, with IDs, escaped titles, and formulas neutralised', () => {
    expect(buildLetterboxdCsv(titles)).toBe(
      'Title,Year,imdbID,tmdbID\r\n'
      + '"Good Luck, Have Fun, Don\'t Die",2026,tt1,11\r\n'
      + '"Untracked ""Short""",,,22\r\n'
      + '"\'=HYPERLINK(""x"")",2001,tt5,\r\n',
    );
  });

  it('exports movies and shows to Trakt by ID, with an unknown date when JustWatch has none', () => {
    expect(buildTraktCsv(titles)).toBe(
      'imdb_id,tmdb_id,type,watched_at\r\n'
      + 'tt1,11,movie,2026-08-16T22:58:20.841Z\r\n'
      + ',22,movie,unknown\r\n'
      + 'tt5,,movie,unknown\r\n'
      + 'tt3,,show,2026-07-29T12:38:10.051Z\r\n',
    );
  });
});
