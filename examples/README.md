# Examples

Runnable examples for `denex-network-manager`. `dev-stack/` imports the SDK from this repository, so
run it from the repo root. `integration-tests/` is a standalone Node project that consumes the
released CLI and npm package, as your own project would; run it from its own directory.

| Example                                    | What it shows                                                                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| [`dev-stack/`](dev-stack/main.ts)          | A one-command dev stack: reuse-or-start lifecycle, a single environment snapshot, per-participant connections, and readiness polling.   |
| [`integration-tests/`](integration-tests/) | An app's integration tests against a LocalNet: one command locally and the same in CI, with the lifecycle driven by the CLI or the SDK. |

```sh
deno run -A examples/dev-stack/main.ts          # start (or reuse) and report
deno run -A examples/dev-stack/main.ts --down   # destroy
```

The reasoning behind the dev-stack example is written up in
[Building a dev stack](https://denex-io.github.io/denex-network-manager/guides/dev-stack/).

Examples require Docker. A cold start takes several minutes; reusing a live instance takes about a
second.

## For contributors

`deno task check` type-checks `examples/dev-stack/`, and `deno fmt` / `deno lint` cover this
directory by default, so an SDK signature change that breaks that example fails CI rather than
rotting silently. `integration-tests/` runs against the release it pins, not this repository's
source: its own `tsc` and the Example integration tests workflow, which runs it end to end on every
change to it and weekly, keep it working. Bump its pin after each release. Examples are not shipped
in the published npm package.
