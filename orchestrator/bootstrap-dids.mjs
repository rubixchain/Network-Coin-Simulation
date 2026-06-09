#!/usr/bin/env node
// Milestone 1: create + register one DID on each of the 10 rubix nodes.
//
// Usage:
//   node orchestrator/bootstrap-dids.mjs
//
// Requires Node 18+ (built-in fetch). No npm install needed.
// Assumes the 10-node cluster is already up (./start-10nodes.sh up && ./start-10nodes.sh wait).
//
// Registration is a TWO-step flow (request -> "Password needed" -> POST signature);
// apiSigned() in rubix.mjs handles that automatically.
//
// Writes the resulting map (node -> port, role, did, peerId) to
// orchestrator/node_registry.json.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createDid, registerDid, getPeerId, PASSWORD } from "./rubix.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || __dirname; // persist registry to a volume in-container

const NODES = [
  { name: "node1", port: 20000, role: "ft-creator" },
  { name: "node2", port: 20001, role: "holder" },
  { name: "node3", port: 20002, role: "holder" },
  { name: "node4", port: 20003, role: "holder" },
  { name: "node5", port: 20004, role: "holder" },
  { name: "node6", port: 20005, role: "holder" },
  { name: "node7", port: 20006, role: "quorum" },
  { name: "node8", port: 20007, role: "quorum" },
  { name: "node9", port: 20008, role: "spare" },
  { name: "node10", port: 20009, role: "spare" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForNode(node, { tries = 60, delayMs = 3000 } = {}) {
  const url = `http://localhost:${node.port}/api/ping`;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    process.stdout.write(".");
    await sleep(delayMs);
  }
  return false;
}

async function main() {
  console.log("== Rubix milestone 1: one DID per node ==\n");

  const registry = { network: "testnet", didPassword: PASSWORD, nodes: {} };
  const summary = [];

  for (const node of NODES) {
    const baseUrl = `http://localhost:${node.port}`;
    process.stdout.write(`[${node.name}:${node.port}] waiting for API `);
    const up = await waitForNode(node);
    if (!up) {
      console.log(" NOT READY — skipping");
      summary.push({ ...node, did: "-", registered: false, note: "node not ready" });
      continue;
    }
    console.log(" ready");

    try {
      const { did, peerId: peerFromCreate } = await createDid(baseUrl, PASSWORD);
      if (!did) throw new Error("create-did returned no DID");

      const reg = await registerDid(baseUrl, did, PASSWORD);
      const registered = !!reg.status && /register/i.test(reg.message || "");
      const peerId = peerFromCreate || (await getPeerId(baseUrl));

      registry.nodes[node.name] = {
        port: node.port,
        baseUrl,
        role: node.role,
        did,
        peerId,
        registered,
      };
      summary.push({ ...node, did, registered, note: registered ? "" : reg.message });
      console.log(`   DID:      ${did}`);
      console.log(`   peerId:   ${peerId || "(unknown)"}`);
      console.log(`   register: ${registered ? "ok — " + reg.message : "INCOMPLETE — " + reg.message}\n`);
    } catch (err) {
      summary.push({ ...node, did: "-", registered: false, note: err.message });
      console.log(`   ERROR: ${err.message}\n`);
    }
  }

  const outPath = join(DATA_DIR, "node_registry.json");
  writeFileSync(outPath, JSON.stringify(registry, null, 2));

  console.log("\n== Summary ==");
  console.log("node    port   role         registered  DID");
  for (const s of summary) {
    console.log(
      `${s.name.padEnd(7)} ${String(s.port).padEnd(6)} ${s.role.padEnd(12)} ` +
        `${String(s.registered).padEnd(11)} ${s.did}${s.note ? "  (" + s.note + ")" : ""}`
    );
  }
  console.log(`\nSaved registry -> ${outPath}`);

  const created = summary.filter((s) => s.did !== "-").length;
  const registered = summary.filter((s) => s.registered).length;
  console.log(`\nDIDs created: ${created}/${NODES.length} | registered: ${registered}/${NODES.length}`);
  if (created < NODES.length || registered < NODES.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
