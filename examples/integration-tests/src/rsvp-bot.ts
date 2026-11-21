/**
 * The off-chain half of the app: a service acting for the guest, against the guest's own
 * validator. It answers each open invitation from the guest's calendar, which is off-ledger data
 * the contracts know nothing about.
 *
 * It polls the active contracts to stay short. A production service would follow the update
 * stream (`/v2/updates`) from the offset of its last answer instead.
 */
import { type Contract, INVITATION, type Ledger } from './ledger.ts';

export interface Invitation {
  host: string;
  guest: string;
  event: string;
  date: string;
}

export interface Reply extends Invitation {
  going: boolean;
}

/** Starts answering invitations to `guest`: declined when the date is in `busy`, else accepted. */
export function startRsvpBot(guest: Ledger, busy: Set<string>): { stop(): Promise<void> } {
  let running = true;

  const answer = (invitation: Contract<Invitation>) =>
    guest.submit({
      ExerciseCommand: {
        templateId: INVITATION,
        contractId: invitation.contractId,
        choice: 'Respond',
        choiceArgument: { going: !busy.has(invitation.payload.date) },
      },
    });

  // An error ends the loop and surfaces as an unhandled rejection, which fails the test run with
  // the real cause instead of a later timeout.
  const loop = (async () => {
    while (running) {
      const invitations = await guest.active<Invitation>(INVITATION);
      for (const invitation of invitations) {
        if (invitation.payload.guest === guest.party) await answer(invitation);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  })();

  return {
    async stop() {
      running = false;
      await loop;
    },
  };
}
