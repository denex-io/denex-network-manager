FROM denoland/deno:2.8.1 AS builder
# BuildKit auto-injects HTTP_PROXY/HTTPS_PROXY/NO_PROXY build-args into the RUN
# environment. In dev they point at the detarn registry-rewriting proxy so
# Deno's npm fetches reach an Artifactory mirror (registry.npmjs.org is
# unreachable here). The optional deno_cert secret supplies the proxy's CA so
# Deno trusts its TLS; required=false → omitting it (CI / direct network) is a
# no-op and Deno uses its default root list.
WORKDIR /build
COPY deno.json deno.lock ./
COPY src/ ./src/
RUN --mount=type=secret,id=deno_cert,target=/run/secrets/deno-cert.pem,required=false \
    if [ -f /run/secrets/deno-cert.pem ]; then export DENO_CERT=/run/secrets/deno-cert.pem; fi && \
    deno compile --allow-all --output=localnet-cli src/cli/mod.ts

FROM denoland/deno:distroless-2.8.1
COPY --from=builder /build/localnet-cli /usr/local/bin/localnet-cli
ENTRYPOINT ["/usr/local/bin/localnet-cli", "start", "--config"]
