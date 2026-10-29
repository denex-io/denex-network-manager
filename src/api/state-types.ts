/**
 * Wire-level type definitions for Canton/Validator API responses.
 *
 * These types describe the aggregated state shape used by `LocalNet` query
 * methods (`getParties`, `getUsers`, `getPackages`, `getSnapshot`, etc.).
 *
 * The `Api` prefix distinguishes these wire-level types from the higher-level
 * SDK abstractions in `src/types/state.ts`.
 *
 * @module api/state-types
 */

import type { ApiUserRight } from './canton.ts';

export interface ApiPartyInfo {
  /** Full party ID (`<hint>::<namespace>`). */
  partyId: string;
  /** The part of `partyId` before `::`. */
  hint: string;
  /** The hosting participant's `displayName` annotation, else `hint`. */
  displayName: string;
  /** `'sv'` or the validator whose participant hosts the party. */
  validator: string;
  /** ID of the hosting participant. */
  participantId: string;
}

export interface ApiUserInfo {
  id: string;
  primaryParty?: string;
  validator: string;
  isDeactivated: boolean;
}

export interface ApiUserInfoWithRights extends ApiUserInfo {
  rights: ApiUserRight[];
}

export interface ApiPackageInfo {
  /** Package ID (64-character hex). The list includes Splice and Daml built-in packages. */
  packageId: string;
  /** Participants (`'sv'` and validator names, in that order) that know the package. */
  validators: string[];
}

export interface ApiValidatorState {
  name: string;
  role: 'sv' | 'validator';
  participantId: string;
  validatorParty?: string;
  isHealthy: boolean;
  ports: {
    ledgerApi: number;
    adminApi: number;
    jsonApi: number;
    validatorAdminApi: number;
  };
}

export interface ApiLocalNetSnapshot {
  validators: ApiValidatorState[];
  parties: ApiPartyInfo[];
  users: ApiUserInfo[];
  packages: ApiPackageInfo[];
  timestamp: Date;
}
