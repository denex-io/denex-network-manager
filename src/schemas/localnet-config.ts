import { z } from 'zod';
import { CONFIG_DEFAULTS } from '../types/config.ts';

export const UserRightSchema = z.enum(['ParticipantAdmin', 'CanActAs', 'CanReadAs', 'CanExecuteAs', 'CanReadAsAnyParty', 'CanExecuteAsAnyParty', 'IdentityProviderAdmin']);

export const ParticipantWideRightSchema = z.enum(['ParticipantAdmin', 'CanReadAsAnyParty', 'CanExecuteAsAnyParty', 'IdentityProviderAdmin']);
export const PerPartyRightSchema = z.enum(['CanActAs', 'CanReadAs', 'CanExecuteAs']);

export const PartyConfigSchema = z.object({
  hint: z.string().min(1).regex(
    /^[a-z][a-z0-9-]*$/i,
    'Party hint must start with a letter and contain only letters, numbers, and hyphens',
  ),
  displayName: z.string().optional(),
  validator: z.string().optional(),
});

export const UserPartyConfigSchema = z.object({
  hint: z.string().min(1),
  rights: z.array(PerPartyRightSchema).optional(),
});

export const UserConfigSchema = z.object({
  id: z.string().min(1),
  primaryParty: z.string().min(1).optional(),
  rights: z.array(UserRightSchema).optional(),
  parties: z.array(UserPartyConfigSchema).optional(),
  validator: z.string().optional(),
});

export const ValidatorConfigSchema = z.object({
  name: z.string().min(1).regex(
    /^[a-z][a-z0-9-]*$/i,
    'Validator name must start with a letter and contain only letters, numbers, and hyphens',
  ),
  parties: z.array(PartyConfigSchema).optional(),
  users: z.array(UserConfigSchema).optional(),
});

export const PackageConfigSchema = z.object({
  name: z.string().min(1),
  dar: z.string().min(1),
  uploadTo: z.array(z.string()).optional(),
});

export const OAuth2ConfigSchema = z.object({
  keycloak: z.object({
    admin: z.string().min(1),
    password: z.string().min(1),
  }),
});

export const AuthConfigSchema = OAuth2ConfigSchema;

export const DiscoveryConfigSchema = z.object({
  port: z.number().int().min(1).max(65535),
  host: z.string().min(1),
});

export const ValidatorsSchema = z.union([
  z.number().int().min(1).max(10),
  z.array(ValidatorConfigSchema).min(1),
]);

export const LocalNetConfigSchema = z.object({
  version: z.string().optional().default(CONFIG_DEFAULTS.version),
  validators: ValidatorsSchema,
  auth: AuthConfigSchema,
  packages: z.array(PackageConfigSchema).optional(),
  // @deprecated — kept for backward compatibility. Use 'localnet discovery serve' instead.
  discovery: DiscoveryConfigSchema.optional(),
  basePort: z.number().int().min(1024).max(60000).default(5000),
});

export type ParsedLocalNetConfig = z.infer<typeof LocalNetConfigSchema>;

export function parseLocalNetConfig(input: unknown): ParsedLocalNetConfig {
  return LocalNetConfigSchema.parse(input);
}

export function validateLocalNetConfig(input: unknown): {
  success: true;
  data: ParsedLocalNetConfig;
} | {
  success: false;
  errors: z.ZodError;
} {
  const result = LocalNetConfigSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error };
}

export function withDefaults(config: Partial<ParsedLocalNetConfig>): ParsedLocalNetConfig {
  const basePort = config.basePort ?? 5000;
  const defaultAuth = config.auth ?? {
    keycloak: {
      admin: CONFIG_DEFAULTS.auth.keycloak.admin,
      password: CONFIG_DEFAULTS.auth.keycloak.password,
    },
  };

  return LocalNetConfigSchema.parse({
    version: CONFIG_DEFAULTS.version,
    validators: config.validators ?? CONFIG_DEFAULTS.validatorCount,
    auth: defaultAuth,
    packages: config.packages,
    discovery: config.discovery ?? CONFIG_DEFAULTS.discovery,
    basePort,
  });
}
