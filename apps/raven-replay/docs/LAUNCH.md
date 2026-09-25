# Launch Raven Replay saved cases (Mac / Linux)

Use exactly Node.js v22.18.0. See the bundled [setup guide](../SETUP-NODE-22.18.0.md) and [START-HERE](../START-HERE.md). The guide's old PROPOSED header is retained from its reviewed source; current review status is in [REVIEW-STATUS](../REVIEW-STATUS.md).

From the extracted package root:

```sh
./bin/raven-replay
# Or select an exact runtime for this invocation only:
./bin/raven-replay --node /absolute/path/to/node-v22.18.0/bin/node
# Choose another free port if necessary:
./bin/raven-replay --port 8795
```

The Bash launcher starts only `src/cases-server.mjs`, Claude's existing saved-case HTTP wrapper. Open the printed `http://127.0.0.1:<port>/cases` address. The original capture/replay/challenge page remains at `/` in the same process. The default port is 8794; `localhost` is refused by the server's Host check.

`RAVEN_REPLAY_NODE` and `RAVEN_REPLAY_PORT` provide equivalent per-launch settings. Quote executable paths containing spaces. Ctrl-C stops the server (the launcher `exec`s Node, so there is no separate child). A busy port is refused without killing its holder.

The launcher does not install Node, edit shell profiles, change a global runtime, elevate privileges or publish anything. It now binds the separately authored UI into the delivery; that CODEX integration change requires independent review.

## Shutdown and exit codes

On the first SIGINT (Ctrl-C), SIGTERM, SIGHUP (terminal closed) or SIGQUIT (Ctrl-\\) the server stops at once: it closes the listener, answers any request still arriving on an open connection with `503 SHUTTING_DOWN`, and destroys connections still held open after 1 s. It then waits for every owned worker/adapter cleanup, including one already running for a finished or disconnected request, before it exits. Further signals while stopping are ignored; cleanup continues. SIGKILL cannot be handled and is outside this guarantee.

| Outcome | Exit code |
|---|---|
| Clean shutdown after SIGINT / SIGTERM / SIGHUP / SIGQUIT | 130 / 143 / 129 / 131 (the first signal decides) |
| Any owned process could not be confirmed gone (cleanup failed, or process identity unreadable) | **1**, with `possibly still running: pid …` lines on stderr |

Unreadable process information is never reported as "gone". There is no environment switch that restores the older launcher behaviour.

