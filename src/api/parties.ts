/**
 * Pure helpers for merging the parties each participant hosts.
 *
 * @module api/parties
 */

import type { PartyDetails } from './canton.ts';

/** The parties one participant hosts, as returned by a successful query. */
export interface HostedParties {
  participantId: string;
  /** Hosted parties only (`isLocal === true`). */
  parties: PartyDetails[];
}

/** One party after merging, with every participant that hosts it. */
export interface MergedParty {
  /** The wire details from the first host (display name merged from later hosts if absent). */
  party: PartyDetails;
  /** First host in canonical order. */
  validator: string;
  /** Participant ID of the first host. */
  participantId: string;
  /** Every host in canonical order; `hosts[0] === validator`. */
  hosts: string[];
}

export interface MergeFailure {
  validator: string;
  error: string;
}

function displayNameOf(party: PartyDetails): string | undefined {
  return party.localMetadata?.annotations?.displayName;
}

/**
 * Merges per-participant hosted-party lists into one entry per party.
 *
 * Parties are deduplicated by `partyId` in the order of `names`; the first host wins
 * `validator` and `participantId`. The display name is the first host's real
 * annotation, else the first other host's. Rejected queries are reported in `failures`
 * and their parties are omitted.
 *
 * @param names - Participant names in canonical order (sv, then config order).
 * @param settled - One settled query result per name, in the same order.
 */
export function mergeHostedParties(
  names: string[],
  settled: PromiseSettledResult<HostedParties>[],
): { parties: MergedParty[]; failures: MergeFailure[] } {
  const merged = new Map<string, MergedParty>();
  const failures: MergeFailure[] = [];

  names.forEach((name, index) => {
    const result = settled[index];
    if (result.status === 'rejected') {
      const reason = result.reason;
      failures.push({
        validator: name,
        error: reason instanceof Error ? reason.message : String(reason),
      });
      return;
    }
    for (const party of result.value.parties) {
      const existing = merged.get(party.party);
      if (!existing) {
        merged.set(party.party, {
          party,
          validator: name,
          participantId: result.value.participantId,
          hosts: [name],
        });
        continue;
      }
      existing.hosts.push(name);
      if (!displayNameOf(existing.party) && displayNameOf(party)) {
        existing.party = {
          ...existing.party,
          localMetadata: { ...existing.party.localMetadata, ...party.localMetadata },
        };
      }
    }
  });

  return { parties: [...merged.values()], failures };
}
