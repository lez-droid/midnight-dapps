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
