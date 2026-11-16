// SPDX-License-Identifier: Apache-2.0
//
// The whole flow against a real local Midnight network: node, indexer and
// proof server from compose.yml. Every call here builds a zero-knowledge
// proof, submits a transaction and waits for the indexer to show it.
//
//   npm run compile && npm run env:up && npm run test:devnet
//
// One genesis-funded wallet pays the fees for everyone. The issuer, the humans
// and the agent are told apart by the secret in their private state, exactly
// as the contract tells them apart.
import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import pino from 'pino';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { deployContract, submitCallTx, type DeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime';
import { type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { MidnightWalletProvider, resolveWallet, syncWallet, waitForDust } from '../wallet.js';
import { getConfig } from '../config.js';
import { buildProviders, ledgerState, type PassportCircuits, type PassportProviders } from '../providers.js';
import { createPrivateState, type PassportPrivateState } from '../../contract/witnesses.js';
import { CompiledPassportContract, Contract, ledger, pureCircuits, zkConfigPath } from '../../contract/index.js';
import { assertNotInPublicState } from './sim.js';

// Required for GraphQL subscriptions in Node.js
// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

const newSecret = (): Uint8Array => new Uint8Array(randomBytes(32));
const short = (u: Uint8Array): string => `${Buffer.from(u).toString('hex').slice(0, 12)}…`;

const ISSUER_SK = newSecret();
const HUMAN_SKS = [newSecret(), newSecret(), newSecret()];
const AGENT_SK = newSecret();
const STRANGER_SK = newSecret();
const AGENT_PK = pureCircuits.agentKey(AGENT_SK);
const CHALLENGE = newSecret();

// One private-state id per identity.
const ISSUER = 'issuer';
const HUMAN = 'human-1';
const AGENT = 'agent';
const STRANGER = 'stranger';

const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info', transport: { target: 'pino-pretty' } });
const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';

describe(`Agent Passport (${network} network, real proofs)`, () => {
  let wallet: MidnightWalletProvider;
  let providers: PassportProviders;
  let contractAddress: ContractAddress;
  const config = getConfig();
  const timings: { step: string; seconds: number; block: number }[] = [];

  const queryLedger = async () => {
    const state = await providers.publicDataProvider.queryContractState(contractAddress);
    return ledger(ledgerState(state));
  };

  const setPrivateState = (id: string, state: PassportPrivateState) =>
    providers.privateStateProvider.forContract(contractAddress).set(id, state);

  /** Proves, submits and waits for one circuit call; logs how long it took. */
  const call = async (privateStateId: string, circuitId: PassportCircuits, args: unknown[]) => {
    const started = Date.now();
    const tx = await submitCallTx(providers, {
      compiledContract: CompiledPassportContract,
      contractAddress,
      privateStateId,
      circuitId,
      args,
    } as never);
    const seconds = (Date.now() - started) / 1000;
    const pub = (tx as { public: { txId: string; blockHeight: number } }).public;
    timings.push({ step: circuitId, seconds, block: pub.blockHeight });
    logger.info(`${circuitId}: block ${pub.blockHeight}, ${seconds.toFixed(1)}s, tx ${String(pub.txId).slice(0, 16)}…`);
    return tx;
  };

  beforeAll(async () => {
    setNetworkId(config.networkId);
    const envConfig: EnvironmentConfiguration = { walletNetworkId: config.networkId, ...config };
    const setup = resolveWallet(network);
    wallet = await MidnightWalletProvider.build(logger, envConfig, setup.secret);
    await wallet.start();
    await syncWallet(logger, wallet.wallet, 10 * 60_000);
    // Genesis DUST is worth 0 until the first block after genesis.
    await waitForDust(logger, wallet.wallet, 1, 10 * 60_000, config.indexer);
    providers = buildProviders(wallet, zkConfigPath, config);
  });

  afterAll(async () => {
    if (timings.length > 0) {
      logger.info('Timings (prove + submit + confirm):');
      for (const t of timings) logger.info(`  ${t.step.padEnd(10)} ${t.seconds.toFixed(1).padStart(6)}s  block ${t.block}`);
    }
    if (wallet) await wallet.stop();
  });

  it('deploys the registry with the issuer set', async () => {
    const started = Date.now();
    const deployed: DeployedContract<Contract> = await deployContract(providers, {
      compiledContract: CompiledPassportContract,
      privateStateId: ISSUER,
      initialPrivateState: createPrivateState(ISSUER_SK),
    });
    const pub = deployed.deployTxData.public;
    contractAddress = pub.contractAddress;
    timings.push({ step: 'deploy', seconds: (Date.now() - started) / 1000, block: pub.blockHeight });
    logger.info(`Deployed at ${contractAddress} (block ${pub.blockHeight})`);

    const l = await queryLedger();
    expect(l.issuerPk).toEqual(pureCircuits.issuerKey(ISSUER_SK));
    expect(l.enrolled).toBe(0n);
  });

  it('issuer enrols three humans', async () => {
    for (const sk of HUMAN_SKS) await call(ISSUER, 'enrol', [pureCircuits.holderKey(sk)]);
    expect((await queryLedger()).enrolled).toBe(3n);
  });

  it('refuses an enrolment from someone who is not the issuer', async () => {
    await setPrivateState(STRANGER, createPrivateState(STRANGER_SK));
    await expect(call(STRANGER, 'enrol', [pureCircuits.holderKey(newSecret())])).rejects.toThrow();
  });

  it('a human authorises an agent, and the chain does not learn which human', async () => {
    const before = await queryLedger();
    const holderKeys = HUMAN_SKS.map((sk) => pureCircuits.holderKey(sk));

    await setPrivateState(HUMAN, createPrivateState(HUMAN_SKS[1]!));
    await call(HUMAN, 'authorise', [AGENT_PK, 0n]);

    const l = await queryLedger();
    expect(l.agents.member(AGENT_PK)).toBe(true);
    expect(l.slots.size()).toBe(before.slots.size() + 1n);

    // The slot is keyed by a nullifier only this human can compute.
    const instance = new Uint8Array(Buffer.from(contractAddress, 'hex'));
    const nullifier = pureCircuits.slotNullifier(HUMAN_SKS[1]!, 0n, instance);
    expect(l.slots.lookup(nullifier)).toEqual(AGENT_PK);
    logger.info(`slot nullifier ${short(nullifier)} -> agent ${short(AGENT_PK)}`);

    // What authorise wrote is a nullifier and an agent key. Neither is a
    // holder key, and no secret is anywhere in public state.
    for (const [n, a] of l.slots) {
      for (const hk of holderKeys) {
        expect(Buffer.from(n).equals(Buffer.from(hk))).toBe(false);
        expect(Buffer.from(a).equals(Buffer.from(hk))).toBe(false);
      }
    }
    assertNotInPublicState(l, {
      'issuer secret': ISSUER_SK,
      'human 0 secret': HUMAN_SKS[0]!,
      'human 1 secret': HUMAN_SKS[1]!,
      'human 2 secret': HUMAN_SKS[2]!,
      'agent secret': AGENT_SK,
    });
  });

  it('refuses an authorisation from someone who is not enrolled', async () => {
    await expect(call(STRANGER, 'authorise', [pureCircuits.agentKey(newSecret()), 0n])).rejects.toThrow();
  });

  it('the agent answers a challenge on chain', async () => {
    await setPrivateState(AGENT, createPrivateState(AGENT_SK));
    await call(AGENT, 'attest', [CHALLENGE]);
    expect((await queryLedger()).attestations.lookup(CHALLENGE)).toEqual(AGENT_PK);
  });

  it('refuses an attestation from a key nobody authorised', async () => {
    await expect(call(STRANGER, 'attest', [newSecret()])).rejects.toThrow();
  });

  it('the human revokes the agent, which can then no longer attest', async () => {
    await call(HUMAN, 'revoke', [0n]);
    const l = await queryLedger();
    expect(l.agents.member(AGENT_PK)).toBe(false);
    expect(l.slots.size()).toBe(0n);
    await expect(call(AGENT, 'attest', [newSecret()])).rejects.toThrow();
  });
});
