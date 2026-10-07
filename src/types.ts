export type TitleType = 'movie' | 'show';

export interface SeenTitle {
  /** JustWatch node ID, e.g. `tm155787` or `ts456569`. */
  id: string;
  type: TitleType;
  title: string;
  year?: number;
  imdbId?: string;
  tmdbId?: string;
  url: string;
  posterUrl?: string;
  /** When the title was marked in JustWatch (ISO 8601). */
  seenAt?: string;
  /** Episode progress for shows, 0–100. */
  showProgress?: number;
}

export interface SeenList {
  titles: SeenTitle[];
  /** Total entries JustWatch reports for the Seen list. */
  total: number;
  /** Entries that are neither a movie nor a show, or lack content. */
  skipped: number;
}
