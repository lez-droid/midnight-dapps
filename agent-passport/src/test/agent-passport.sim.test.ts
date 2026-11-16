// SPDX-License-Identifier: Apache-2.0
//
// In-memory tests: the compiled contract runs with compact-runtime, with no
// node, indexer or proof server. `npm run compile:fast && npm test`.
//
// Every assert in the contract has a test that trips it, and the privacy
// claims in the README are checked against the public ledger.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Sim, assertNotInPublicState, collectPublicBytes, expectRejects } from './sim.js';
import { Contract, ledger, pureCircuits } from '../../contract/managed/agent-passport/contract/index.js';
import { createPrivateState, witnesses, type Witnesses, type PassportPrivateState } from '../../contract/witnesses.js';

const newSecret = (): Uint8Array => new Uint8Array(randomBytes(32));
const hex = (u: Uint8Array): string => Buffer.from(u).toString('hex');

const ISSUER_SK = newSecret();

// A cheating client: when set, the path witness hands over another holder's
// Merkle path instead of the caller's own.
let stealPathOf: Uint8Array | undefined;
const testWitnesses: Witnesses<PassportPrivateState> = {
  ...witnesses,
  holderPath: (ctx, pk) => witnesses.holderPath(ctx, stealPathOf ?? pk),
};

const deploy = () =>
  Sim.deploy({
    contract: new Contract(testWitnesses),
    ledger,
    privateState: createPrivateState(ISSUER_SK),
  });

type PassportSim = Awaited<ReturnType<typeof deploy>>;

/** Makes the next calls come from whoever holds this secret. */
const as = (sim: PassportSim, sk: Uint8Array): PassportSim => {
  sim.privateState = createPrivateState(sk);
  return sim;
};

const instance = (sim: PassportSim): Uint8Array => new Uint8Array(Buffer.from(sim.address, 'hex'));
const nullifier = (sim: PassportSim, sk: Uint8Array, slot: bigint): Uint8Array =>
  pureCircuits.slotNullifier(sk, slot, instance(sim));

/** A registry with `n` humans enrolled. */
const setup = async (n = 3) => {
  const sim = await deploy();
  const humans = Array.from({ length: n }, () => newSecret());
  for (const sk of humans) await sim.call('enrol', pureCircuits.holderKey(sk));
  return { sim, humans };
};

