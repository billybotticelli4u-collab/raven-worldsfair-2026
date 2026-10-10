// Registers Billy 1's LIVE-SOLANA tests (apps/worldsfair-agent-trust/live/test/)
// with the app's existing `npm test` glob, without editing the guarded
// package.json. Loopback stub only; the hosted Raven API is never called.
import "../live/test/live-solana.test.js";
import "../live/test/live-solana-hooks.test.js";
