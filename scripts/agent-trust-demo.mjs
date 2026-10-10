// Run the retained signed-receipt fixtures through the real pinned verifier.
// Print the pair only when both expected outcomes have been measured.
try {
  const { runMachineExchange } = await import(
    "../apps/worldsfair-agent-trust/src/lib/runSlice.js"
  );
  const valid = await runMachineExchange("path_a_verified");
  const tampered = await runMachineExchange("path_b_tampered");
  if (valid.outcome !== "PROCEED") throw new Error("valid_receipt_did_not_proceed");
  if (tampered.outcome !== "REFUSE") throw new Error("tampered_receipt_not_refused");
  console.log("Valid receipt: PROCEED\nOne-field tamper: REFUSE");
} catch {
  console.error(
    "Agent Trust demo did not complete. Use Node 22.18.0, initialize the pinned git submodule, and keep the supplied fixtures unchanged.",
  );
  process.exitCode = 1;
}
