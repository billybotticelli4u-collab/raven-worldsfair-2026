/**
 * Deterministic offline fixture generator — raven-solana-txversion-experimental/0
 *
 * Produces REAL serialized Solana transactions (legacy, v0, v1) using
 * @solana/kit 8.3.0 codecs with fixed keys + fixed blockhash. No network.
 * Ed25519 signing is deterministic, so output bytes are reproducible.
 *
 * All key material below is synthetic throwaway material generated for this
 * demo corpus. It controls no accounts and holds no value on any cluster.
 */
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import {
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  setTransactionMessageConfig,
  signTransactionMessageWithSigners,
  address,
  blockhash,
  lamports,
  createKeyPairSignerFromPrivateKeyBytes,
  getTransactionEncoder,
  getTransactionDecoder,
  getCompiledTransactionMessageDecoder,
  getAddressEncoder,
  getBase58Encoder,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";

// ---- deterministic synthetic key material (NOT real wallets) ----
const SEED_PAYER = Buffer.alloc(32, 0x11);
const SEED_DEST = Buffer.alloc(32, 0x22);
const payer = await createKeyPairSignerFromPrivateKeyBytes(SEED_PAYER);
const destSigner = await createKeyPairSignerFromPrivateKeyBytes(SEED_DEST);
const dest = destSigner.address;

// Fixed "recent blockhash": 32 bytes of 0x42 — never on any chain. Synthetic.
// Tiny base58 encoder (Bitcoin alphabet) — bytes → string.
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Encode(bytes) {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  return "1".repeat(zeros) + digits.reverse().map((d) => B58[d]).join("");
}

const FAKE_BLOCKHASH = blockhash(base58Encode(Buffer.alloc(32, 0x42)));

const transfer = getTransferSolInstruction({
  amount: lamports(10_000_000n),
  destination: dest,
  source: payer,
});

function hex(b) {
  return Buffer.from(b).toString("hex");
}

const out = { meta: {}, fixtures: {} };

// ---------- legacy ----------
{
  const message = pipe(
    createTransactionMessage({ version: "legacy" }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: FAKE_BLOCKHASH, lastValidBlockHeight: 0n }, m),
    (m) => appendTransactionMessageInstruction(transfer, m)
  );
  const tx = await signTransactionMessageWithSigners(message);
  const bytes = getTransactionEncoder().encode(tx);
  out.fixtures.legacy_ok = hex(bytes);
}

// ---------- v0 (no lookup tables) ----------
{
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: FAKE_BLOCKHASH, lastValidBlockHeight: 0n }, m),
    (m) => appendTransactionMessageInstruction(transfer, m)
  );
  const tx = await signTransactionMessageWithSigners(message);
  const bytes = getTransactionEncoder().encode(tx);
  out.fixtures.v0_ok = hex(bytes);
}

// ---------- v1 (config fully set) ----------
{
  const message = pipe(
    createTransactionMessage({ version: 1 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: FAKE_BLOCKHASH, lastValidBlockHeight: 0n }, m),
    (m) => appendTransactionMessageInstruction(transfer, m),
    (m) =>
      setTransactionMessageConfig(
        {
          computeUnitLimit: 20_000,
          heapSize: 64 * 1024,
          loadedAccountsDataSizeLimit: 64 * 1024,
          priorityFeeLamports: 5_000n,
        },
        m
      )
  );
  const tx = await signTransactionMessageWithSigners(message);
  const bytes = getTransactionEncoder().encode(tx);
  out.fixtures.v1_ok = hex(bytes);
}

// ---- cross-check: kit's own decoder round-trips each fixture ----
const txDecoder = getTransactionDecoder();
for (const [name, h] of Object.entries(out.fixtures)) {
  const decoded = txDecoder.decode(Buffer.from(h, "hex"));
  const msgDecoder = getCompiledTransactionMessageDecoder();
  const msg = msgDecoder.decode(decoded.messageBytes);
  out.meta[name] = {
    bytes: Buffer.from(h, "hex").length,
    kit_decoded_version: msg.version,
    sha256: createHash("sha256").update(Buffer.from(h, "hex")).digest("hex"),
  };
}

out.meta.provenance = {
  generator: "@solana/kit 8.3.0, offline, deterministic keys+blockhash",
  payer_seed: "32 bytes of 0x11 (synthetic, throwaway)",
  dest_seed: "32 bytes of 0x22 (synthetic, throwaway)",
  blockhash: "32 bytes of 0x42 (synthetic, never a real blockhash)",
  generated_at: new Date().toISOString(),
};
out.meta.payer_address = payer.address;
out.meta.dest_address = dest;


writeFileSync(new URL("./base-fixtures.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out.meta, null, 2));
