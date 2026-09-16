# Minimal Manifest Compatibility Proposal

The existing corpus manifest represents parsed JSON through `vector.input`. The challenge pack preserves that field for every specified structured vector, so those vectors remain portable to the existing runner after selecting this corpus.

Exact malformed input bytes cannot be expressed by `input`. A future additive reader may accept:

```json
{
  "input_utf8_base64": "eyJzY2hlbWEiOg==",
  "expected": {
    "classification": "UNDERSPECIFIED",
    "allowed_observations": ["REJECT", "PROCESS_ERROR"]
  }
}
```

Rules:

1. `input` and `input_utf8_base64` are mutually exclusive.
2. Existing `input` behavior is unchanged.
3. `UNDERSPECIFIED` observations are recorded but never counted as PASS, DIVERGENCE, or conformance evidence.
4. A load failure remains `INFRASTRUCTURE_FAILURE`; it never kills a semantic mutant.

This pack implements the proposal only in its standalone harness. It does not change the MVP engine or shared report schema.
