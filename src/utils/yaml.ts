import process from 'node:process';
import { readFile, stat } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { parseLocalNetConfig, withDefaults } from '../schemas/mod.ts';
import type { ParseConfigOptions, ParsedLocalNetConfig } from '../schemas/mod.ts';

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
 * Loads and validates a YAML config file. Environment variables are expanded first.
 * Unknown keys are ignored and reported through `options.onWarning` (default `console.warn`).
 *
 * @throws {ZodError} If the config is invalid (see {@link parseLocalNetConfig}).
 */
export async function loadConfigFile(
  path: string,
  options?: ParseConfigOptions,
): Promise<ParsedLocalNetConfig> {
  const content = await readFile(path, 'utf-8');
  const expandedContent = expandEnvVarsWithDefaults(content);
  const parsed = parseYaml(expandedContent);
  return parseLocalNetConfig(parsed, options);
}

export async function loadConfigFromDir(
  dir: string = process.cwd(),
  options?: ParseConfigOptions,
): Promise<ParsedLocalNetConfig> {
  const configPath = await findConfigFile(dir);
  if (!configPath) {
    throw new Error(
      `No configuration file found. Expected one of: ${CONFIG_FILE_NAMES.join(', ')}`,
    );
  }
  return loadConfigFile(configPath, options);
}

export function loadConfigFromString(
  yamlContent: string,
  options?: ParseConfigOptions,
): ParsedLocalNetConfig {
  const expandedContent = expandEnvVarsWithDefaults(yamlContent);
  const parsed = parseYaml(expandedContent);
  return parseLocalNetConfig(parsed, options);
}

export function createMinimalConfig(validatorCount: number = 2): ParsedLocalNetConfig {
  return withDefaults({ validators: validatorCount });
}
