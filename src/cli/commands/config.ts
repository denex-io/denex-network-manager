import { Command } from '@cliffy/command';
import { Confirm, Input, Number } from '@cliffy/prompt';
import { stringify } from '@std/yaml';
import { printError, warnToStderr } from '../utils.ts';
import { CONFIG_DEFAULTS } from '../../types/config.ts';
import { validateLocalNetConfig } from '../../schemas/mod.ts';
import { DEFAULT_BASE_PORT, getKeycloakPort, MAX_PORT } from '../../utils/ports.ts';

export const configCommand = new Command()
  .description('Generate a localnet.yaml configuration file')
  .option('-o, --output <path:string>', 'Output file path', { default: 'localnet.yaml' })
  .option(
    '-y, --yes',
    'Accept all defaults without prompting; overwrites an existing file after saving it as <output>.bak',
  )
  .action(async (options) => {
    if (options.yes) {
      if (!await generateWithDefaults(options.output)) Deno.exit(1);
      return;
    }

    if (!await generateInteractive(options.output)) Deno.exit(1);
  });

async function generateWithDefaults(outputPath: string): Promise<boolean> {
  const config = {
    version: CONFIG_DEFAULTS.version,
    validators: CONFIG_DEFAULTS.validatorCount,
    auth: {
      keycloak: {
        admin: CONFIG_DEFAULTS.auth.keycloak.admin,
        password: CONFIG_DEFAULTS.auth.keycloak.password,
      },
    },
  };

  return await writeConfig(config, outputPath, { overwrite: true });
}

async function generateInteractive(outputPath: string): Promise<boolean> {
  console.log('\n🔧 LocalNet Configuration Generator\n');
  console.log('This will create a configuration file for your Canton LocalNet.\n');

  const validatorCount = await Number.prompt({
    message: 'Number of validators (excluding the Super Validator which is always created)',
    default: CONFIG_DEFAULTS.validatorCount,
    min: 1,
    // Highest port at 80 + 100 * count above the default base port must stay <= 65535.
    max: Math.floor((MAX_PORT - 80 - DEFAULT_BASE_PORT) / 100),
  });

  const useDetailedValidators = await Confirm.prompt({
    message: 'Configure validators with custom names and parties?',
    default: false,
  });

  let validators: number | { name: string; parties?: { hint: string }[] }[] = validatorCount;

  if (useDetailedValidators) {
    validators = [];
    for (let i = 0; i < validatorCount; i++) {
      const name = await Input.prompt({
        message: `Name for validator ${i + 1}`,
        default: `validator-${i + 1}`,
      });

      const addParty = await Confirm.prompt({
        message: `Add a party to ${name}?`,
        default: true,
      });

      if (addParty) {
        const partyHint = await Input.prompt({
          message: 'Party hint (used in party ID)',
          default: name.replace('-validator', '').replace('validator-', 'party'),
        });

        validators.push({
          name,
          parties: [{ hint: partyHint }],
        });
      } else {
        validators.push({ name });
      }
    }
  }

  const keycloakPort = getKeycloakPort(DEFAULT_BASE_PORT);
  const useDefaultKeycloak = await Confirm.prompt({
    message: `Use default Keycloak settings? (localhost:${keycloakPort}, admin/admin)`,
    default: true,
  });

  let auth: Record<string, unknown>;

  if (useDefaultKeycloak) {
    auth = {
      keycloak: {
        admin: CONFIG_DEFAULTS.auth.keycloak.admin,
        password: CONFIG_DEFAULTS.auth.keycloak.password,
      },
    };
  } else {
    const keycloakAdmin = await Input.prompt({
      message: 'Keycloak admin username',
      default: CONFIG_DEFAULTS.auth.keycloak.admin,
    });

    const keycloakPassword = await Input.prompt({
      message: 'Keycloak admin password',
      default: CONFIG_DEFAULTS.auth.keycloak.password,
    });

    auth = {
      keycloak: {
        admin: keycloakAdmin,
        password: keycloakPassword,
      },
    };
  }

  const config: Record<string, unknown> = {
    version: CONFIG_DEFAULTS.version,
    validators,
    auth,
  };

  return await writeConfig(config, outputPath, { overwrite: false });
}

/**
 * Validate the config with the same rules `dnm start` applies, then write it. Returns `false`
 * (after printing the problems, with nothing written and no `.bak` made) if it is invalid.
 * If the file exists: with `overwrite` it is copied to `<path>.bak` first and
 * then replaced; without it the user is asked to confirm.
 */
export async function writeConfig(
  config: Record<string, unknown>,
  outputPath: string,
  { overwrite }: { overwrite: boolean },
): Promise<boolean> {
  const validation = validateLocalNetConfig(config, { onWarning: warnToStderr });
  if (!validation.success) {
    printError('The generated configuration is invalid; nothing was written:');
    for (const issue of validation.errors.issues) {
      const where = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      console.error(`  - ${where}${issue.message}`);
    }
    return false;
  }

  const exists = await fileExists(outputPath);
  let backupPath: string | undefined;

  if (exists && overwrite) {
    backupPath = `${outputPath}.bak`;
    await Deno.copyFile(outputPath, backupPath);
  } else if (exists) {
    const confirmed = await Confirm.prompt({
      message: `${outputPath} already exists. Overwrite?`,
      default: false,
    });

    if (!confirmed) {
      console.log('Aborted.');
      return true;
    }
  }

  const yaml = stringify(config, { indent: 2 });
  await Deno.writeTextFile(outputPath, yaml);

  console.log(`\n✅ Configuration written to ${outputPath}\n`);
  if (backupPath) console.log(`Previous file saved as ${backupPath}\n`);
  const quoted = /[^\w@%+=:,./-]/.test(outputPath)
    ? `'${outputPath.replaceAll("'", "'\\''")}'`
    : outputPath;
  console.log('Next steps:');
  console.log(`  1. Review and edit ${outputPath} if needed`);
  console.log(`  2. Run: dnm start --config ${quoted}`);
  console.log('  3. Check status: dnm status');
  console.log('  4. View endpoints: dnm env\n');
  return true;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}
