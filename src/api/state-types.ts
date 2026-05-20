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
  partyId: string;
  hint: string;
  displayName: string;
  validator: string;
  participantId: string;
  isLocal: boolean;
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
  packageId: string;
  packageSize: number;
  knownSince: string;
  validator: string;
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
