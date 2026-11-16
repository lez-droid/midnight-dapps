// SPDX-License-Identifier: Apache-2.0
//
// Exports the compiled contract for use against a real network. The imports
// resolve against contract/managed/agent-passport, which `npm run compile`
// generates (gitignored). The network needs the full compile, with proving
// keys: `compile:fast` output is only enough for the in-memory tests.
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-js';
import path from 'node:path';

export {
  Contract,
  ledger,
  pureCircuits,
  type Witnesses,
  type Ledger,
  type ImpureCircuits,
  type PureCircuits,
} from './managed/agent-passport/contract/index.js';
import { Contract } from './managed/agent-passport/contract/index.js';
import { witnesses } from './witnesses.js';

const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');
export const zkConfigPath = path.resolve(currentDir, 'managed', 'agent-passport');

export const CompiledPassportContract = CompiledContract.make('AgentPassport', Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);
