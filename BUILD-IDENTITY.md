# Build identity: local review successor

This successor starts at accepted C2 release-recipe commit e042e1fdc39b9ca4831356e970c53e0dadc6c329. It changes identity reporting in both Fair apps. It does not replace the accepted release, change a deployment, or authenticate the old live app.

Commit selection: valid platform assertion, local Git checkout, then generated assertion. Operator claims are disclosed separately and never become the selected commit. All claims require exactly 40 hexadecimal characters. Invalid inputs produce a source-specific warning; differing valid claims produce CONFLICT. Branch is null: it is no longer an independent assertion. Even matching claims are UNVERIFIED_ASSERTION. A Git checkout identifier does not assert a clean working tree or prove deployed byte identity.

The agent-trust generator and both readers use byte-identical buildIdentity.js helpers. Generation ignores previous generated output. The accepted base generator differs from the deployed generator described in Claude's note; this patch is based on the accepted bundle, not a reconstruction of the deployment.

Both readers calculate SHA-256 for public/app.js, public/index.html and public/styles.css. The aggregate is SHA-256 of UTF-8 JSON.stringify(files) plus a newline, in app.js/index.html/styles.css order. Each member contains path, byte length and sha256. Missing files return no fingerprint; changed files versus a generated fingerprint produce CONFLICT. This is a consistency check of three static UI files, not a cryptographic binding of a source commit, backend, or deployment. A dishonest server can supply mutually consistent false claims.

Recompute from HTTP responses with Node 22 or later:

```
node scripts/verify-public-build.mjs http://127.0.0.1:8791
```

For agent-trust use its port (default 8787). The verifier refuses missing files, changed bytes, reordered/unexpected members and a changed aggregate. Concurrent deployment can cause a mismatch; retry only after establishing a stable version.

## Scope and release handoff

Current C2 recorded reports and clone recipes still describe their accepted e042 predecessor. They are preserved as historical measurements. To review THIS successor, use its bundled REVIEW-HANDOFF.md and SOURCE-IDENTITY.json; do not use a recorded report's recipe as this successor's clone instructions. Publishing this successor requires a separately reviewed release handoff update. No deployment, Vercel settings, corpus, profile, verifier dependency or isolation policy is changed here.

The bundled older agent-trust app lacks vendor/raven-receipt-verifier/packages/verify-js/src/index.ts. Its full suite has 12 failures on the unchanged base and candidate. Restoring that authenticated dependency/deployment base is a separate prerequisite to any whole-app release assertion. Identity-focused tests and About/HTTP checks do not close it.
