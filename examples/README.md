# Examples

Runnable examples for `denex-network-manager`. Each is self-contained and imports the SDK from this
repository, so run them from the repo root.

| Example                           | What it shows                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [`dev-stack/`](dev-stack/main.ts) | A one-command dev stack: reuse-or-start lifecycle, a single environment snapshot, per-participant connections, and readiness polling. |

```sh
deno run -A examples/dev-stack/main.ts          # start (or reuse) and report
deno run -A examples/dev-stack/main.ts --down   # destroy
```

The reasoning behind the dev-stack example is written up in
[Building a dev stack](https://denex-io.github.io/denex-network-manager/guides/dev-stack/).

Examples require Docker. A cold start takes several minutes; reusing a live instance takes about a
second.

## For contributors

`deno task check` type-checks `examples/**/*.ts`, and `deno fmt` / `deno lint` cover this directory
by default, so an SDK signature change that breaks an example fails CI rather than rotting silently.
Examples are not shipped in the published npm package.
