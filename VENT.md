# VENT

Feedback log. Repeated/systemic workflow friction that should become future automation, docs, or workflow fixes.

## 26-10-01 01:11 — tool_error

Symptom: Native browser inspection succeeded, but keyboard control failed with "window_not_focused: keyboard input requires the target window to be focused" and the recommended restore retry failed with "restoreWindow was requested but the target window is still not focused".
Trigger: `orca-ide computer hotkey` against a Windows browser from WSL, with and without `--restore-window`.
Workaround: Two unsuccessful focus attempts; exercised the built extension in a separate managed Chromium session with localized fixtures instead. Logged-in verification remains unavailable through this control path.
Suggested fix: Expose effective foreground-window capability before recommending keyboard actions, and provide a reliable WSL-to-Windows foreground activation path or an explicit unsupported status.
Impact: medium

## 26-10-01 01:36 — tool_error

Symptom: Extension popup smoke runs reported "Could not find an active browser window", and opening `popup.html` as a normal page could navigate that page instead of the intended site. The initial managed page was not visible through `chrome.windows.getAll()`.
Trigger: Browser Eval's managed-tab surface used as the active tab for extension-action testing.
Workaround: Create a regular tab with the raw Puppeteer `browser.newPage()` inside `tab.run`, then invoke `chrome.action.openPopup()` from the extension worker. Inspect the actual popup through its target's CDP session; `target.page()` returned null. This successfully exercised automatic navigation and the separate manual scan.
Suggested fix: Provide an extension-aware launch option with a regular extension-visible browser tab, plus direct action-popup inspection and interaction helpers.
Impact: medium

## 26-10-01 01:36 — missing_tooling

Symptom: Repeated behavior searches returned no hits because every judgment failed with "Insufficient credits. This account never purchased credits." (HTTP 402).
Trigger: `find` across successive changes to this extension.
Workaround: Use known-symbol `grep` and targeted `read`; report the upstream failure separately.
Suggested fix: Fail explicitly on unavailable judgment providers and offer a non-judged discovery fallback instead of presenting an empty search result.
Impact: medium
