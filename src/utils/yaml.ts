import process from 'node:process';
import { readFile, stat } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { parseLocalNetConfig, withDefaults } from '../schemas/mod.ts';
import type { ParsedLocalNetConfig } from '../schemas/mod.ts';

const CONFIG_FILE_NAMES = ['localnet.yaml', 'localnet.yml', '.localnet.yaml', '.localnet.yml'];

export async function findConfigFile(dir: string = process.cwd()): Promise<string | null> {
  for (const name of CONFIG_FILE_NAMES) {
    const path = `${dir}/${name}`;
    try {
      const fileInfo = await stat(path);
      if (fileInfo.isFile()) {
        return path;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function expandEnvVars(content: string): string {
  return content.replace(/\$\{([^}]+)\}/g, (_, varName) => {
    const value = process.env[varName];
    if (value === undefined) {
      throw new Error(`Environment variable not found: ${varName}`);
    }
    return value;
  });
}

export function expandEnvVarsWithDefaults(content: string): string {
  return content.replace(/\$\{([^}:]+)(?::([^}]*))?\}/g, (_, varName, defaultValue) => {
    const value = process.env[varName];
    if (value !== undefined) {
      return value;
    }
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Environment variable not found: ${varName}`);
  });
}

/**
 * Read a YAML config file, expand environment variables, and validate it.
 *
 * `${NAME}` and `${NAME:default}` are replaced from the process environment before the YAML is
 * parsed, anywhere in the file including comments. Schema defaults are filled in.
 *
 * @throws If the file cannot be read, a referenced variable is unset and has no default, the YAML
 *   does not parse, or the config fails schema validation.
 */
export async function loadConfigFile(path: string): Promise<ParsedLocalNetConfig> {
  const content = await readFile(path, 'utf-8');
  const expandedContent = expandEnvVarsWithDefaults(content);
  const parsed = parseYaml(expandedContent);
  return parseLocalNetConfig(parsed);
}

export async function loadConfigFromDir(
  dir: string = process.cwd(),
): Promise<ParsedLocalNetConfig> {
  const configPath = await findConfigFile(dir);
  if (!configPath) {
    throw new Error(
      `No configuration file found. Expected one of: ${CONFIG_FILE_NAMES.join(', ')}`,
    );
  }
  return loadConfigFile(configPath);
}

/**
 * Parse and validate a YAML config held in a string, with the same environment variable
 * expansion and errors as {@link loadConfigFile}.
 */
export function loadConfigFromString(yamlContent: string): ParsedLocalNetConfig {
  const expandedContent = expandEnvVarsWithDefaults(yamlContent);
  const parsed = parseYaml(expandedContent);
  return parseLocalNetConfig(parsed);
}

/**
 * Validated config with `validatorCount` validators named `validator-1`, `validator-2`, and so
 * on, base port 5000, and Keycloak admin `admin`/`admin`.
 *
 * @param validatorCount - 1 to 10.
 * @throws A Zod validation error if the count is out of range.
 */
export function createMinimalConfig(validatorCount: number = 2): ParsedLocalNetConfig {
  return withDefaults({ validators: validatorCount });
}
