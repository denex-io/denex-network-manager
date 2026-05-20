import { Command } from '@cliffy/command';
import { Input, Number, Confirm } from '@cliffy/prompt';
import { stringify } from '@std/yaml';
import { CONFIG_DEFAULTS } from '../../types/config.ts';
import { getKeycloakPort, DEFAULT_BASE_PORT } from '../../utils/ports.ts';

export const configCommand = new Command()
  .description('Generate a localnet.yaml configuration file')
  .option('-o, --output <path:string>', 'Output file path', { default: 'localnet.yaml' })
  .option('-y, --yes', 'Accept all defaults without prompting')
  .action(async (options) => {
    if (options.yes) {
      await generateWithDefaults(options.output);
      return;
    }

    await generateInteractive(options.output);
  });

async function generateWithDefaults(outputPath: string): Promise<void> {
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

  await writeConfig(config, outputPath);
}

async function generateInteractive(outputPath: string): Promise<void> {
  console.log('\n🔧 LocalNet Configuration Generator\n');
  console.log('This will create a configuration file for your Canton LocalNet.\n');

  const validatorCount = await Number.prompt({
    message: 'Number of validators (excluding the Super Validator which is always created)',
    default: CONFIG_DEFAULTS.validatorCount,
    min: 1,
    max: 10,
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

  await writeConfig(config, outputPath);
}

async function writeConfig(config: Record<string, unknown>, outputPath: string): Promise<void> {
  const exists = await fileExists(outputPath);

  if (exists) {
    const overwrite = await Confirm.prompt({
      message: `${outputPath} already exists. Overwrite?`,
      default: false,
    });

    if (!overwrite) {
      console.log('Aborted.');
      return;
    }
  }

  const yaml = stringify(config, { indent: 2 });
  await Deno.writeTextFile(outputPath, yaml);

  console.log(`\n✅ Configuration written to ${outputPath}\n`);
  console.log('Next steps:');
  console.log(`  1. Review and edit ${outputPath} if needed`);
  console.log('  2. Run: deno task cli start');
  console.log('  3. Check status: deno task cli status');
  console.log('  4. View endpoints: deno task cli env\n');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}