describe('Agent Passport (in memory)', () => {
  it('deploys with the issuer set and nothing enrolled', async () => {
    const l = (await deploy()).ledger();
    expect(l.issuerPk).toEqual(pureCircuits.issuerKey(ISSUER_SK));
    expect(l.enrolled).toBe(0n);
    expect(l.agents.size()).toBe(0n);
  });

  it('runs the whole flow: enrol, authorise, attest, revoke', async () => {
    const { sim, humans } = await setup();
    expect(sim.ledger().enrolled).toBe(3n);

    const agentSk = newSecret();
    const agentPk = pureCircuits.agentKey(agentSk);
    await as(sim, humans[1]!).call('authorise', agentPk, 0n);
    expect(sim.ledger().agents.member(agentPk)).toBe(true);
    expect(sim.ledger().slots.lookup(nullifier(sim, humans[1]!, 0n))).toEqual(agentPk);

    const challenge = newSecret();
    await as(sim, agentSk).call('attest', challenge);
    expect(sim.ledger().attestations.lookup(challenge)).toEqual(agentPk);

    await as(sim, humans[1]!).call('revoke', 0n);
    expect(sim.ledger().agents.member(agentPk)).toBe(false);
    expect(sim.ledger().slots.size()).toBe(0n);
    await expectRejects(() => as(sim, agentSk).call('attest', newSecret()), 'Not an authorised agent');

    // The slot is free again.
    await as(sim, humans[1]!).call('authorise', agentPk, 0n);
    expect(sim.ledger().agents.member(agentPk)).toBe(true);
  });

  it('still accepts a proof path after later enrolments', async () => {
    const { sim, humans } = await setup(2);
    await as(sim, ISSUER_SK).call('enrol', pureCircuits.holderKey(newSecret()));
    await as(sim, humans[0]!).call('authorise', pureCircuits.agentKey(newSecret()), 0n);
    expect(sim.ledger().agents.size()).toBe(1n);
  });

  describe('enrol guards', () => {
    it('only the issuer enrols', async () => {
      const { sim } = await setup(1);
      await expectRejects(
        () => as(sim, newSecret()).call('enrol', pureCircuits.holderKey(newSecret())),
        'Only the issuer can do this',
      );
    });

    it('a holder key is enrolled once', async () => {
      const { sim, humans } = await setup(1);
      await expectRejects(() => sim.call('enrol', pureCircuits.holderKey(humans[0]!)), 'Holder already enrolled');
    });
  });

  describe('authorise guards', () => {
    it('a stranger has no path, so the honest client refuses', async () => {
      const { sim } = await setup();
      await expectRejects(
        () => as(sim, newSecret()).call('authorise', pureCircuits.agentKey(newSecret()), 0n),
        'not enrolled',
      );
    });

    it("a stranger who borrows a real holder's path is rejected by the circuit", async () => {
      const { sim, humans } = await setup();
      stealPathOf = pureCircuits.holderKey(humans[0]!);
      try {
        await expectRejects(
          () => as(sim, newSecret()).call('authorise', pureCircuits.agentKey(newSecret()), 0n),
          'Path is not for this holder',
        );
      } finally {
        stealPathOf = undefined;
      }
    });

    it('a holder has slots 0, 1 and 2 only', async () => {
      const { sim, humans } = await setup();
      for (const slot of [0n, 1n, 2n]) {
        await as(sim, humans[0]!).call('authorise', pureCircuits.agentKey(newSecret()), slot);
      }
      expect(sim.ledger().agents.size()).toBe(3n);
      await expectRejects(
        () => as(sim, humans[0]!).call('authorise', pureCircuits.agentKey(newSecret()), 3n),
        'A holder has 3 agent slots',
      );
    });

    it('a slot holds one agent at a time', async () => {
      const { sim, humans } = await setup();
      await as(sim, humans[0]!).call('authorise', pureCircuits.agentKey(newSecret()), 1n);
      await expectRejects(
        () => as(sim, humans[0]!).call('authorise', pureCircuits.agentKey(newSecret()), 1n),
        'Slot already in use',
      );
    });

    it('an agent key is authorised once, whoever asks', async () => {
      const { sim, humans } = await setup();
      const agentPk = pureCircuits.agentKey(newSecret());
      await as(sim, humans[0]!).call('authorise', agentPk, 0n);
      await expectRejects(() => as(sim, humans[1]!).call('authorise', agentPk, 0n), 'Agent already authorised');
    });
  });

  describe('revoke guards', () => {
    it('an empty slot cannot be revoked', async () => {
      const { sim, humans } = await setup();
      await expectRejects(() => as(sim, humans[0]!).call('revoke', 0n), 'Slot is empty');
    });

    it("one human cannot revoke another human's agent", async () => {
      const { sim, humans } = await setup();
      const agentPk = pureCircuits.agentKey(newSecret());
      await as(sim, humans[0]!).call('authorise', agentPk, 0n);
      await expectRejects(() => as(sim, humans[1]!).call('revoke', 0n), 'Slot is empty');
      await expectRejects(() => as(sim, ISSUER_SK).call('revoke', 0n), 'Slot is empty');
      expect(sim.ledger().agents.member(agentPk)).toBe(true);
    });
  });

  describe('attest guards', () => {
    it('an unauthorised key cannot attest', async () => {
      const { sim } = await setup();
      await expectRejects(() => as(sim, newSecret()).call('attest', newSecret()), 'Not an authorised agent');
    });

    it('a challenge is answered once', async () => {
      const { sim, humans } = await setup();
      const a1 = newSecret();
      const a2 = newSecret();
      await as(sim, humans[0]!).call('authorise', pureCircuits.agentKey(a1), 0n);
      await as(sim, humans[1]!).call('authorise', pureCircuits.agentKey(a2), 0n);
      const challenge = newSecret();
      await as(sim, a1).call('attest', challenge);
      await expectRejects(() => as(sim, a2).call('attest', challenge), 'Challenge already answered');
    });
  });

  describe('privacy', () => {
    it('no secret reaches public state', async () => {
      const { sim, humans } = await setup();
      const agentSk = newSecret();
      await as(sim, humans[2]!).call('authorise', pureCircuits.agentKey(agentSk), 2n);
      await as(sim, agentSk).call('attest', newSecret());
      assertNotInPublicState(sim.ledger(), {
        'issuer secret': ISSUER_SK,
        'human 0 secret': humans[0]!,
        'human 1 secret': humans[1]!,
        'human 2 secret': humans[2]!,
        'agent secret': agentSk,
      });
    });

    it('authorising adds no holder key to public state: only a nullifier and the agent key', async () => {
      const { sim, humans } = await setup();
      const before = new Set(collectPublicBytes(sim.ledger()).map((b) => hex(b.bytes)));
      const agentPk = pureCircuits.agentKey(newSecret());
      await as(sim, humans[1]!).call('authorise', agentPk, 0n);
      const added = collectPublicBytes(sim.ledger())
        .map((b) => hex(b.bytes))
        .filter((h) => !before.has(h));
      const holderKeys = humans.map((sk) => hex(pureCircuits.holderKey(sk)));
      for (const h of added) expect(holderKeys).not.toContain(h);
      expect(added).toContain(hex(agentPk));
      expect(added).toContain(hex(nullifier(sim, humans[1]!, 0n)));
    });

    it("one human's slots have unrelated nullifiers, and differ between deployments", async () => {
      const { sim, humans } = await setup();
      const sk = humans[0]!;
      const n0 = hex(nullifier(sim, sk, 0n));
      const n1 = hex(nullifier(sim, sk, 1n));
      expect(n0).not.toBe(n1);
      const other = await deploy();
      expect(hex(nullifier(other, sk, 0n))).not.toBe(n0);
    });
  });
});
