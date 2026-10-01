#!/usr/bin/env node
/**
 * Offline transaction wire decode via a pinned published @solana/kit bundle.
 * Projection matches the released solana-kit-tx-decode adapter.
 * NOT a reimplementation. Distinct from signature checking, tx safety, RPC, confirmation.
 *
 * Protocol: stdin JSON {schema, input_base64} → stdout JSON parser result; exit 0 on
 * documented ACCEPT/REJECT. Unknown / internal / projection failures exit non-zero
 * (RUN_ERROR upstream) — never mapped to REJECT via message regex.
 */
import {
  getTransactionDecoder,
  getCompiledTransactionMessageDecoder,
  isSolanaError,
} from './bundle.mjs';
import { helperMarker } from './helpers.mjs';

/**
 * Input-refusal allowlist: ONLY codes demonstrated to arise from malformed bytes
 * during supported decode calls (getTransactionDecoder().decode /
 * getCompiledTransactionMessageDecoder().decode) against truncated/empty/
 * malformed fixtures on @solana/errors@2.x as shipped with @solana/kit@8.3.0.
 *
 * Construction / encoder-only / encoder-decoder pairing faults are EXCLUDED —
 * notably 8078004 ENCODER_DECODER_SIZE_COMPATIBILITY_MISMATCH (thrown from
 * @solana/codecs-core combine-codec when encoder/decoder sizes disagree at
 * construction time, NOT from decoding input bytes).
 *
 * Source justification (installed package @solana/errors):
 *   8078000 SOLANA_ERROR__CODECS__CANNOT_DECODE_EMPTY_BYTE_ARRAY
 *   8078001 SOLANA_ERROR__CODECS__INVALID_BYTE_LENGTH
 *   5663004 SOLANA_ERROR__TRANSACTION__VERSION_NUMBER_OUT_OF_RANGE
 *   5663021 SOLANA_ERROR__TRANSACTION__VERSION_NUMBER_NOT_SUPPORTED
 *   5663023 SOLANA_ERROR__TRANSACTION__MALFORMED_MESSAGE_BYTES
 *   5663025 SOLANA_ERROR__TRANSACTION__CANNOT_DECODE_EMPTY_TRANSACTION_BYTES
 *   5663027 SOLANA_ERROR__TRANSACTION__SIGNATURE_COUNT_TOO_HIGH_FOR_TRANSACTION_BYTES
 *
 * The entire CODECS numeric range is NOT an input whitelist.
 */
const INPUT_DECODE_REFUSAL_CODES = Object.freeze({
  8078000: 'SOLANA_ERROR__CODECS__CANNOT_DECODE_EMPTY_BYTE_ARRAY',
  8078001: 'SOLANA_ERROR__CODECS__INVALID_BYTE_LENGTH',
  5663004: 'SOLANA_ERROR__TRANSACTION__VERSION_NUMBER_OUT_OF_RANGE',
  5663021: 'SOLANA_ERROR__TRANSACTION__VERSION_NUMBER_NOT_SUPPORTED',
  5663023: 'SOLANA_ERROR__TRANSACTION__MALFORMED_MESSAGE_BYTES',
  5663025: 'SOLANA_ERROR__TRANSACTION__CANNOT_DECODE_EMPTY_TRANSACTION_BYTES',
  5663027: 'SOLANA_ERROR__TRANSACTION__SIGNATURE_COUNT_TOO_HIGH_FOR_TRANSACTION_BYTES',
});

