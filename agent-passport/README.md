# Agent Passport

A Midnight reference dApp. An AI agent proves it is backed by an enrolled human. It does not reveal which human.

One Compact contract, four circuits, 25 tests. 17 run in memory in under a second, with no node, indexer or proof server. 8 run against a local Midnight network and build a real zero-knowledge proof for every call.

## The problem

An agent that books, buys or signs on someone's behalf needs to show a person stands behind it. The usual way is to attach the person's identity to the agent. That turns every agent action into a record about its owner.

This contract splits the two. The registry publishes which agent keys are authorised. It has nowhere to store which holder authorised them.

## How it works

| Who | Circuit | What goes on chain | What stays private |
|---|---|---|---|
| Issuer | `enrol(holderKey)` | The holder key, a hash of the human's secret | The issuer's secret |
| Human | `authorise(agentKey, slot)` | The agent key and a slot nullifier | The human's secret, their holder key, their Merkle path, the slot number |
| Agent | `attest(challenge)` | The challenge and the agent key that answered it | The agent's secret |
| Human | `revoke(slot)` | The nullifier and agent key are removed | The human's secret, the slot number |

`authorise` proves three things in zero knowledge: the caller knows a secret, that secret's holder key is in the Merkle tree of enrolled holders, and the nullifier was derived from the same secret. The verifier learns "one of the enrolled holders did this" and nothing narrower.

Each human has three slots. A nullifier is `hash(label, secret, slot, contract address)`, so:

- a fourth agent is impossible, because slot 3 fails the range check and slots 0 to 2 collide with themselves;
- two slots of the same human cannot be linked to each other;
- the same human in a second deployment gets different nullifiers.

## Limits

Read these before you build on it.

- **The anonymity set is the enrolled holders.** With one holder enrolled, there is no privacy. With ten, an agent is one of ten.
- **Timing leaks.** If a holder is enrolled and an agent appears a minute later, an observer can guess. The contract cannot fix that; the client has to wait.
- **The issuer cannot remove a holder.** A Merkle tree has no delete. A production registry needs a revocation list checked inside `authorise`.
- **Nothing here checks that a holder is a person.** The issuer decides who to enrol. This contract enforces what happens after that decision.
- **Attestations are public and permanent.** A verifier's challenge and the agent key that answered it stay on the ledger.
- **Not audited.** Tested in the simulator and on a local single-node network on one machine. It has not been deployed to Preview, Preprod or mainnet.
- **Each call takes seconds, not milliseconds.** On the local network, one call took 17 to 19 seconds to prove, submit and confirm. See "Run it on a local network".

## Run it

Needs Node 22, npm 11.10 or later, and the Compact toolchain (compiler 0.36.0). On Windows, use WSL.

```bash
npm install
```

```bash
npm run compile:fast
```

```bash
npm test
```

`compile:fast` skips proving-key generation, which the simulator does not need. `npm run compile` builds the keys as well, into `contract/managed/agent-passport/keys`.

## Run it on a local network

This starts a Midnight node, an indexer and a proof server in Docker, deploys the contract, and runs the whole flow with real proofs. Needs Docker with Compose, and about 4 GB of free memory. The first start downloads three images.

```bash
npm run compile
```

```bash
npm run env:up
```

```bash
npm run test:devnet
```

```bash
npm run env:down
```

`npm run compile` must be the full compile, because the proof server needs the proving keys. The network is a throwaway: `env:down` deletes the chain, and the fee-paying wallet is a genesis test wallet with a published seed.

One run on 16 November 2026 (WSL2 on Windows, 16 cores, 15 GB): 8 tests passed in 136 seconds.

| Step | Time to prove, submit and confirm | Block |
|---|---|---|
| deploy | about 20 s | 6 |
| `enrol` (three calls) | 17.2 s, 18.1 s, 17.4 s | 9, 12, 15 |
| `authorise` | 18.6 s | 18 |
| `attest` | 17.8 s | 21 |
| `revoke` | under 17.4 s (the whole test step) | not recorded |

These are single measurements from one machine, and they include waiting for the indexer. They are not a benchmark. The three calls the contract refuses fail on the client before a proof is built, so they return in well under a second.

## Files

- `contract/agent-passport.compact` - the contract.
- `contract/witnesses.ts` - the private inputs: the caller's secret and their Merkle path.
- `contract/index.ts` - binds the compiled contract to its witnesses and keys.
- `src/test/agent-passport.sim.test.ts` - the whole flow, one failing case per `assert`, and the privacy checks.
- `src/test/agent-passport.devnet.test.ts` - the same flow on the local network.
- `src/test/sim.ts` - in-memory harness, copied from `midnightntwrk/midnight-examples`.
- `compose.yml`, `src/config.ts`, `src/wallet.ts`, `src/providers.ts` - the local network and the code that connects to it, adapted from the voting example in `midnightntwrk/midnight-examples`.

## What the tests prove

- Every guard rejects: non-issuer enrolment, duplicate holder, stranger with no path, stranger with a borrowed path, slot out of range, slot in use, agent already authorised, empty slot, someone else's slot, unauthorised agent, reused challenge.
- No secret appears anywhere in public state.
- `authorise` adds exactly two new values to public state, the agent key and the nullifier, and neither is a holder key.
- A proof path still verifies after later enrolments, because the tree keeps its past roots.

## Credit

The membership-proof and nullifier pattern, the test harness, the local-network setup and the wallet and provider code come from the voting example in [midnightntwrk/midnight-examples](https://github.com/midnightntwrk/midnight-examples) (Apache-2.0, Midnight Foundation). Licensed under Apache-2.0.
