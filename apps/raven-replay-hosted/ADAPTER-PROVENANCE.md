# Fixed historical decoder adapters

Source: delivered RAVEN-DECODER-UPGRADE-EXPERIMENT-2026-09-29/artifacts.
The two published decoder versions are 3.0.3 and 4.0.0. No new decoder implementation.

Bundle SHA-256:
- 3.0.3: 1fd6f9ea75f16a9868714a4f645d60bd76c8e0f2af44660654658c14f960c293
- 4.0.0: 53d0580133f656b67a8534a1218fafc0f0e509f867c6500eaf2b4c63b64c0930

Only adapter import paths changed from ../pins/kit-VERSION-decode.mjs to
./bundle.mjs. The S2 guard therefore binds each bundle inside that adapter's
own directory; no broad directory permit was added. Both adapters are registered
before case creation. This does not demonstrate a cross-install upgrade.

The test fixture is the historical 176-byte synthetic wire encoded by Kit 3.0.3,
not a fetched transaction and not a claim of support for today's v1 wire format.
Both Raven projections REJECT; the reason changes. That is not a safety verdict,
new upstream bug or external customer finding. Fetching current v1 bytes remains
supported, while decoded saved cases remain legacy/v0 only.

Reproduction of bundles was measured in the earlier R2 build-script packet;
this integration verifies delivered hashes, not a new bundle rebuild. Full
third-party notices must be assembled and checked before public distribution.