function isDocumentedInputDecodeError(e) {
  if (!isSolanaError(e)) return false;
  const code = e.context && e.context.__code;
  return typeof code === 'number' && Object.prototype.hasOwnProperty.call(INPUT_DECODE_REFUSAL_CODES, code);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    process.stdin.on('data', (c) => {
      total += c.length;
      if (total > 64 * 1024) {
        reject(Object.assign(new Error('stdin too large'), { fatal: true }));
        return;
      }
      chunks.push(c);
    });
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

function toPlainBytes(u8) {
  return { $type: 'bytes', encoding: 'base64', data: Buffer.from(u8).toString('base64') };
}

function signaturesToPlain(sigs) {
  const out = {};
  for (const [k, v] of Object.entries(sigs)) {
    out[k] = v == null ? null : toPlainBytes(v);
  }
  return out;
}

function messageToPlain(msg) {
  return {
    version: msg.version,
    header: {
      numSignerAccounts: msg.header.numSignerAccounts,
      numReadonlySignerAccounts: msg.header.numReadonlySignerAccounts,
      numReadonlyNonSignerAccounts: msg.header.numReadonlyNonSignerAccounts,
    },
    staticAccounts: [...msg.staticAccounts],
    lifetimeToken: msg.lifetimeToken,
    instructions: msg.instructions.map((ix) => ({
      programAddressIndex: ix.programAddressIndex,
      accountIndices: [...(ix.accountIndices || [])],
      data: toPlainBytes(ix.data),
    })),
    ...(msg.addressTableLookups
      ? {
          addressTableLookups: msg.addressTableLookups.map((l) => ({
            lookupTableAddress: l.lookupTableAddress,
            writableIndexes: [...(l.writableIndexes || [])],
            readonlyIndexes: [...(l.readonlyIndexes || [])],
          })),
        }
      : {}),
  };
}

function reject(reason, version = null) {
  return { decision: 'REJECT', version, reason, decoded: null };
}

function accept(version, decoded, reason) {
  return { decision: 'ACCEPT', version, reason, decoded };
}

async function main() {
  // Touch local helper so it is part of executed closure (C1 local helper binding).
  if (typeof helperMarker() !== 'string') {
    console.error('local helper failed');
    process.exit(1);
  }

  const raw = await readStdin();
  let req;
  try {
    req = JSON.parse(raw.trim());
  } catch {
    console.error('invalid stdin json');
    process.exit(2);
  }
  if (!req || req.schema !== 'raven-replay-adapter-stdin/1' || typeof req.input_base64 !== 'string') {
    console.error('invalid stdin schema');
    process.exit(2);
  }

  let bytes;
  try {
    bytes = Uint8Array.from(Buffer.from(req.input_base64, 'base64'));
    if (Buffer.from(bytes).toString('base64') !== req.input_base64) throw new Error('noncanonical');
  } catch {
    process.stdout.write(JSON.stringify(reject('invalid_input_base64')) + '\n');
    return;
  }
  if (bytes.length === 0) {
    process.stdout.write(JSON.stringify(reject('empty_input')) + '\n');
    return;
  }

  // Construct decoders OUTSIDE the input-refusal catch so construction / encoder
  // pairing faults (e.g. 8078004) become RUN_ERROR, never REJECT baselines.
  let txDecoder;
  let messageDecoder;
  try {
    txDecoder = getTransactionDecoder();
    messageDecoder = getCompiledTransactionMessageDecoder();
  } catch (e) {
    console.error('decoder construction failure:', e && e.name, e && e.message);
    process.exit(1);
  }

  let tx;
  try {
    tx = txDecoder.decode(bytes);
  } catch (e) {
    if (isDocumentedInputDecodeError(e)) {
      const code = e.context.__code;
      const name = INPUT_DECODE_REFUSAL_CODES[code];
      process.stdout.write(JSON.stringify(reject('sdk_decode_refused:code=' + code + ':' + name)) + '\n');
      return;
    }
    console.error('unexpected decode error:', e && e.name, e && e.message);
    process.exit(1);
  }

  let msg;
  try {
    msg = messageDecoder.decode(tx.messageBytes);
  } catch (e) {
    if (isDocumentedInputDecodeError(e)) {
      const code = e.context.__code;
      const name = INPUT_DECODE_REFUSAL_CODES[code];
      process.stdout.write(JSON.stringify(reject('sdk_message_decode_refused:code=' + code + ':' + name)) + '\n');
      return;
    }
    console.error('unexpected message decode error:', e && e.name, e && e.message);
    process.exit(1);
  }

  // Projection / assembly failures → non-zero (RUN_ERROR), never REJECT.
  try {
    const version = msg.version;
    if (!(version === 'legacy' || version === 0)) {
      process.stdout.write(JSON.stringify(reject('unsupported_transaction_version:' + String(version))) + '\n');
      return;
    }
    const decoded = {
      wire: {
        messageBytes: toPlainBytes(tx.messageBytes),
        signatures: signaturesToPlain(tx.signatures),
      },
      message: messageToPlain(msg),
      sdk: {
        package: '@solana/kit',
        api: ['getTransactionDecoder', 'getCompiledTransactionMessageDecoder'],
        scope: 'offline_wire_and_compiled_message_decode',
        helper: helperMarker(),
        not_included: [
          'signature_verification',
          'transaction_safety',
          'rpc',
          'confirmation',
          'instruction_semantic_interpretation',
        ],
      },
    };
    process.stdout.write(
      JSON.stringify(accept(version, decoded, version === 'legacy' ? 'ok:legacy_wire_decode' : 'ok:v0_wire_decode')) + '\n',
    );
  } catch (e) {
    console.error('projection failure:', e && e.name, e && e.message);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
