# Midnight reference dApps

Small, readable dApps written in Compact for the Midnight network. Each one is built to be read, run and broken on purpose.

Every dApp here has the same shape: one contract, tests that run in memory in under a second, tests that run on a local Midnight network with real zero-knowledge proofs, and a README that states what the contract does not do.

## The dApps

| dApp | What it shows | Status |
|---|---|---|
| [agent-passport](agent-passport/) | An AI agent proves it is backed by an enrolled human, without revealing which human. Merkle membership proof, nullifiers, per-contract domain separation. | 25 tests pass. Runs on a local network. Not on a public network. Not audited. |

More will be added. The build is being documented as it happens: see [docs/build-log.md](docs/build-log.md).

## Read this first

- Nothing here is audited. Do not put it in front of real users or real value.
- Nothing here is deployed to Preview, Preprod or mainnet. "Runs on a local network" means a single node in Docker on one machine.
- The toolchain moves quickly. These were built against Compact compiler 0.36.0 and Midnight.js 5.0.0. If your versions differ, expect to change imports.

## Toolchain

- Node 22, npm 11.10 or later
- Compact CLI 0.5.3, compiler 0.36.0, `pragma language_version 0.28`
- Midnight.js 5.0.0
- Docker with Compose, for the local network
- On Windows, use WSL2. The Compact toolchain does not run natively on Windows.

## Credit and licence

Patterns, the test harness and the local-network setup are adapted from [midnightntwrk/midnight-examples](https://github.com/midnightntwrk/midnight-examples) (Apache-2.0, Midnight Foundation). Each dApp's README says exactly what was borrowed.

Apache-2.0. See [LICENSE](LICENSE).
