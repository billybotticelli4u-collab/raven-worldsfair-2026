# Saved cases — local browser interface

Claude authored this interface. CODEX authored the case library and CLI (`src/cases.mjs`, `src/cases-cli.mjs`), which
are unchanged here, as are the original capture/replay/challenge files. Independent review of the combined behaviour
is pending; nothing here has been reviewed by its author's counterpart yet.

## Run it

Use exactly Node.js 22.18.0. No dependency installation, account, RPC or wallet is needed.

```sh
node src/cases-server.mjs
```

Then open **http://127.0.0.1:8795/cases**. `RAVEN_REPLAY_PORT=8896 node src/cases-server.mjs` picks another port.
The address must be `127.0.0.1`: `http://localhost:8795/cases` is refused with `Loopback host required`, as in the
original prototype. The original capture/replay/challenge page is served unchanged by the same process at `/`, so
`node src/server.mjs` is not needed while this one runs.

A wrong runtime is refused rather than compared. Started under another Node, the server prints a warning and every
creation or run reports `RUN_ERROR: Runtime mismatch: use Node v22.18.0`.

## What you can do

1. **Create** a named case from base64 transaction bytes. The pinned tool runs once and its complete execution
   becomes the saved expectation.
2. **Import** a case file (or pasted case JSON), and **export** any listed case as pretty-printed JSON.
3. **Rerun** one case, or a batch of up to ten.
4. **See** the comparison outcome, the expected and actual parser decision side by side, and the changed field paths.
5. **Export** the run report exactly as the library produced it.

Cases live in the browser tab only. Nothing is stored on disk by the server, and closing the tab discards them.

## Reading the result

The **comparison outcome** and the **parser decision** are separate rows, and both are always shown.

| Outcome | Exit | Means |
|---|---|---|
| Reproduced (MATCH) | 0 | The new run matched every saved execution field. |
| Changed (REGRESSION) | 1 | The tool completed, but its execution differs from the saved expectation. |
| Case refused (INVALID_CASE) | 2 | The case or its supplied reference was not accepted; no comparison was made. |
| Execution error (RUN_ERROR) | 3 | No complete run happened; no comparison was made. |

MATCH means the saved expectation reproduced. It never means the transaction is safe, and an expected parser REJECT
can MATCH. An execution error never passes because it resembles an expected failure.

The **reference** row says whether you supplied a separately retained digest, and whether it matched. A case's content
digest is shown after it is created or imported so you can keep it somewhere else; the page never fills a reference in
for you, because the browser is not an independently trusted reference source. A case and its reference changed
together cannot be detected.

## Limits this server imposes

The library is not an HTTP security boundary, so `src/cases-server.mjs` adds, for its own routes only:

- Loopback `Host` must be exactly `127.0.0.1:<port>`; writes need the exact same `Origin` and `Content-Type: application/json`.
- Request bodies: 131,072 bytes for create, 278,528 for import, 1,327,104 for run; a body that stalls for 10 s is cut off with 408.
- One saved-case request at a time (429 `BUSY`); at most 30 pinned-tool executions per 60 s (429 `WORK_BUDGET`, with `Retry-After`).
- Exact request fields. Anything else, including a field that names a file, command or destination, is refused with 400.
- Batches of 1 to 10 cases with unique names, as the library requires.

Imported text is treated as untrusted: it is parsed and validated by the library, never executed, and the page renders
every value as text. Only `.json` case files are read, and no upload can choose code, a command or a filesystem path.

Every other route — `/`, `/app.js`, `/style.css`, `/sample`, `/capture`, `/verify`, `/challenge` — is handed to the
original handler unchanged and keeps its original behaviour and limits. The work budget and the one-at-a-time guard do
not cover those original routes.

## Files

Added: `src/cases-server.mjs`, `public/cases.html`, `public/cases.js`, `public/cases-view.mjs`, `public/cases.css`,
`test/cases-server.test.mjs`, `test/cases-view.test.mjs`, this file.
Unchanged: every file inherited from the candidate, including `src/cases.mjs`, `src/cases-cli.mjs`, `src/server.mjs`,
`public/index.html`, `public/app.js`, `public/style.css` and `package.json`.

`npm test` runs the whole suite (77 tests) on Node 22.18.0.
