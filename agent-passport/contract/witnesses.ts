// SPDX-License-Identifier: Apache-2.0
//
// TypeScript side of the contract's witnesses: the private inputs a circuit
// asks for. Each witness returns [nextPrivateState, value]. Nothing returned
// here goes on chain unless the circuit discloses it.
//
// Keep this file free of node:* imports so it also runs in a browser.
import { type Ledger, type Witnesses } from './managed/agent-passport/contract/index.js';

// One 32-byte secret per participant. The issuer, each human and each agent
// hold their own; the contract hashes it with a different label per role.
export type PassportPrivateState = {
  readonly secretKey: Uint8Array;
};

export const createPrivateState = (secretKey: Uint8Array): PassportPrivateState => {
  if (secretKey.length !== 32) throw new Error('secretKey must be 32 bytes');
  return { secretKey };
};

export const witnesses: Witnesses<PassportPrivateState> = {
  secretKey: ({ privateState }) => [privateState, privateState.secretKey],
  // The path is looked up in the ledger state the circuit runs against, so it
  // matches a root the contract knows.
  holderPath: ({ privateState, ledger }, pk) => {
    const path = ledger.holders.findPathForLeaf(pk);
    if (path === undefined) throw new Error('This holder key is not enrolled');
    return [privateState, path];
  },
};

export type { Ledger, Witnesses };
