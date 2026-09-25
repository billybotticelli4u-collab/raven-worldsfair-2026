# Obtain exact Node.js v22.18.0 for Raven Replay V2

Status: PROPOSED guide change for KIMI review. Not yet bound into the frozen developer-trial archive. Does not modify product ZIP `RAVEN-REPLAY-PROTOTYPE-V2-2026-09-21.zip` (SHA-256 `4e5c67c56dd375acbdca9a5213a0da5c2bc1d84713547a84698dfa8570c02707`).

Audience: a developer who must run the trial with the exact runtime the product checks for. `START-HERE.md` already requires `node --version` → `v22.18.0`. This note only covers how to get that runtime.

## Why exact

Author diagnostic on 2026-09-22 (`runtime-gap-check/RESULT.json`): Node v22.18.0 capture/verify exit 0; Node v24 capture/verify exit 1 with HTTP 400 body `Runtime mismatch: use Node v22.18.0`. Wrong major versions are refused on purpose. Close-enough LTS is not enough.

## Confirm before anything else

```bash
node --version
```

If the printed line is exactly `v22.18.0`, skip the rest of this note and continue `START-HERE.md`.

## Obtain Node v22.18.0 (pick one)

Official index entry (nodejs.org dist, checked 2026-09-22): version `v22.18.0`, date `2025-07-31`, LTS line `Jod`. Files include `osx-arm64-tar`, `osx-x64-tar`, `osx-x64-pkg`, `linux-arm64`, `linux-x64`, and Windows packages. Prefer the official build for your OS/CPU.

### Option A — official binary tarball (Mac or Linux)

1. Open https://nodejs.org/dist/v22.18.0/ and download the archive that matches your machine (examples: `node-v22.18.0-darwin-arm64.tar.gz`, `node-v22.18.0-darwin-x64.tar.gz`, `node-v22.18.0-linux-x64.tar.xz`, `node-v22.18.0-linux-arm64.tar.xz`).
2. Also download `SHASUMS256.txt` from that same directory. Verify the archive line before extracting.
3. Extract somewhere you control and put its `bin` directory first on `PATH` for this shell only, for example:

```bash
# example paths — adjust to where you extracted
export PATH="$PWD/node-v22.18.0-darwin-arm64/bin:$PATH"
node --version   # must print v22.18.0
```

Do not leave a different `node` earlier on `PATH`.

### Option B — official Mac pkg (x64 pkg is published)

If you use the official macOS `.pkg` from the same `v22.18.0` directory, install it, then open a new terminal and confirm `node --version` is `v22.18.0`. If the installer would replace a different system Node you still need, prefer Option A or C so the trial shell can pin 22.18.0 without fighting other work.

### Option C — nvm (if you already use it)

```bash
nvm install 22.18.0
nvm use 22.18.0
node --version   # must print v22.18.0
```

Pin the shell with `nvm use 22.18.0` before starting the trial server. A generic `nvm use 22` may float to a different 22.x and will fail the product check.

## Fail closed

- If `node --version` is not exactly `v22.18.0`, stop and fix the runtime. Do not continue the trial on another version.
- If the server or CLI prints `Runtime mismatch: use Node v22.18.0`, you are on the wrong Node. Record the version you actually ran.
- This note does not authorize Windows as a supported trial OS. Product docs still scope Mac/Linux.

## After the runtime is correct

Return to `START-HERE.md` at the ZIP digest check and continue from there. No `npm install` is required for the frozen prototype.

## What this note does not claim

- Not a change to the frozen product or the READY trial ZIP.
- Not proof that every install method above was freshly re-run on every OS in this proposal.
- Not organizational identity, chain anchoring, or external adoption.
