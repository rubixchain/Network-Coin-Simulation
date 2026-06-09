// v2 backend — multi-brand rewards & redemption demo (operations-only).
//
// Separate from v1: own port (4001), own UI (public-v2), own state (entities.json).
// Reuses the validated rubix.mjs primitives and the existing node_registry.json.
//
// Run:
//   cd orchestrator && npm install && node server-v2.mjs
//   open http://localhost:4000

import express from "express";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  initState, runStage1, runStage2, runStage3, runStage4, runStage5,
  computeSettlement, liveHoldings,
} from "./stages.mjs";
import { mintFT, transferFT, PASSWORD } from "./rubix.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || __dirname; // persisted registry + entities (volume in-container)
const registry = JSON.parse(readFileSync(join(DATA_DIR, "node_registry.json"), "utf8"));
const STATE_FILE = join(DATA_DIR, "entities.json");
const PORT = process.env.PORT || 4000;

let state = existsSync(STATE_FILE)
  ? JSON.parse(readFileSync(STATE_FILE, "utf8"))
  : initState(registry);
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "public-v2")));

// wrap an async stage handler: run, persist, return result (or error)
function stage(fn) {
  return async (req, res) => {
    try {
      const result = await fn(state, req.body || {});
      save();
      res.json({ status: true, result });
    } catch (e) {
      save();
      res.status(400).json({ status: false, message: e.message });
    }
  };
}

app.get("/api/state", (_req, res) => {
  res.json({
    token: state.token,
    issuer: state.issuer,
    brands: state.brands,
    wallets: state.wallets,
    customers: state.customers.map((c) => ({
      id: c.id, label: c.label, alias: c.alias, node: c.node, did: c.did,
      earnedTotal: c.earnedTotal, redeemedTotal: c.redeemedTotal, earned: c.earned,
    })),
    stageStatus: state.stageStatus,
    customerCount: state.customers.length,
  });
});

app.get("/api/holdings", async (_req, res) => {
  try { res.json(await liveHoldings(state)); }
  catch (e) { res.status(500).json({ message: e.message }); }
});

app.get("/api/ledger", (_req, res) => res.json({ ledger: state.ledger, inflight: state.inflight || null }));
app.get("/api/settlement", async (_req, res) => {
  // once settled, show the frozen executed settlement; otherwise the live plan
  if (state.stageStatus?.[5] && state.settlementResult) {
    return res.json({ report: state.settlementResult });
  }
  try { res.json({ report: await computeSettlement(state) }); }
  catch (e) { res.status(500).json({ message: e.message }); }
});

app.post("/api/stage/1", stage(runStage1));
app.post("/api/stage/2", stage(runStage2));
app.post("/api/stage/3", stage(runStage3));
app.post("/api/stage/4", stage(runStage4));
app.post("/api/stage/5", stage((s) => runStage5(s)));

// reset demo state (entities + ledger). On-chain tokens persist; this clears the
// off-chain story so you can re-run. Brands/issuer are re-derived from registry.
app.post("/api/reset", (_req, res) => {
  // preserve the on-chain FT index cursor so re-mints never collide with
  // tokens already on-chain (older state may not have mintCursor yet)
  const cursor = state.mintCursor ?? state.token?.minted ?? 0;
  // issuer + brands are persistent entities — keep any aliases the user set
  const issuerAlias = state.issuer?.alias;
  const brandAliases = Object.fromEntries((state.brands || []).filter((b) => b.alias).map((b) => [b.id, b.alias]));
  state = initState(registry);
  state.mintCursor = cursor;
  if (issuerAlias) state.issuer.alias = issuerAlias;
  state.brands.forEach((b) => { if (brandAliases[b.id]) b.alias = brandAliases[b.id]; });
  save();
  res.json({ status: true, message: `demo state reset (mint index cursor preserved at ${cursor})` });
});

// set a display alias for a brand or customer
app.post("/api/alias", (req, res) => {
  const { type, id, alias } = req.body || {};
  const target = type === "brand"
    ? state.brands.find((b) => b.id === id)
    : type === "customer"
      ? state.customers.find((c) => c.id === id)
      : type === "issuer"
        ? state.issuer
        : null;
  if (!target) return res.status(404).json({ status: false, message: "entity not found" });
  target.alias = (alias || "").trim() || undefined;
  save();
  res.json({ status: true, alias: target.alias || null });
});

// ── manual override actions (improvisation during a demo) ──────────────────────
app.post("/api/manual/mint", async (req, res) => {
  const { ftName, ftCount, tokenCount } = req.body || {};
  try {
    const r = await mintFT(state.issuer.baseUrl, {
      did: state.issuer.did, ftName, ftCount: Number(ftCount),
      tokenCount: Number(tokenCount), password: PASSWORD,
    });
    res.json(r);
  } catch (e) { res.status(500).json({ status: false, message: e.message }); }
});

app.post("/api/manual/transfer", async (req, res) => {
  const { fromDid, fromBaseUrl, toDid, ftName, count } = req.body || {};
  try {
    const r = await transferFT(fromBaseUrl, {
      initiator: fromDid, owner: toDid, ftName,
      numberOfFts: Number(count), creatorDID: state.issuer.did, password: PASSWORD,
    });
    res.json(r);
  } catch (e) { res.status(500).json({ status: false, message: e.message }); }
});

app.listen(PORT, () => {
  console.log(`Rubix rewards demo (v2) on http://localhost:${PORT}`);
  console.log(`  issuer: ${state.issuer.name} | brands: ${state.brands.length} | wallets: ${state.wallets.map(w=>w.name).join(",")}`);
  console.log(`  token: ${state.token.name || "(not issued yet)"} | customers: ${state.customers.length}`);
});
