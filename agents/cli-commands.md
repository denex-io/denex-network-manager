# CLI Commands

## Scope

- Covers: Deno-only CLI registration, commands, CLI utilities, output formatting, and instance
  resolution.
- Read when: adding or changing CLI commands, flags, state-command behavior, or terminal output.
- Excludes: SDK entry point design and low-level API client internals.
- Supporting docs: `README.md` CLI section.

## What this subsystem is

The CLI is a Deno-only Cliffy app exposed through `src/cli/mod.ts`. It wraps the same `LocalNet`
class used by the SDK, but state commands attach to running Docker-labeled instances instead of
requiring a config file.

## Main modules

- `src/cli/mod.ts`: Cliffy command registration.
- `src/cli/utils.ts`: colors, tables, status rendering, and instance resolution.
- `src/cli/commands/start.ts`: config-backed startup.
- `src/cli/commands/config.ts`: interactive config generation.
- `src/cli/commands/*`: state and query commands.
- `src/utils/credentials.ts`: shared credentials helper.
- `src/utils/env-info.ts`: shared environment info helper.

## Working rules

- Only `start` and `config` accept `--config`.
- State commands attach via Docker labels using `--instance` or auto-resolve when exactly one
  running instance exists.
- `destroy` may attach to stopped or mixed instances; other state commands generally require running
  instances.
- `discovery` runs a foreground HTTP server; it is not started from YAML.
- The CLI may use `Deno.*`, Cliffy, and terminal color helpers because it is not cross-runtime.

## Critical gotchas

- Error messages still mention `denex-localnet` in some places while the local command name is
  `localnet`; check existing command style before changing wording.
- Do not add `--config` back to state-2 commands.
- Terminal color output depends on `Deno.stdout.isTerminal()`.
- `destroy --force` behavior should protect users from accidental deletion.

## Editing guidance

- When adding a command, register it in `src/cli/mod.ts`, add help text, update README, and add unit
  coverage where practical.
- For CLI behavior changes, manually run `deno task cli <command> --help` and a happy-path or dry
  command through the CLI surface.
- For state commands, test the multiple-instance and no-instance error paths.

## Canonical implementation surfaces

- `src/cli/mod.ts`
- `src/cli/utils.ts`
- `src/cli/commands/`
- `test/unit/cli_test.ts`
