#!/usr/bin/env node
// Step 3: FT lifecycle — mint on the creator node, distribute to holders, inspect balances.
//
// Prereqs: cluster up, DIDs registered + quorums wired (wire-network.mjs), and
// RBT funded on node1 (creator) and the quorum nodes (node7/node8) for pledging.
//
// Usage:
//   node orchestrator/ft-flow.mjs balances
//   node orchestrator/ft-flow.mjs mint --name GOLD --count 1000 --rbt 1
//   node orchestrator/ft-flow.mjs distribute --name GOLD --count 100
//   node orchestrator/ft-flow.mjs transfer --name GOLD --from node1 --to node3 --count 50
//
// Notes:
//   * mint runs on node1 (role ft-creator). Max 1000 FT per 1 RBT.
//   * distribute sends --count FTs from node1 to EACH holder (node2..node6).
//   * creatorDID for every transfer is node1's DID (the original minter).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mintFT, transferFT, getFTBalance, getRBTBalance, PASSWORD } from "./rubix.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(readFileSync(join(__dirname, "node_registry.json"), "utf8"));
const nodes = registry.nodes;

const creator = findByRole("ft-creator");
const holders = Object.entries(nodes).filter(([, n]) => n.role === "holder").map(([name, n]) => ({ name, ...n }));

function findByRole(role) {
  const e = Object.entries(nodes).find(([, n]) => n.role === role);
  if (!e) throw new Error(`no node with role '${role}' in registry`);
  return { name: e[0], ...e[1] };
}
function node(name) {
  if (!nodes[name]) throw new Error(`unknown node '${name}'`);
  return { name, ...nodes[name] };
}

// minimal --flag value parser
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[(i++, i)] : true;
      out[key] = val;
    }
  }
  return out;
}

function done(resp, label) {
  const ok = resp?.status;
  console.log(`   ${label}: ${ok ? "ok" : "FAILED"} — ${resp?.message || ""}`);
  return ok;
}

async function cmdBalances() {
  console.log("== Balances ==");
  const all = [creator, ...holders, node("node7"), node("node8")];
  for (const n of all) {
    const rbt = await getRBTBalance(n.baseUrl, n.did);
    const fts = await getFTBalance(n.baseUrl, n.did);
    const rbtStr = rbt ? `RBT ${rbt.balance} (pledged ${rbt.pledged}, locked ${rbt.locked})` : "RBT ?";
    const ftStr = fts.length
      ? fts.map((f) => `${f.name}:${f.count}`).join(", ")
      : "no FTs";
    console.log(`${n.name.padEnd(7)} ${n.role.padEnd(11)} ${rbtStr.padEnd(48)} ${ftStr}`);
  }
}

async function cmdMint(args) {
  const ftName = args.name;
  const ftCount = Number(args.count);
  const tokenCount = Number(args.rbt);
  if (!ftName || !ftCount || !tokenCount) {
    throw new Error("mint requires --name <ftName> --count <numFTs> --rbt <wholeRBT>");
  }
  if (ftCount > tokenCount * 1000) {
    throw new Error(`max 1000 FT per 1 RBT — ${ftCount} FT needs at least ${Math.ceil(ftCount / 1000)} RBT`);
  }
  console.log(`== Minting ${ftCount} '${ftName}' on ${creator.name} (backed by ${tokenCount} RBT) ==`);
  const resp = await mintFT(creator.baseUrl, {
    did: creator.did,
    ftName,
    ftCount,
    tokenCount,
    password: PASSWORD,
  });
  done(resp, "mint");
}

async function cmdDistribute(args) {
  const ftName = args.name;
  const perHolder = Number(args.count);
  if (!ftName || !perHolder) {
    throw new Error("distribute requires --name <ftName> --count <ftsPerHolder>");
  }
  console.log(`== Distributing ${perHolder} '${ftName}' from ${creator.name} to ${holders.length} holders ==`);
  for (const h of holders) {
    const resp = await transferFT(creator.baseUrl, {
      initiator: creator.did,
      owner: h.did,
      ftName,
      numberOfFts: perHolder,
      creatorDID: creator.did,
      memo: `Distribute ${ftName} to ${h.name}`,
      password: PASSWORD,
    });
    done(resp, `${creator.name} -> ${h.name}`);
  }
}

async function cmdTransfer(args) {
  const ftName = args.name;
  const count = Number(args.count);
  const from = node(args.from);
  const to = node(args.to);
  if (!ftName || !count || !args.from || !args.to) {
    throw new Error("transfer requires --name <ftName> --from <node> --to <node> --count <n>");
  }
  console.log(`== Transferring ${count} '${ftName}' ${from.name} -> ${to.name} ==`);
  const resp = await transferFT(from.baseUrl, {
    initiator: from.did,
    owner: to.did,
    ftName,
    numberOfFts: count,
    creatorDID: creator.did,
    memo: `Transfer ${ftName} ${from.name}->${to.name}`,
    password: PASSWORD,
  });
  done(resp, `${from.name} -> ${to.name}`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  switch (cmd) {
    case "balances": return cmdBalances();
    case "mint": return cmdMint(args);
    case "distribute": return cmdDistribute(args);
    case "transfer": return cmdTransfer(args);
    default:
      console.log("Usage: node orchestrator/ft-flow.mjs <balances|mint|distribute|transfer> [--flags]");
      console.log("  mint       --name GOLD --count 1000 --rbt 1");
      console.log("  distribute --name GOLD --count 100");
      console.log("  transfer   --name GOLD --from node1 --to node3 --count 50");
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
