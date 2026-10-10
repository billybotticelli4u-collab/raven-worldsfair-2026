// TEST-ONLY preload for CLI subprocesses (node --import).
// 1. Network guard: fetch may only reach loopback; anything else throws, so a
//    test can never reach the hosted Raven API or a Solana RPC.
// 2. Optional fixed clock (RAVEN_TEST_FIXED_NOW) so the genuine, months-old
//    fixture receipt can be evaluated as fresh. Product code has no clock flag.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    return Promise.reject(new Error("TEST NETWORK GUARD: non-loopback fetch blocked"));
  }
  return realFetch(input, init);
};

const fixed = process.env.RAVEN_TEST_FIXED_NOW;
if (fixed) {
  const base = Date.parse(fixed);
  if (!Number.isFinite(base)) throw new Error("bad RAVEN_TEST_FIXED_NOW");
  const t0 = performance.now();
  const RealDate = Date;
  const nowMs = () => base + Math.round(performance.now() - t0);
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(nowMs());
      else super(...args);
    }
    static now() { return nowMs(); }
  }
  globalThis.Date = FixedDate;
}
