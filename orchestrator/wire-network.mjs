#!/usr/bin/env node
// Step 2: wire the 10-node network so transactions can reach consensus.
//
//   1. register-did   — (re)register every DID via the two-step signature flow so
//                       its credentials (DID<->peerID) are published to the testnet
//                       DHT and resolvable by all nodes. On testnet this replaces
//                       manual peer-detail exchange.
//   2. setup-quorum   — node7 & node8 start acting as quorum signers (synchronous)
//   3. addquorum      — participant nodes register the quorum DID(s), idempotently:
//                       checked against getallquorum first, added only if missing.
//   4. verify         — read back each participant's quorum list
//
// No RBT / funding required for any of these steps.
//
// Usage:
//   node orchestrator/wire-network.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  registerDid,
  setupQuorum,
  addQuorumIfMissing,
  getAllQuorum,
  PASSWORD,
} from "./rubix.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || __dirname;
const registry = JSON.parse(readFileSync(join(DATA_DIR, "node_registry.json"), "utf8"));

const nodes = Object.entries(registry.nodes).map(([name, n]) => ({ name, ...n }));
const quorumNodes = nodes.filter((n) => n.role === "quorum");
const participantNodes = nodes.filter((n) => n.role !== "quorum");
const quorumDids = quorumNodes.map((q) => q.did);

let failures = 0;

async function step1_registerDids() {
  console.log("\n[1/4] Registering every DID (two-step signature flow)...");
  for (const n of nodes) {
    try {
      const r = await registerDid(n.baseUrl, n.did, PASSWORD);
      const msg = (r.message || "").toLowerCase();
      const ok = r.status && (msg.includes("register") || msg.includes("already"));
      console.log(`   ${n.name}: ${ok ? "registered — " + r.message : "FAILED — " + r.message}`);
      if (!ok) failures++;
    } catch (e) {
      console.log(`   ${n.name}: ERROR — ${e.message}`);
      failures++;
    }
  }
}

async function step2_setupQuorums() {
  console.log("\n[2/4] setup-quorum on quorum nodes...");
  for (const q of quorumNodes) {
    const r = await setupQuorum(q.baseUrl, q.did, PASSWORD);
    console.log(`   ${q.name} (${q.did}): ${r.status ? "ok" : "FAILED — " + r.message}`);
    if (!r.status) failures++;
  }
}

async function step3_addQuorums() {
  console.log("\n[3/4] addquorum on participants (idempotent)...");
  for (const p of participantNodes) {
    const results = [];
    for (const qDid of quorumDids) {
      const r = await addQuorumIfMissing(p.baseUrl, qDid);
      if (r.skipped) results.push("already-present");
      else if (r.status) results.push("added");
      else {
        results.push("FAILED:" + r.message);
        failures++;
      }
    }
    console.log(`   ${p.name}: ${results.join(", ")}`);
  }
}

async function step4_verify() {
  console.log("\n[4/4] Verify — quorum list per participant...");
  for (const p of participantNodes) {
    const list = await getAllQuorum(p.baseUrl);
    const hasOne = quorumDids.some((d) => list.includes(d));
    console.log(`   ${p.name}: ${list.length} quorum(s) ${hasOne ? "✓" : "✗ none of ours"}`);
    if (!hasOne) failures++;
  }
}

async function main() {
  console.log("== Step 2: wiring the network ==");
  console.log(
    `Nodes: ${nodes.length} | quorum: ${quorumNodes.map((q) => q.name).join(", ")} | participants: ${participantNodes.length}`
  );

  await step1_registerDids();
  await step2_setupQuorums();
  await step3_addQuorums();
  await step4_verify();

  console.log("\n== Done ==");
  if (failures === 0) {
    console.log("Network wired: DIDs registered, quorums set up and present on all participants.");
    console.log("Next: with RBT in node1 (+ quorums), create + transfer FTs.");
  } else {
    console.log(`Completed with ${failures} issue(s) — review lines marked FAILED / ✗.`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
