# Colosseum card copy — prepared, not applied

Uses the same pitch and two demonstrations as JUDGE_START_HERE.md. No portal submission is recorded by this change. Paste the selected copy only after review; retain the existing pre-Fair attribution in its disclosure field.

## What are you building (under 1,000 characters)

Raven checks how Solana transaction readers handle tricky bytes, and lets an agent verify a signed receipt offline before it acts.

Try Conformance with nothing to install: our deliberately broken reader matches 27 of 30 rows; V03 and V16 are new v1 transactions, and V10 is a non-canonical length. The reference matches 30/30, and its unsigned report replays.

Then run the offline Agent Trust fixture: a valid receipt gives PROCEED; changing one finding code without resigning gives REFUSE. It uses a pinned verifier and deterministic fixture, not live Solana acquisition.

The hosted page runs Raven-owned readers. A team's decoder needs a local adapter. A match is not a safety verdict. No paying customer or completed outside pilot is claimed.

Characters: 748.

## Brief description (under 500 characters)

Raven checks Solana transaction readers against tricky bytes and lets an agent verify a signed receipt offline before acting. Try the 30-row Conformance demo, then the Agent Trust PROCEED/REFUSE fixture. Conformance reports are unsigned; the offline receipt fixture is signed. Matches are not safety verdicts.

Characters: 309.

## Pre-existing work disclosure

Raven's receipt/verifier foundation, public trust anchors and BONK receipt fixture predate the Fair. The pinned public verifier is a referenced foundation, not new Fair work. The Fair surface adds agent orchestration, Conformance and judge-facing demonstrations. Reviews are internal and bounded, not external audits. Preserve the detailed component attribution in README.md and the provenance manifest.
