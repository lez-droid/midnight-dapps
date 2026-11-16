# Build log

What was built, in order, including what went wrong. Newest entry last.

## 16 November 2026 - Agent Passport, from nothing to a local network

### What was built

- `agent-passport.compact`: four circuits (`enrol`, `authorise`, `attest`, `revoke`), two witnesses (`secretKey`, `holderPath`).
- 17 in-memory tests. One failing case for every `assert` in the contract, plus checks that no secret and no holder key reaches public state.
- 8 tests against a local Midnight network (node 2.1.101, indexer 4.4.101, proof server 9.0.0), each call with a real proof.

### What the local run measured

One run, one machine (WSL2, 16 cores, 15 GB). Time is prove, submit and wait for the indexer.

| Step | Time | Block |
|---|---|---|
| deploy | about 20 s | 6 |
| `enrol` x3 | 17.2 s, 18.1 s, 17.4 s | 9, 12, 15 |
| `authorise` | 18.6 s | 18 |
| `attest` | 17.8 s | 21 |

Full output: [runs/2026-11-16-devnet-run.txt](runs/2026-11-16-devnet-run.txt).

### What went wrong, and the fix

These cost real time. They are here so they cost you less.

1. **Genesis DUST is worth nothing in the first block.** The genesis wallets on the local network are funded, but their DUST has a value of zero until one block after genesis. A deploy sent straight after start-up fails for lack of fees. Fix: wait for a non-zero DUST balance before the first transaction.
2. **A type cast broke era inference.** Casting the options of `deployContract` with `as never` made TypeScript pick the wrong ledger era, with the error `Ledger8DeployedContract is not assignable to Ledger9DeployedContract`. Fix: remove the cast and let the types flow.
3. **The proof server needs the full compile.** `compact compile --skip-zk` is enough for the in-memory tests. It does not produce proving keys, so the local-network tests need plain `compact compile`.
4. **Rejected calls never reach the chain.** A call the contract refuses fails on the client while the circuit runs, before a proof is built. It returns in well under a second and costs nothing. That is worth knowing when you design error handling.
5. **Windows needs WSL2.** The Compact toolchain and the Docker images were run inside Ubuntu 24.04 on WSL2.

### Design decisions worth arguing with

- **Three agent slots per human, fixed.** The limit is enforced by the nullifier: `hash(label, secret, slot, contract address)` with `slot` range-checked to 0, 1 or 2. A fourth agent has no nullifier it can use.
- **The contract address is inside the nullifier.** The same human in a second deployment gets different nullifiers, so two registries cannot be joined on them.
- **One fee-paying wallet in the tests.** The issuer, the humans and the agent are told apart by the secret in their private state, which is also how the contract tells them apart. On a public network each would pay their own fees, and fee payment is its own privacy question that this dApp does not answer.

### Not done

- No deployment to Preview, Preprod or mainnet.
- No audit.
- No front end.
- The issuer cannot remove a holder.

## 16 November 2026 - Before building a copilot, check what exists

The plan was a "Midnight dev copilot": answers to Compact questions, with citations. Before writing it, a search of what already exists.

### What exists

- [`midnightntwrk/midnight-expert`](https://github.com/midnightntwrk/midnight-expert): official, Apache-2.0. A set of 16 Claude Code plugins covering Compact, the CLI, dApp development, the wallet, the node, the indexer and the proof server. One plugin checks claims by compiling them. macOS and Linux only.
- `midnight-mcp`: a community MCP server that searches the docs and compiles Compact.

So a general copilot built from scratch would repeat work that is already public. That build was stopped.

### One measurement

Does the example code in `midnight-expert` compile on the current compiler? One run, at its head commit of 13 November 2026, with Compact compiler 0.36.0, `compact compile --skip-zk` on each `.compact` file from its own directory.

| Run | Compile | Fail |
|---|---|---|
| As published | 4 of 84 | 80 |
| Version line changed to `pragma language_version 0.28;`, nothing else | 75 of 84 | 9 |

- 77 of the 80 failures are one line: the files pin `pragma language_version 0.23;` and the compiler reports `language version 0.28.0 mismatch`.
- 8 of the 9 that still fail call `ecMulGenerator` with a `Field`. The current standard library declares it for `JubjubScalar`.
- The last one imports a file that is not next to it.

Limits of this measurement: some of these files may be modules or templates never meant to compile alone, and `--skip-zk` checks the language, not the proving keys. It says nothing about the quality of the written guidance, which was not tested.

### What that means for the plan

The gap is not "no copilot". It is version drift in the examples, no Windows path, and no way to ask what was said in the talks and videos. Those are the pieces worth building.

## 17 November 2026 - A copilot for what was said, not what is documented

### What was built

One command that answers a question from video transcripts and links every point to the second it was said.

- Corpus: 318 videos from the Midnight channel and 18 from Charles Hoskinson's channel, already transcribed, chunked and indexed (bge-m3 embeddings, Qdrant, dense plus sparse search).
- Step 1: retrieve the ten closest passages.
- Step 2: a language model drafts short statements. Each must name one passage and copy a quote from it, word for word, at least six words long.
- Step 3: a plain string check. If the quote is not in the cited passage or the passage either side, the statement is deleted. The model does not get a vote.
- Output: the surviving statements, each with its quote and a `youtu.be/...?t=` link, then what the passages did not cover.

### What a first run showed

Four questions, one run each.

| Question | Points kept | Points dropped |
|---|---|---|
| How does DUST get generated from NIGHT, and what is it used for? | 8 | 0 |
| What is a witness in Compact, and how is it different from a circuit? | 8 | 0 |
| What has Charles Hoskinson said about AI agents and Midnight? | 7 | 0 |
| How do I configure a Kubernetes ingress controller for a Solana validator? | 0 | 0 |

All 23 quotes were then checked a second time by a separate verifier that reads the transcripts from disk. None failed.

Two things the docs would not have shown:

- **Two talks disagree on DUST decay.** A developer video of 4 March 2026 says DUST holds at its cap and decays over about a week once the backing NIGHT is spent. A conference booth talk of 7 May 2026 says unused DUST expires after 5 days. The tool reported both with dates. Which one is right is a question for the specification, not the transcripts.
- **"Private" is an assumption.** In a February 2025 call the team says the compiler presumes a witness returns private data but cannot know it.

The off-topic question got no answer and a plain statement that the corpus does not cover it.

### Limits

- The check proves the words were said at that timestamp. It does not prove the summary is fair, or that the speaker was right, or is still right.
- Four questions is a smoke test, not an evaluation.
- Transcripts are auto-captions. Names and terms are sometimes mis-heard.
- Charles Hoskinson's talks are his view and forecast. They are labelled as such when they come from his channel. When he speaks in a video on the Midnight channel, the label depends on the model noticing.
- The corpus and the tool are on one machine. Nothing is hosted and nothing is public yet.
