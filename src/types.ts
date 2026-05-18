export type JustWatchItemType = 'movie' | 'show' | 'season' | 'episode' | 'unknown';

export type ExternalIdKind = 'imdb_id' | 'tmdb_id' | 'tvdb_id';

export interface ExternalId {
  kind: ExternalIdKind;
  value: string;
}

export interface JustWatchItem {
  title: string;
  year?: string;
  type: JustWatchItemType;
  href: string;
  url: string;
  posterId?: string;
  externalIds: ExternalId[];
  unresolvedReason?: string;
}

export interface ScanSummary {
  scanned: number;
  letterboxdRows: number;
  traktRows: number;
  unresolvedRows: number;
}

export interface ScanResponse {
  items: JustWatchItem[];
  summary: ScanSummary;
}
