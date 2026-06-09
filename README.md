# Network Coin Simulation

A self-contained demo platform for a **multi-brand loyalty / rewards network** on a
10-node Rubix testnet cluster. One command brings up the nodes, creates DIDs,
wires the quorums, and serves an interactive UI that walks through the five-stage
story: **Issue → Distribute → Earn → Redeem → Settle**.

It runs entirely in Docker. The node image downloads the official
[`rubixgoplatform` v1.0.0 release](https://github.com/rubixchain/rubixgoplatform/releases/tag/v1.0.0)
binary — no Go source or build toolchain required.

## Topology

| Nodes | Role | HTTP / swarm / postgres |
|---|---|---|
| node1 | FT **issuer** | 20000 / 4001 / 5433 |
| node2–node6 | **brands** A–E | 20001–20005 / 4002–4006 / 5434–5438 |
| node7, node8 | **quorum** validators | 20006–20007 / 4007–4008 / 5439–5440 |
| node9, node10 | **customer wallets** (many DIDs) | 20008–20009 / 4009–4010 / 5441–5442 |

The orchestrator (backend + UI) runs as an 11th container on the host network and
serves the demo on **port 4000**.

## Quick start

```bash
# Linux VM (installs Docker if missing) or local with Docker already present:
./scripts/deploy.sh        # fresh VM one-shot
#   — or —
./scripts/up.sh            # if Docker is already installed
```

Open **http://<host>:4000**. First boot downloads the node binary, builds the
images, starts 10 nodes, creates one DID per node, and wires the quorums
(several minutes). Then **fund** node1 (issuer) and node7/node8 (quorums) with
test RBT before running the stages.

Stop with `./scripts/down.sh` (add `--wipe` to delete all node data).

## Updating the node version

Bump `RUBIX_VERSION` in `.env` (or build arg) to any tag published on the
rubixgoplatform releases page, then rebuild:

```bash
RUBIX_VERSION=v1.0.1 ./scripts/build-node-image.sh
docker compose up -d
```

## Publishing the node image (optional, for fast cloud deploys)

```bash
RUBIX_NODE_IMAGE=ghcr.io/<you>/rubix-node:v1.0.0 PUSH=1 ./scripts/build-node-image.sh
# then set RUBIX_NODE_IMAGE in .env so every host pulls instead of building
```

## Layout

```
docker-compose.yml          # 10 nodes + 10 postgres + orchestrator, one command
docker/node/                # node image (downloads release binary + kubo) + entrypoint/config
docker/orchestrator/        # orchestrator (Node) image
orchestrator/               # backend (stage engine, API) + buildless React UI (public-v2)
scripts/                    # up / down / build-node-image / deploy
swarm/                      # IPFS swarm keys (testnet/localnet/mainnet)
```

## Notes

- **testnet** nodes need outbound internet (bootstrap peers). For external nodes
  to reach these (e.g. to send RBT in), forward `4001–4010/tcp`.
- The orchestrator container uses host networking, so this is **Linux-oriented**;
  on macOS run the orchestrator from source (`cd orchestrator && npm i && node server-v2.mjs`)
  against a locally running cluster.
- Built on the `cve-rubix` / rubixgoplatform `release-v1` line (Postgres + the
  `/rubix/v1` REST API). The upstream `main`/`development` API differs.
```
