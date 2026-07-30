# Browser verification suites

Headless checks against the **built** pages (`index.html`, `b.html`,
`library.html`, `editor.html`) over `file://` with every API call mocked
via Playwright routes — no server, no keys, no network.

```sh
python3 build.py                       # suites test the build outputs
node test/browser/verify-canvas.mjs    # layout, gestures, editor, sheet (~60 checks)
node test/browser/verify-images.mjs    # image fan-out, polling, motion (~25 checks)
```

Environment (defaults match the Claude Code cloud container):

| var               | meaning                          |
|-------------------|----------------------------------|
| `BOOK_ROOT`       | repo root (default: `../..` from the script) |
| `CHROME_BIN`      | chromium executable              |
| `PLAYWRIGHT_CORE` | path to playwright-core `index.mjs` |

Exit code is non-zero when any check prints `FAIL`.
