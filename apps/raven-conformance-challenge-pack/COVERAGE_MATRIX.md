# Coverage Matrix

Frozen corpus: `raven-canonical-envelope-challenge-corpus/1@1.0.0` (file SHA-256 `14253cf131025a23c90b459639d1e25626596e477c0e96954ce4537a1fa43b07`)

| Requirement | Vectors | Targeted mutant → measured outcome |
|---|---|---|
| `REQ-ACCEPT-ONLY-ALL` | `V03_digest_mismatch`, `V04_schema_mismatch`, `V05_missing_digest`, `V06_empty_id`, `V07_unexpected_top_level_field`, `V08_unexpected_extension_key`, `V09_payload_not_object`, `V10_missing_schema`, `C06_null_envelope`, `C07_array_envelope`, `C08_missing_id`, `C09_missing_payload`, `C10_numeric_id`, `C11_boolean_id`, `C12_array_payload`, `C13_null_payload`, `C14_uppercase_digest`, `C15_numeric_digest`, `C16_insertion_order_digest`, `C17_proto_named_top_level_field`, `C18_null_schema`, `C19_schema_case_mismatch` | MUTANT_ACCEPT_EVERYTHING → KILLED |
| `REQ-ACCEPT-VALID` | `V01_valid_minimal`, `C01_valid_empty_payload`, `C04_valid_unicode_id_and_payload` | MUTANT_REFUSE_EVERYTHING → KILLED |
| `REQ-DIGEST-CANONICALIZATION` | `V02_valid_nested`, `C02_valid_recursive_key_sort`, `C16_insertion_order_digest` | MUTANT_HASH_INSERTION_ORDER → KILLED |
| `REQ-DIGEST-EQUALITY` | `V03_digest_mismatch`, `C14_uppercase_digest`, `C15_numeric_digest` | MUTANT_IGNORE_DIGEST → KILLED |
| `REQ-ENVELOPE-OBJECT` | `C06_null_envelope`, `C07_array_envelope` | none |
| `REQ-ID` | `V06_empty_id`, `C03_valid_whitespace_id`, `C10_numeric_id`, `C11_boolean_id` | MUTANT_ALLOW_INVALID_ID → KILLED |
| `REQ-NO-UNEXPECTED` | `V07_unexpected_top_level_field`, `V08_unexpected_extension_key`, `C05_valid_nested_unexpected_name`, `C17_proto_named_top_level_field` | MUTANT_ALLOW_EXTRA_FIELDS → KILLED |
| `REQ-PAYLOAD` | `V09_payload_not_object`, `C12_array_payload`, `C13_null_payload` | MUTANT_ALLOW_ARRAY_PAYLOAD → KILLED |
| `REQ-REQUIRED-KEYS` | `V05_missing_digest`, `V10_missing_schema`, `C08_missing_id`, `C09_missing_payload` | MUTANT_ALLOW_MISSING_DIGEST → KILLED |
| `REQ-SCHEMA` | `V04_schema_mismatch`, `C18_null_schema`, `C19_schema_case_mismatch` | MUTANT_IGNORE_SCHEMA → KILLED |

## Redundancy and Limits

- `V07` and `V08` are behaviorally redundant for the current allow-extra-fields mutant; both are retained because one is a generic field and one is extension-shaped.
- `V02` and `C02` both catch insertion-order hashing; `C02` provides a smaller nested counterexample paired with negative `C16`.
- Malformed bytes and duplicate-member behavior are measured but unscored because the profile does not specify refusal versus process error or duplicate-member parsing.
- The profile contains no signer or key field, so signer/key representation claims are not applicable and are not invented here.
- Passing this corpus does not establish security, authorization, signer trust, deployment identity, or successful on-chain execution.

