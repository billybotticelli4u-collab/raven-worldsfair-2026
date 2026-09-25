# Runtime

Milestone 1 binds **Node.js v22.18.0** exactly (same as accepted legacy Replay).

On the author Darwin arm64 machine, Homebrew `node@22` was broken (missing `libsimdjson.31.dylib`). Official nodejs.org `node-v22.18.0-darwin-arm64` was verified and used. That is a **separately identified** local environment fix to obtain the **same** bound runtime — not a silent widening to Node 24.

`engines` in package.json requires `22.18.0`. Launcher `bin/raven-replay-sdk` refuses other versions.
