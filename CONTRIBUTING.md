# Contributing

## Every change ships with its test

- **A new feature** lands with a test in `tests/` that exercises it the way a deck uses it.
- **A bug fix** lands with a test that FAILS without the fix. Write it first, watch it fail
  on the old code, then fix. `tests/browser.test.mjs` shows the pattern: it puts the old
  final-state flash back into the engine and asserts the probe catches it.
- **A new gate in `check.mjs`** lands with a broken-deck case in `tests/gates.test.mjs`: a
  one-line mutation of the template and the FAIL line it must produce. Mutate with `once()`,
  which throws when the text to replace is not there exactly once, so a test can never
  pass for the wrong reason.

## Run them

```bash
node --test tests/*.test.mjs              # everything (about 90 s; the browser tests dominate)
node --test tests/gates.test.mjs          # one file
DECK_BROWSER=/path/to/chrome node --test tests/browser.test.mjs
```

No dependencies to install. GitHub Actions (`.github/workflows/tests.yml`) runs the same suite
on every pull request and every push to `main`. A pull request is ready when it is green.

## What is covered

| File | Covers |
|---|---|
| `tests/gates.test.mjs` | `check.mjs` passes the template and the landing, and fails each class of broken deck |
| `tests/source.test.mjs` | edit mode's byte-exact write-back, stale-edit refusal, patches, reorder |
| `tests/edit-server.test.mjs` | the edit server over HTTP, cross-origin refusal, and the agent's `review.mjs` loop |
| `tests/browser.test.mjs` | the flash probe on real Chrome, including the reintroduced-bug regression (in the template, and in the runtime alone under the landing); the single-file export presenting from `file://` |
| `tests/stream.test.mjs` | `pack.mjs` (byte-exact templates and fragments, refusals) and the live-window gate |
| `tests/runtime.test.mjs` | the shared runtime: the landing's copy matches the template's, install pins and refuses another major, `check.mjs` fails a missing or mismatched runtime, the single-file export inlines it |
| `tests/images.test.mjs` | `pack --images`: variant widths, the byte-exact rewrite, WebP output, the file each screen size fetches (and too much without `sizes`), the screenshot tolerance |
| `tests/live.test.mjs` | the live window on real Chrome via `memory.mjs`: bounded live stations, memory flat from 21 to 66 stations, the paint gate under a slow script, packed and streamed decks, failing streams, edit mode with the navigator scrolled end to end (posters, no iframes); each paired with the bug put back. No remote debugging needed |

Not covered yet: `shoot.sh` output (its headless capture can race the engine's fonts-ready
boot), motion timing beyond the flash, and evals of generated decks.
