/**
 * One party's connection to its own validator's JSON Ledger API: just what the RSVP app needs.
 *
 * Tokens come from @denex/network-manager's TokenManager, which caches them and fetches a new one
 * before it expires (LocalNet tokens last five minutes). Commands and queries are plain fetch,
 * because the package has no client for them. A real app would generate typed bindings from its
 * DAR instead of passing plain objects.
 */
import { randomUUID } from 'node:crypto';
import { TokenManager } from '@denex/network-manager';
import type { FullEnvironmentInfo } from '@denex/network-manager/sdk';

/** Package-name template ids: they keep working when a new version of the DAR is uploaded. */
export const INVITATION = '#rsvp:Rsvp:Invitation';
export const REPLY = '#rsvp:Rsvp:Reply';

export interface Contract<T> {
  contractId: string;
  payload: T;
}

type Command =
  | { CreateCommand: { templateId: string; createArguments: object } }
  | {
    ExerciseCommand: {
      templateId: string;
      contractId: string;
      choice: string;
      choiceArgument: object;
    };
  }
  | {
    CreateAndExerciseCommand: {
      templateId: string;
      createArguments: object;
      choice: string;
      choiceArgument: object;
    };
  };

export class Ledger {
  readonly party: string;
  readonly #user: string;
  readonly #jsonApi: string;
  readonly #token: () => Promise<string>;

  private constructor(
    party: string,
    user: string,
    jsonApi: string,
    token: () => Promise<string>,
  ) {
    this.party = party;
    this.#user = user;
    this.#jsonApi = jsonApi;
    this.#token = token;
  }

  /**
   * Connects as a user from localnet.yaml, to the validator that hosts the user's primary party.
   * A submission is accepted only by the participant hosting the submitting party, so each party
   * gets its own connection.
   */
  static connect(env: FullEnvironmentInfo, validator: string, user: string): Ledger {
    const node = env.validators[validator];
    if (!node) throw new Error(`No validator '${validator}' in this LocalNet`);
    // env.parties lists each allocated party once, under the validator that hosts it.
    const party = env.parties.find((p) => p.validator === validator && p.hint === user)?.partyId;
    if (!party) throw new Error(`No party '${user}' hosted on '${validator}'`);

    const tokens = new TokenManager(env.auth.keycloak.url);
    // dnm creates each configured user in its validator's realm, with its id as its password.
    const token = () =>
      tokens.getPasswordToken({
        realm: node.auth.realm,
        clientId: node.auth.userClientId,
        username: user,
        password: user,
      });
    return new Ledger(party, user, node.endpoints.jsonApi, token);
  }

  /** Waits for a real answer from the API: an open port alone proves nothing behind Docker. */
  async waitUntilReady(timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        await this.#request<object>('GET', '/v2/version');
        return;
      } catch (error) {
        lastError = error;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error(`${this.#jsonApi} not ready after ${timeoutMs / 1000} s: ${lastError}`);
  }

  /** Submits one command as this party and returns the ids of the contracts it created. */
  async submit(command: Command): Promise<string[]> {
    const result = await this.#request<{
      transaction: { events: { CreatedEvent?: { contractId: string } }[] };
    }>('POST', '/v2/commands/submit-and-wait-for-transaction', {
      commands: {
        commands: [command],
        commandId: randomUUID(),
        userId: this.#user,
        actAs: [this.party],
      },
    });
    return result.transaction.events.flatMap((e) =>
      e.CreatedEvent ? [e.CreatedEvent.contractId] : []
    );
  }

  /** The active contracts of a template that this party is a stakeholder of. */
  async active<T>(templateId: string): Promise<Contract<T>[]> {
    const { offset } = await this.#request<{ offset: number }>('GET', '/v2/state/ledger-end');
    const entries = await this.#request<
      {
        contractEntry: {
          JsActiveContract?: { createdEvent: { contractId: string; createArgument: T } };
        };
      }[]
    >('POST', '/v2/state/active-contracts', {
      activeAtOffset: offset,
      eventFormat: {
        filtersByParty: {
          [this.party]: {
            cumulative: [{ identifierFilter: { TemplateFilter: { value: { templateId } } } }],
          },
        },
        verbose: false,
      },
    });
    return entries.flatMap(({ contractEntry }) => {
      const event = contractEntry.JsActiveContract?.createdEvent;
      return event ? [{ contractId: event.contractId, payload: event.createArgument }] : [];
    });
  }

  async #request<T>(method: string, path: string, body?: object): Promise<T> {
    const res = await fetch(`${this.#jsonApi}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.#token()}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} as ${this.#user}: ${res.status} ${text}`);
    return JSON.parse(text) as T;
  }
}
