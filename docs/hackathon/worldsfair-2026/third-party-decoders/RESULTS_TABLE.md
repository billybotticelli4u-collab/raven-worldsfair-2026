# Per-row results (all 30 vectors, every decoder)

Columns: expected | observed | status | classification | raw decoder message (adapter `reason`).
`reason` is NOT compared by the runner; only decision+version are.

## @solana/kit 8.4.0 (latest)

Runner: OFFICIAL Raven runner (node --permission), report `reports/official/official-TP_KIT_8_4_0.json`

| vector | category | expected | observed | status | classification | raw decoder message |
|---|---|---|---|---|---|---|
| V01_valid_legacy | structural | ACCEPT/"legacy" | ACCEPT/"legacy" | PASS | PASS | decoder_returned |
| V02_valid_v0 | structural | ACCEPT/0 | ACCEPT/0 | PASS | PASS | decoder_returned |
| V03_valid_v1 | structural | ACCEPT/1 | ACCEPT/1 | PASS | PASS | decoder_returned |
| V04_valid_v0_with_lookup_table | structural | ACCEPT/0 | ACCEPT/0 | PASS | PASS | decoder_returned |
| V05_valid_legacy_duplicate_account | structural | ACCEPT/"legacy" | ACCEPT/"legacy" | PASS | PASS | decoder_returned |
| V06_truncated_legacy | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 32 bytes, got 19. |
| V07_trailing_bytes_v0 | structural | REJECT/null | ACCEPT/0 | DIVERGENT | EXPECTED_SCOPE, KNOWN (no exact-consumption check; kit issue #1963 closed not_planned) | decoder_returned |
| V08_unsupported_tx_version_2 | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#5663021:This version of Kit does not support decoding transactions with version 2. The current max supported version is 1. |
| V09_unsupported_message_version_3 | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#5663021:This version of Kit does not support decoding transactions with version 3. The current max supported version is 1. |
| V10_noncanonical_shortvec_sigcount | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 32 bytes, got 14. |
| V11_inflated_sigcount | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 32 bytes, got 17. |
| V12_v1_duplicate_accounts | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V13_v1_heap_out_of_range | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V14_malformed_base64 | prelude | REJECT/null | REJECT/null | PASS | PRELUDE_ROW | adapter:malformed_base64 |
| V15_malformed_input_shape | prelude | REJECT/null | REJECT/null | PASS | PRELUDE_ROW | adapter:malformed_input:keys |
| V15_unexpected_input_key | prelude | REJECT/null | REJECT/null | PASS | PRELUDE_ROW | adapter:malformed_input:keys |
| V16_valid_v1_two_instructions | structural | ACCEPT/1 | ACCEPT/1 | PASS | PASS | decoder_returned |
| V17_v1_interleaved_layout | structural | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE, KNOWN (no exact-consumption check; kit issue #1963 closed not_planned) | decoder_returned |
| V18_v1_header_req_sig_gt_accounts | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#5663027:The provided transaction bytes expect that there should be 4 signatures, but the bytes are not long enough to contain a transa |
| V19_legacy_signature_count_mismatch | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#5663017:The transaction message expected the transaction to have 1 signatures, got 2. |
| V20_v1_account_index_out_of_bounds | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V21_v1_size_cap_exceeded | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V22_legacy_size_cap_exceeded | sanitize/policy | REJECT/null | ACCEPT/"legacy" | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V23_v1_ro_signed_equals_req_sig | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V24_v1_instructions_cap | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V25_v1_signatures_cap | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V26_v1_addresses_cap | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| LAB01_legacy_unsigned_overflow | sanitize/policy | REJECT/null | ACCEPT/"legacy" | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| LAB02_v1_unsigned_overflow | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| LAB03_v1_required_accounts | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |

## @solana/kit 8.3.0

Runner: OFFICIAL Raven runner (node --permission), report `reports/official/official-TP_KIT_8_3_0.json`

| vector | category | expected | observed | status | classification | raw decoder message |
|---|---|---|---|---|---|---|
| V01_valid_legacy | structural | ACCEPT/"legacy" | ACCEPT/"legacy" | PASS | PASS | decoder_returned |
| V02_valid_v0 | structural | ACCEPT/0 | ACCEPT/0 | PASS | PASS | decoder_returned |
| V03_valid_v1 | structural | ACCEPT/1 | ACCEPT/1 | PASS | PASS | decoder_returned |
| V04_valid_v0_with_lookup_table | structural | ACCEPT/0 | ACCEPT/0 | PASS | PASS | decoder_returned |
| V05_valid_legacy_duplicate_account | structural | ACCEPT/"legacy" | ACCEPT/"legacy" | PASS | PASS | decoder_returned |
| V06_truncated_legacy | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 32 bytes, got 19. |
| V07_trailing_bytes_v0 | structural | REJECT/null | ACCEPT/0 | DIVERGENT | EXPECTED_SCOPE, KNOWN (no exact-consumption check; kit issue #1963 closed not_planned) | decoder_returned |
| V08_unsupported_tx_version_2 | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#5663021:This version of Kit does not support decoding transactions with version 2. The current max supported version is 1. |
| V09_unsupported_message_version_3 | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#5663021:This version of Kit does not support decoding transactions with version 3. The current max supported version is 1. |
| V10_noncanonical_shortvec_sigcount | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 32 bytes, got 14. |
| V11_inflated_sigcount | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 32 bytes, got 17. |
| V12_v1_duplicate_accounts | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V13_v1_heap_out_of_range | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V14_malformed_base64 | prelude | REJECT/null | REJECT/null | PASS | PRELUDE_ROW | adapter:malformed_base64 |
| V15_malformed_input_shape | prelude | REJECT/null | REJECT/null | PASS | PRELUDE_ROW | adapter:malformed_input:keys |
| V15_unexpected_input_key | prelude | REJECT/null | REJECT/null | PASS | PRELUDE_ROW | adapter:malformed_input:keys |
| V16_valid_v1_two_instructions | structural | ACCEPT/1 | ACCEPT/1 | PASS | PASS | decoder_returned |
| V17_v1_interleaved_layout | structural | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE, KNOWN (no exact-consumption check; kit issue #1963 closed not_planned) | decoder_returned |
| V18_v1_header_req_sig_gt_accounts | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#5663027:The provided transaction bytes expect that there should be 4 signatures, but the bytes are not long enough to contain a transa |
| V19_legacy_signature_count_mismatch | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#5663017:The transaction message expected the transaction to have 1 signatures, got 2. |
| V20_v1_account_index_out_of_bounds | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V21_v1_size_cap_exceeded | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V22_legacy_size_cap_exceeded | sanitize/policy | REJECT/null | ACCEPT/"legacy" | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V23_v1_ro_signed_equals_req_sig | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V24_v1_instructions_cap | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V25_v1_signatures_cap | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V26_v1_addresses_cap | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| LAB01_legacy_unsigned_overflow | sanitize/policy | REJECT/null | ACCEPT/"legacy" | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| LAB02_v1_unsigned_overflow | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| LAB03_v1_required_accounts | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |

## @solana/kit 4.0.0

Runner: OFFICIAL Raven runner (node --permission), report `reports/official/official-TP_KIT_4_0_0.json`

| vector | category | expected | observed | status | classification | raw decoder message |
|---|---|---|---|---|---|---|
| V01_valid_legacy | structural | ACCEPT/"legacy" | ACCEPT/"legacy" | PASS | PASS | decoder_returned |
| V02_valid_v0 | structural | ACCEPT/0 | ACCEPT/0 | PASS | PASS | decoder_returned |
| V03_valid_v1 | structural | ACCEPT/1 | REJECT/null | DIVERGENT | EXPECTED_SCOPE (decoder/API predates or excludes v1) | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 46. |
| V04_valid_v0_with_lookup_table | structural | ACCEPT/0 | ACCEPT/0 | PASS | PASS | decoder_returned |
| V05_valid_legacy_duplicate_account | structural | ACCEPT/"legacy" | ACCEPT/"legacy" | PASS | PASS | decoder_returned |
| V06_truncated_legacy | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 32 bytes, got 19. |
| V07_trailing_bytes_v0 | structural | REJECT/null | ACCEPT/0 | DIVERGENT | EXPECTED_SCOPE, KNOWN (no exact-consumption check; kit issue #1963 closed not_planned) | decoder_returned |
| V08_unsupported_tx_version_2 | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 46. |
| V09_unsupported_message_version_3 | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#5663021:This version of Kit does not support decoding transactions with version 3. The current max supported version is 0. |
| V10_noncanonical_shortvec_sigcount | structural | REJECT/null | ACCEPT/"legacy" | DIVERGENT | DECODER BEHAVIOUR: pre-v1 envelope + accepts non-canonical shortvec 81 00 (see FINDING F1) | decoder_returned |
| V11_inflated_sigcount | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 32 bytes, got 17. |
| V12_v1_duplicate_accounts | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 46. |
| V13_v1_heap_out_of_range | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 46. |
| V14_malformed_base64 | prelude | REJECT/null | REJECT/null | PASS | PRELUDE_ROW | adapter:malformed_base64 |
| V15_malformed_input_shape | prelude | REJECT/null | REJECT/null | PASS | PRELUDE_ROW | adapter:malformed_input:keys |
| V15_unexpected_input_key | prelude | REJECT/null | REJECT/null | PASS | PRELUDE_ROW | adapter:malformed_input:keys |
| V16_valid_v1_two_instructions | structural | ACCEPT/1 | REJECT/null | DIVERGENT | EXPECTED_SCOPE (decoder/API predates or excludes v1) | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 44. |
| V17_v1_interleaved_layout | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 44. |
| V18_v1_header_req_sig_gt_accounts | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 44. |
| V19_legacy_signature_count_mismatch | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#5663017:The transaction message expected the transaction to have 1 signatures, got 2. |
| V20_v1_account_index_out_of_bounds | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 44. |
| V21_v1_size_cap_exceeded | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 40. |
| V22_legacy_size_cap_exceeded | sanitize/policy | REJECT/null | ACCEPT/"legacy" | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V23_v1_ro_signed_equals_req_sig | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 44. |
| V24_v1_instructions_cap | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 12. |
| V25_v1_signatures_cap | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 12. |
| V26_v1_addresses_cap | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 12. |
| LAB01_legacy_unsigned_overflow | sanitize/policy | REJECT/null | ACCEPT/"legacy" | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| LAB02_v1_unsigned_overflow | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 46. |
| LAB03_v1_required_accounts | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 46. |

## @solana/kit 3.0.3

Runner: OFFICIAL Raven runner (node --permission), report `reports/official/official-TP_KIT_3_0_3.json`

| vector | category | expected | observed | status | classification | raw decoder message |
|---|---|---|---|---|---|---|
| V01_valid_legacy | structural | ACCEPT/"legacy" | ACCEPT/"legacy" | PASS | PASS | decoder_returned |
| V02_valid_v0 | structural | ACCEPT/0 | ACCEPT/0 | PASS | PASS | decoder_returned |
| V03_valid_v1 | structural | ACCEPT/1 | REJECT/null | DIVERGENT | EXPECTED_SCOPE (decoder/API predates or excludes v1) | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 46. |
| V04_valid_v0_with_lookup_table | structural | ACCEPT/0 | ACCEPT/0 | PASS | PASS | decoder_returned |
| V05_valid_legacy_duplicate_account | structural | ACCEPT/"legacy" | ACCEPT/"legacy" | PASS | PASS | decoder_returned |
| V06_truncated_legacy | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 32 bytes, got 19. |
| V07_trailing_bytes_v0 | structural | REJECT/null | ACCEPT/0 | DIVERGENT | EXPECTED_SCOPE, KNOWN (no exact-consumption check; kit issue #1963 closed not_planned) | decoder_returned |
| V08_unsupported_tx_version_2 | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 46. |
| V09_unsupported_message_version_3 | structural | REJECT/null | ACCEPT/3 | DIVERGENT | KNOWN, FIXED UPSTREAM (kit PR #871, released in 4.0.0) | decoder_returned |
| V10_noncanonical_shortvec_sigcount | structural | REJECT/null | ACCEPT/"legacy" | DIVERGENT | DECODER BEHAVIOUR: pre-v1 envelope + accepts non-canonical shortvec 81 00 (see FINDING F1) | decoder_returned |
| V11_inflated_sigcount | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 32 bytes, got 17. |
| V12_v1_duplicate_accounts | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 46. |
| V13_v1_heap_out_of_range | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 46. |
| V14_malformed_base64 | prelude | REJECT/null | REJECT/null | PASS | PRELUDE_ROW | adapter:malformed_base64 |
| V15_malformed_input_shape | prelude | REJECT/null | REJECT/null | PASS | PRELUDE_ROW | adapter:malformed_input:keys |
| V15_unexpected_input_key | prelude | REJECT/null | REJECT/null | PASS | PRELUDE_ROW | adapter:malformed_input:keys |
| V16_valid_v1_two_instructions | structural | ACCEPT/1 | REJECT/null | DIVERGENT | EXPECTED_SCOPE (decoder/API predates or excludes v1) | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 44. |
| V17_v1_interleaved_layout | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 44. |
| V18_v1_header_req_sig_gt_accounts | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 44. |
| V19_legacy_signature_count_mismatch | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#5663017:The transaction message expected the transaction to have $signerAddressesLength signatures, got 2. |
| V20_v1_account_index_out_of_bounds | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 44. |
| V21_v1_size_cap_exceeded | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 40. |
| V22_legacy_size_cap_exceeded | sanitize/policy | REJECT/null | ACCEPT/"legacy" | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V23_v1_ro_signed_equals_req_sig | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 44. |
| V24_v1_instructions_cap | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 12. |
| V25_v1_signatures_cap | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 12. |
| V26_v1_addresses_cap | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 12. |
| LAB01_legacy_unsigned_overflow | sanitize/policy | REJECT/null | ACCEPT/"legacy" | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| LAB02_v1_unsigned_overflow | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 46. |
| LAB03_v1_required_accounts | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:SolanaError#8078001:Codec [fixCodecSize] expected 64 bytes, got 46. |

## @solana/web3.js 1.99.0 VersionedTransaction.deserialize

Runner: OFFICIAL Raven runner (node --permission), report `reports/official/official-TP_WEB3_1_99_0_VERSIONED.json`

| vector | category | expected | observed | status | classification | raw decoder message |
|---|---|---|---|---|---|---|
| V01_valid_legacy | structural | ACCEPT/"legacy" | ACCEPT/"legacy" | PASS | PASS | decoder_returned |
| V02_valid_v0 | structural | ACCEPT/0 | ACCEPT/0 | PASS | PASS | decoder_returned |
| V03_valid_v1 | structural | ACCEPT/1 | ACCEPT/1 | PASS | PASS | decoder_returned |
| V04_valid_v0_with_lookup_table | structural | ACCEPT/0 | ACCEPT/0 | PASS | PASS | decoder_returned |
| V05_valid_legacy_duplicate_account | structural | ACCEPT/"legacy" | ACCEPT/"legacy" | PASS | PASS | decoder_returned |
| V06_truncated_legacy | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:Error:Reached end of buffer unexpectedly |
| V07_trailing_bytes_v0 | structural | REJECT/null | ACCEPT/0 | DIVERGENT | EXPECTED_SCOPE (no exact-consumption check on this path) | decoder_returned |
| V08_unsupported_tx_version_2 | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:Error:Reached end of buffer unexpectedly |
| V09_unsupported_message_version_3 | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:Error:Transaction message version 3 deserialization is not supported |
| V10_noncanonical_shortvec_sigcount | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:Error:Unexpected bits set in the transaction config mask |
| V11_inflated_sigcount | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:Error:Reached end of buffer unexpectedly |
| V12_v1_duplicate_accounts | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V13_v1_heap_out_of_range | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V14_malformed_base64 | prelude | REJECT/null | REJECT/null | PASS | PRELUDE_ROW | adapter:malformed_base64 |
| V15_malformed_input_shape | prelude | REJECT/null | REJECT/null | PASS | PRELUDE_ROW | adapter:malformed_input:keys |
| V15_unexpected_input_key | prelude | REJECT/null | REJECT/null | PASS | PRELUDE_ROW | adapter:malformed_input:keys |
| V16_valid_v1_two_instructions | structural | ACCEPT/1 | ACCEPT/1 | PASS | PASS | decoder_returned |
| V17_v1_interleaved_layout | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:Error:Expected no bytes to remain after deserializing a version 1 message |
| V18_v1_header_req_sig_gt_accounts | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:Error:Expected transaction to have enough bytes for its signatures |
| V19_legacy_signature_count_mismatch | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:Error:Expected signatures length to be equal to the number of required signatures |
| V20_v1_account_index_out_of_bounds | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V21_v1_size_cap_exceeded | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V22_legacy_size_cap_exceeded | sanitize/policy | REJECT/null | ACCEPT/"legacy" | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V23_v1_ro_signed_equals_req_sig | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V24_v1_instructions_cap | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V25_v1_signatures_cap | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V26_v1_addresses_cap | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| LAB01_legacy_unsigned_overflow | sanitize/policy | REJECT/null | ACCEPT/"legacy" | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| LAB02_v1_unsigned_overflow | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| LAB03_v1_required_accounts | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |

## @solana/web3.js 1.99.0 Transaction.from (secondary, legacy-only API)

Runner: OFFICIAL Raven runner (node --permission), report `reports/official/official-TP_WEB3_1_99_0_LEGACY.json`

| vector | category | expected | observed | status | classification | raw decoder message |
|---|---|---|---|---|---|---|
| V01_valid_legacy | structural | ACCEPT/"legacy" | ACCEPT/"legacy" | PASS | PASS | decoder_returned |
| V02_valid_v0 | structural | ACCEPT/0 | REJECT/null | DIVERGENT | EXPECTED_SCOPE (legacy-only API) | decoder_threw:Error:Versioned messages must be deserialized with VersionedMessage.deserialize() |
| V03_valid_v1 | structural | ACCEPT/1 | REJECT/null | DIVERGENT | EXPECTED_SCOPE (decoder/API predates or excludes v1) | decoder_threw:Error:Reached end of buffer unexpectedly |
| V04_valid_v0_with_lookup_table | structural | ACCEPT/0 | REJECT/null | DIVERGENT | EXPECTED_SCOPE (legacy-only API) | decoder_threw:Error:Versioned messages must be deserialized with VersionedMessage.deserialize() |
| V05_valid_legacy_duplicate_account | structural | ACCEPT/"legacy" | ACCEPT/"legacy" | PASS | PASS | decoder_returned |
| V06_truncated_legacy | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:Error:Reached end of buffer unexpectedly |
| V07_trailing_bytes_v0 | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:Error:Versioned messages must be deserialized with VersionedMessage.deserialize() |
| V08_unsupported_tx_version_2 | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:Error:Reached end of buffer unexpectedly |
| V09_unsupported_message_version_3 | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:Error:Versioned messages must be deserialized with VersionedMessage.deserialize() |
| V10_noncanonical_shortvec_sigcount | structural | REJECT/null | ACCEPT/"legacy" | DIVERGENT | DECODER BEHAVIOUR: pre-v1 envelope + accepts non-canonical shortvec 81 00 (see FINDING F1) | decoder_returned |
| V11_inflated_sigcount | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:Error:Reached end of buffer unexpectedly |
| V12_v1_duplicate_accounts | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:Error:Reached end of buffer unexpectedly |
| V13_v1_heap_out_of_range | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:Error:Reached end of buffer unexpectedly |
| V14_malformed_base64 | prelude | REJECT/null | REJECT/null | PASS | PRELUDE_ROW | adapter:malformed_base64 |
| V15_malformed_input_shape | prelude | REJECT/null | REJECT/null | PASS | PRELUDE_ROW | adapter:malformed_input:keys |
| V15_unexpected_input_key | prelude | REJECT/null | REJECT/null | PASS | PRELUDE_ROW | adapter:malformed_input:keys |
| V16_valid_v1_two_instructions | structural | ACCEPT/1 | REJECT/null | DIVERGENT | EXPECTED_SCOPE (decoder/API predates or excludes v1) | decoder_threw:Error:Reached end of buffer unexpectedly |
| V17_v1_interleaved_layout | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:Error:Reached end of buffer unexpectedly |
| V18_v1_header_req_sig_gt_accounts | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:Error:Reached end of buffer unexpectedly |
| V19_legacy_signature_count_mismatch | sanitize/policy | REJECT/null | ACCEPT/"legacy" | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V20_v1_account_index_out_of_bounds | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:Error:Reached end of buffer unexpectedly |
| V21_v1_size_cap_exceeded | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:Error:Reached end of buffer unexpectedly |
| V22_legacy_size_cap_exceeded | sanitize/policy | REJECT/null | ACCEPT/"legacy" | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V23_v1_ro_signed_equals_req_sig | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:Error:Reached end of buffer unexpectedly |
| V24_v1_instructions_cap | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:Error:Reached end of buffer unexpectedly |
| V25_v1_signatures_cap | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:Error:Reached end of buffer unexpectedly |
| V26_v1_addresses_cap | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:Error:Reached end of buffer unexpectedly |
| LAB01_legacy_unsigned_overflow | sanitize/policy | REJECT/null | ACCEPT/"legacy" | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| LAB02_v1_unsigned_overflow | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:Error:Reached end of buffer unexpectedly |
| LAB03_v1_required_accounts | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:Error:Reached end of buffer unexpectedly |

## solders 0.29.0 VersionedTransaction.from_bytes (OUTSIDE official runner)

Runner: OUTSIDE official runner (harness/run_outside.mjs), report `reports/outside/SOLDERS_0_29_0.json`

| vector | category | expected | observed | status | classification | raw decoder message |
|---|---|---|---|---|---|---|
| V01_valid_legacy | structural | ACCEPT/"legacy" | ACCEPT/"legacy" | PASS | PASS | decoder_returned |
| V02_valid_v0 | structural | ACCEPT/0 | ACCEPT/0 | PASS | PASS | decoder_returned |
| V03_valid_v1 | structural | ACCEPT/1 | ACCEPT/1 | PASS | PASS | decoder_returned |
| V04_valid_v0_with_lookup_table | structural | ACCEPT/0 | ACCEPT/0 | PASS | PASS | decoder_returned |
| V05_valid_legacy_duplicate_account | structural | ACCEPT/"legacy" | ACCEPT/"legacy" | PASS | PASS | decoder_returned |
| V06_truncated_legacy | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:ValueError:Attempting to read 96 bytes |
| V07_trailing_bytes_v0 | structural | REJECT/null | ACCEPT/0 | DIVERGENT | EXPECTED_SCOPE (no exact-consumption check on this path) | decoder_returned |
| V08_unsupported_tx_version_2 | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:ValueError:Custom error: invalid transaction discriminator |
| V09_unsupported_message_version_3 | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:ValueError:Invalid tag encoding: 3 |
| V10_noncanonical_shortvec_sigcount | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:ValueError:Invalid value: invalid transaction config mask |
| V11_inflated_sigcount | structural | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:ValueError:Invalid value: short u16: non-canonical encoding |
| V12_v1_duplicate_accounts | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V13_v1_heap_out_of_range | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V14_malformed_base64 | prelude | REJECT/null | REJECT/null | PASS | PRELUDE_ROW | adapter:malformed_base64 |
| V15_malformed_input_shape | prelude | REJECT/null | REJECT/null | PASS | PRELUDE_ROW | adapter:malformed_input:keys |
| V15_unexpected_input_key | prelude | REJECT/null | REJECT/null | PASS | PRELUDE_ROW | adapter:malformed_input:keys |
| V16_valid_v1_two_instructions | structural | ACCEPT/1 | ACCEPT/1 | PASS | PASS | decoder_returned |
| V17_v1_interleaved_layout | structural | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (no exact-consumption check on this path) | decoder_returned |
| V18_v1_header_req_sig_gt_accounts | sanitize/policy | REJECT/null | REJECT/null | PASS | PASS | decoder_threw:ValueError:Attempting to read 256 bytes |
| V19_legacy_signature_count_mismatch | sanitize/policy | REJECT/null | ACCEPT/"legacy" | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V20_v1_account_index_out_of_bounds | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V21_v1_size_cap_exceeded | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V22_legacy_size_cap_exceeded | sanitize/policy | REJECT/null | ACCEPT/"legacy" | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V23_v1_ro_signed_equals_req_sig | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V24_v1_instructions_cap | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V25_v1_signatures_cap | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| V26_v1_addresses_cap | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| LAB01_legacy_unsigned_overflow | sanitize/policy | REJECT/null | ACCEPT/"legacy" | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| LAB02_v1_unsigned_overflow | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |
| LAB03_v1_required_accounts | sanitize/policy | REJECT/null | ACCEPT/1 | DIVERGENT | EXPECTED_SCOPE (sanitize/size/cap rule; decoder does not claim to enforce) | decoder_returned |

