# Founder pitch — recording draft, target under two minutes

Not recorded or uploaded by this change. Glen delivers this in his own voice; confirm the live portal time limit before recording. Approximately 231 words.

I'm Glen, building Raven for teams whose software reads Solana transactions, and for agents that need to verify evidence before acting.

A reader can disagree with the rules without crashing. Raven makes that difference visible. In our Conformance demonstration, a deliberately broken reader matches twenty-seven of thirty synthetic rows. Three differ: two new version-one transactions and one non-canonical length. A reference reader matches all thirty. Each result names its row and can be replayed.

The second demonstration is Agent Trust. Agent A receives a signed receipt and verifies it offline using Raven's pinned public verifier. With the valid fixture, its policy says PROCEED. Change one finding code without signing again and it says REFUSE. This is a deterministic fixture, not a live Solana fetch or permission to trade.

The receipt and verifier foundation existed before the Fair. This Fair surface brings the agent exchange and Conformance demonstrations together. Conformance reports themselves are unsigned. A match means agreement with a stated profile, not a safety verdict.

The live page runs our own readers. A team's decoder needs a local adapter and a supervised evaluation. I am not claiming a paying customer or a completed outside pilot. The immediate next test is whether another team can use the same evidence loop on its own reader.

You can try Conformance without installing anything, then run the offline Agent Trust demonstration from the public repository.
