export type TitleType = 'movie' | 'show';

export type ListKind = 'seen' | 'watchlist';

export interface ListTitle {
  /** JustWatch node ID, e.g. `tm155787` or `ts456569`. */
  id: string;
  type: TitleType;
  title: string;
  year?: number;
  imdbId?: string;
  tmdbId?: string;
  url: string;
  posterUrl?: string;
  /** When the title was added to the list in JustWatch (ISO 8601): marked seen / series tracking started / added to watchlist. */
  addedAt?: string;
  /** Episode progress for shows, 0–100. */
  showProgress?: number;
}

export interface TitleList {
  titles: ListTitle[];
  /** Total entries JustWatch reports for the list. */
  total: number;
  /** Entries that are neither a movie nor a show, or lack content. */
  skipped: number;
}
