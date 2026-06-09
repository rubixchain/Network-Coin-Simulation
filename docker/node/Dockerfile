# Rubix node image — downloads the official rubixgoplatform release binary
# (no Go source needed) plus the kubo (IPFS) binary. Multi-arch via TARGETARCH.
#
# Update the node version by bumping RUBIX_VERSION (build arg / .env) to any
# tag published at github.com/rubixchain/rubixgoplatform/releases.
FROM alpine:latest

ARG TARGETARCH
ARG RUBIX_VERSION=v1.0.0
ARG KUBO_VERSION=v0.19.1

WORKDIR /app
RUN apk add --no-cache bash postgresql-client gettext curl tar

# rubixgoplatform release binary (asset: rubixgoplatform-<ver>-linux-<arch>.tar.gz)
RUN set -eux; \
    url="https://github.com/rubixchain/rubixgoplatform/releases/download/${RUBIX_VERSION}/rubixgoplatform-${RUBIX_VERSION}-linux-${TARGETARCH}.tar.gz"; \
    curl -fsSL "$url" -o /tmp/rubix.tar.gz; \
    mkdir -p /tmp/rubix && tar -xzf /tmp/rubix.tar.gz -C /tmp/rubix; \
    bin="$(find /tmp/rubix -type f -name 'rubixgoplatform*' | head -n1)"; \
    cp "$bin" /app/rubixgoplatform; chmod +x /app/rubixgoplatform; \
    rm -rf /tmp/rubix /tmp/rubix.tar.gz

# kubo (IPFS) binary
RUN set -eux; \
    curl -fsSL "https://dist.ipfs.tech/kubo/${KUBO_VERSION}/kubo_${KUBO_VERSION}_linux-${TARGETARCH}.tar.gz" -o /tmp/kubo.tar.gz; \
    tar -xzf /tmp/kubo.tar.gz -C /tmp; \
    cp /tmp/kubo/ipfs /app/ipfs; chmod +x /app/ipfs; \
    rm -rf /tmp/kubo /tmp/kubo.tar.gz

COPY entrypoint.sh /app/entrypoint.sh
COPY config.template.toml /app/config.template.toml
RUN chmod +x /app/entrypoint.sh /app/ipfs

ENTRYPOINT ["/app/entrypoint.sh"]
