# Scope and remaining gates

This is an author-built local prototype awaiting non-author review.

The experimental parser only checks a defined subset of Solana byte structure. Its exact source is pinned; pinning does not establish completeness or correctness against all Solana specifications. No new claim is made about the parent Fair profile's 12-vector corpus or pending R2/R3 reviews.

The signed action envelope is new and separate from Raven's conformance report and receipt formats. It does not replace them or inherit their review verdicts. No signer enrollment, hosted registry, production key or identity certification is implemented.

The envelope binds the input, fixed policy, tool digest, runtime version, complete output and capture metadata. Replay compares the full execution record; capture UUID/time/caller label are signature-bound but are not re-observed or independently authenticated. Expected digest and signer fingerprint must come from a trusted source if replacement detection is required. Network anchoring is neither attempted nor claimed.

An incomplete or failed tool execution cannot produce a matching successful replay. Process termination before the evidence file is fully written can leave an unusable partial file, which the verifier refuses; no resumable capture is implemented. No private keys are saved.

Packaging targets a clean directory with Node 22.18.0. Current measurements are macOS only. The same-machine clean extraction is author evidence, not a stranger's independent reproduction.

Remaining before final product acceptance: non-author contract/code/package review, independent clean-machine reproduction, usability review and correction of findings. No push, merge, deployment or publication is authorized by this prototype or by a future review PASS.
