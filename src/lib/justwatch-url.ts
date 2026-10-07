export const JUSTWATCH_ORIGIN = 'https://www.justwatch.com';
export const JUSTWATCH_HOME = `${JUSTWATCH_ORIGIN}/`;

export function isJustWatchUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).origin === JUSTWATCH_ORIGIN;
  } catch {
    return false;
  }
}
