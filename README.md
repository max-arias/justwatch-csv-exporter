# justwatch-csv-exporter

## Scanning

Click the extension icon from any page. The extension automatically navigates the
**current tab** to your JustWatch Seen list and starts extraction. It does not open
a new tab; the current page is replaced:

- If the current JustWatch URL already identifies your country, it uses that country.
- Otherwise it opens `https://www.justwatch.com/`, waits for the homepage, and
  reads the destination of the Lists link (`[data-testid="navbar-watchlist"]`).
  That destination identifies the country without relying on the link's translated text.
- It opens `https://www.justwatch.com/<country>/lists/my-lists?inner_tab=seenlist`
  and waits for the page to load. No country is hardcoded or used as a fallback.

The popup displays **Opening Seen list...** during navigation, then **Scanning...**
while extracting titles. No additional button press is required. Once finished,
choose the titles to export, or press **Scan Again** to repeat extraction.
You must be signed in to JustWatch to access your Seen list.

After navigation, the extension waits for the list controls to appear, selects the
detailed layout, then scrolls and scans. Navigation and layout selection use URLs
and CSS selectors, not translated labels such as “My Lists” or “Seen”.
Navigation and scanning continue if the popup is closed. Opening the extension
again while extraction is running continues that scan; opening it after completion
starts a new extraction of the current tab.

If loading stalls, country discovery fails, or the tab closes, the extension reports
an error instead of guessing a country or scanning the wrong page. A missing list
view asks you to sign in and try again.
