import { randomUUID } from 'node:crypto';
import type { FullEnvironmentInfo } from '@denex/network-manager/sdk';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { INVITATION, Ledger, REPLY } from '../src/ledger.ts';
import { type Invitation, type Reply, startRsvpBot } from '../src/rsvp-bot.ts';

// The environment snapshot the global setup provides: the CLI one reads `dnm env --json`, the SDK
// one calls getEnvironment().
declare module 'vitest' {
  export interface ProvidedContext {
    localnet: FullEnvironmentInfo;
  }
}

const env = inject('localnet');

// alice and bob are hosted on different validators, so each connects to its own.
const alice = Ledger.connect(env, 'org-a', 'alice');
const bob = Ledger.connect(env, 'org-b', 'bob');

const BUSY = '2027-01-15';
const FREE = '2027-01-16';

let bot: { stop(): Promise<void> } | undefined;

beforeAll(async () => {
  await Promise.all([alice.waitUntilReady(), bob.waitUntilReady()]);
  bot = startRsvpBot(bob, new Set([BUSY]));
});

afterAll(async () => {
  await bot?.stop();
});

/**
 * A reused LocalNet keeps its ledger between runs, so each test names its own event and looks
 * only at its own contracts.
 */
function invitation(date: string): Invitation {
  return {
    host: alice.party,
    guest: bob.party,
    event: `dinner-${randomUUID()}`,
    date,
  };
}

async function waitFor<T>(
  what: string,
  probe: () => Promise<T | undefined>,
): Promise<T> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const found = await probe();
    if (found !== undefined) return found;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out after 60 s waiting for ${what}`);
}

/** alice invites bob on her validator, then waits until his reply reaches her. */
async function inviteAndAwaitReply(
  date: string,
): Promise<{ sent: Invitation; reply: Reply }> {
  const sent = invitation(date);
  await alice.submit({
    CreateCommand: { templateId: INVITATION, createArguments: sent },
  });
  const reply = await waitFor(
    `bob's reply to ${sent.event}`,
    async () => (await alice.active<Reply>(REPLY)).find((r) => r.payload.event === sent.event),
  );
  return { sent, reply: reply.payload };
}

describe('RSVP across two validators', () => {
  it("bob's service accepts an invitation for a free date", async () => {
    const { sent, reply } = await inviteAndAwaitReply(FREE);
    expect(reply).toMatchObject({
      host: alice.party,
      guest: bob.party,
      date: FREE,
      going: true,
    });

    // Answering archived the invitation, and both participants agree.
    for (const ledger of [alice, bob]) {
      const open = await ledger.active<Invitation>(INVITATION);
      expect(open.some((i) => i.payload.event === sent.event)).toBe(false);
    }
  });

  it("bob's service declines an invitation for a busy date", async () => {
    const { reply } = await inviteAndAwaitReply(BUSY);
    expect(reply.going).toBe(false);
  });

  it('alice cannot answer on behalf of bob', async () => {
    // Created and exercised in one command, so bob's service cannot answer it first.
    const attempt = alice.submit({
      CreateAndExerciseCommand: {
        templateId: INVITATION,
        createArguments: invitation(FREE),
        choice: 'Respond',
        choiceArgument: { going: true },
      },
    });
    await expect(attempt).rejects.toThrow(/DAML_AUTHORIZATION_ERROR/);
  });
});
