# Contributing

Thank you for your interest in contributing to `denex-network-manager`.

## Before You Start

- For bug reports and feature requests, please
  [open an issue](https://github.com/denex-io/denex-localnet/issues) first.
- For large changes, discuss the approach in an issue before writing code.
- For small fixes (typos, docs, obvious bugs), a PR is welcome without a prior issue.

## Development Setup

Requirements: [Deno 2.0+](https://deno.com) and [Docker](https://www.docker.com).

```bash
git clone https://github.com/denex-io/denex-localnet.git
cd denex-localnet
deno task check      # type-check all source
deno task lint       # lint
deno task test:unit  # unit tests (no Docker required)
deno task test:smoke # cross-runtime compatibility checks
```

Integration tests require a running Docker daemon:

```bash
deno task test:integration
```

## Code Style

- TypeScript with strict mode — no `any`, no `as any`, no `@ts-ignore`
- Run `deno fmt` before committing
- Match the existing comment density and naming conventions
- Cross-runtime code under `src/` (excluding `src/cli/`) must not use `Deno.*` or `@std/*` APIs —
  use `node:` built-ins instead

## Pull Requests

- PRs must pass CI (type check, lint, unit tests, smoke tests)
- Include a clear description of what changed and why
- Add or update tests for non-trivial changes
- Keep commits focused — one logical change per PR where possible

## License

By contributing, you agree that your contributions will be licensed under the
[Apache License 2.0](./LICENSE).
