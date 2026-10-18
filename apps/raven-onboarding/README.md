# Raven unified onboarding — local review candidate

One entry point for the existing Kit comparison, Conformance and retained-fixture Agent Trust checks. No installation is needed after a recursive clone. Use **Node 22.18.0** and run from the repository root:

```sh
npm run onboarding
```

Open the printed `http://127.0.0.1:8790` URL. This candidate binds only to IPv4 loopback and is not wired into the hosted site or Vercel configuration. `PORT` may select another local port. Stop with Ctrl-C. The standalone server also shuts down if its original launcher exits (including SIGTERM to npm); cleanup uses the same abort path as direct SIGINT/SIGTERM.

1. **Compare interpretations:** choose synthetic example E to see the real pinned Kit 3.0.3/4.0.0/8.3.0 two-call adapters disagree; choose A for the legacy control, or paste public hex/base64 bytes up to 4,096 bytes. The unchanged worker executes in the browser. The report is unsigned and pins the bytes by SHA-256. Signature validity, signer trust, execution and safety are unchecked. The version-3 difference is a known upstream-fixed check, not a new vulnerability claim.
2. **Test against a profile:** switch explicitly to the retained 30-vector experimental corpus. The existing engine, isolation and display adapter execute unchanged. The deliberately stale parser produces 27 matching rows and three differences; the reference matches 30. Proposed v1 (SIMD-0385) and profile-policy clauses are not a claim of full Solana correctness. Timeouts, execution errors and skips remain visible as non-passes, even if the engine's raw classification says CONFORMANT. Save the original unsigned report and inspect exact vector/profile identities. UI runs do not write reports into the source checkout; the displayed CLI reproduction command writes a git-ignored report and exits 1 for DIVERGENT.
3. **Check a receipt before deciding:** switch explicitly to the retained signed BONK receipt and its existing tampered/wrong-subject/missing/exception paths. The pinned receipt verifier and Agent A policy execute unchanged. `liveAcquisition:false`; freshness is evaluated at the disclosed fixture clock. The saved exchange record is unsigned, although the retained original receipt is signed. PROCEED is Agent A's policy decision, not permission to transact. No signing, provider acquisition, external agent request, submission or settlement occurs.

These are related demonstrations with different evidence. No comparison report becomes a receipt, no hash becomes a signature, and no automatic same-input pipeline is claimed. Input edits, example changes, navigation, cancellation and failures remove the current result/export. Request generations and abort checks prevent old responses from replacing a newer result.

The local server imports the original Conformance runner/display adapter and Agent Trust exchange function. It serves the original Kit assets without changing their bytes. Its new routes accept only existing allowlisted examples; they do not accept arbitrary code, receipts or signing requests. A same-user process that can rewrite this checkout remains outside its trust boundary.

If local examples or profile identities cannot load, their explanation stays visible across steps. Reload to retry; comparison with manually entered bytes and the receipt fixture remain available independently. Another active run is explained with a wait-and-retry hint. Profile runs can take over a minute on a slow or failing target; the engine does not stream progress. Cancellation invalidates the browser result. A shutdown racing a non-pass engine report can still close the connection before the browser receives it; this does not establish a successful check.

Verification:

```sh
npm run test:onboarding
npm run test:all
node apps/kit-compare/test.mjs
npm --prefix apps/raven-conformance test
```

Browser validation and evidence are retained in the author packet outside the repository. A non-author must review the new presentation, failure handling and preservation before publication. This is author delivery, not independent acceptance, release permission or a change to the submitted project.

The onboarding tests include a real Chromium layout regression for every step, normal results, failure/skip banners and long error messages. Use an already installed Chromium and, when it is not at a standard path, set `RAVEN_CHROMIUM=/absolute/path/to/chromium` before `npm run test:onboarding`. The test uses Node built-ins, downloads nothing, and fails clearly if Chromium is unavailable. It blocks external page requests and keeps the complete profile identity and limits visible. Its controlled failure responses test presentation only; normal runs execute the existing checks. Browser availability is a test prerequisite, not an extra installation needed to use the workspace in your browser.
