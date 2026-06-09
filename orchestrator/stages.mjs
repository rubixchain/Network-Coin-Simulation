// v2 stage engine — multi-brand rewards & redemption demo.
//
// One shared loyalty token (operator-named), minted by node1 (issuer). Provenance
// of "which brand a customer earned from" lives in the ledger, not the token.
//
// Players (DIDs come from ../orchestrator/node_registry.json):
//   issuer            = node1
//   brands A..E       = node2..node6 (their existing registered DIDs)
//   quorums           = node7, node8 (sign automatically)
//   customer wallets  = node9, node10 (host many customer DIDs created at runtime)
//
// All transfers use creatorDID = issuer.did (node1 minted the single token).

import {
  createDid,
  registerDid,
  mintFT,
  transferFT,
  getFTBalance,
  PASSWORD,
} from "./rubix.mjs";

const BRAND_NAMES = ["Brand A", "Brand B", "Brand C", "Brand D", "Brand E"];

// ── small seeded RNG so demos can be repeatable when a seed is given ──────────
function makeRng(seed) {
  if (seed === undefined || seed === null || seed === "") return Math.random;
  let s = Number(seed) >>> 0 || 1;
  return function () {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
function pickN(rng, arr, n) {
  const copy = [...arr];
  const out = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]);
  return out;
}

// ── state ─────────────────────────────────────────────────────────────────────
export function initState(registry) {
  const nodes = Object.entries(registry.nodes).map(([name, n]) => ({ name, ...n }));
  const byRole = (r) => nodes.filter((n) => n.role === r);
  const issuer = nodes.find((n) => n.role === "ft-creator");
  const brandNodes = byRole("holder").slice(0, 5); // node2..node6
  const wallets = byRole("spare"); // node9, node10

  return {
    token: { name: null, minted: 0 },
    // running FT index cursor. FT IDs are `name_<issuerDID>_<index>`, so re-minting
    // the same token on the same issuer must continue past the last used index.
    // Preserved across /api/reset so it always reflects on-chain reality.
    mintCursor: 0,
    // session counter -> token name. 0 = LOYALTY, 1 = LOYALTY-1, ... bumped on
    // each reset so every demo session mints a uniquely-named token.
    tokenSeq: 0,
    issuer: { name: issuer.name, did: issuer.did, baseUrl: issuer.baseUrl },
    brands: brandNodes.map((n, i) => ({
      id: "brand" + (i + 1),
      label: BRAND_NAMES[i] || "Brand " + (i + 1),
      node: n.name,
      did: n.did,
      baseUrl: n.baseUrl,
    })),
    wallets: wallets.map((n) => ({ name: n.name, did: n.did, baseUrl: n.baseUrl })),
    customers: [], // {id, label, node, did, baseUrl, earnedTotal, redeemedTotal, earned:{brandId:amt}}
    ledger: [],
    stageStatus: { 1: false, 2: false, 3: false, 4: false, 5: false },
    settlementResult: null, // frozen { report, settlements } once Settle has run
  };
}

function parseTxId(message = "") {
  const m = message.match(/Transaction\s+([0-9a-f]{64})/i);
  return m ? m[1] : null;
}
function ledgerAdd(state, e) {
  state._seq = (state._seq || 0) + 1;
  const row = { seq: state._seq, ts: new Date().toISOString(), ...e };
  state.ledger.push(row);
  return row;
}

function findByName(state, name) {
  if (state.issuer.name === name || state.issuer.label === name) return state.issuer;
  return (
    state.brands.find((b) => b.id === name || b.label === name || b.node === name) ||
    state.customers.find((c) => c.id === name) ||
    null
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────
async function doTransfer(state, from, to, amount, stage, memo) {
  const fromId = from.id || from.name;
  const toId = to.id || to.name;
  // mark this transfer as in-flight BEFORE awaiting, so the UI can start the dot
  // moving the instant the transfer is initiated. aid links it to its ledger row.
  const aid = (state._aid = (state._aid || 0) + 1);
  state.inflight = {
    aid, stage, from: fromId, to: toId,
    fromLabel: from.label || from.name, toLabel: to.label || to.name, amount,
  };
  const r = await transferFT(from.baseUrl, {
    initiator: from.did,
    owner: to.did,
    ftName: state.token.name,
    numberOfFts: amount,
    creatorDID: state.issuer.did,
    memo: memo || `${stage}`,
    password: PASSWORD,
  });
  state.inflight = null; // transfer resolved
  ledgerAdd(state, {
    aid,
    stage,
    type: "transfer",
    from: fromId,
    fromLabel: from.label || from.name,
    to: toId,
    toLabel: to.label || to.name,
    amount,
    status: !!r.status,
    message: r.message,
    txId: parseTxId(r.message),
  });
  return r;
}

// Token name is chosen by the server per session (not user input): LOYALTY,
// then LOYALTY-1, LOYALTY-2, ... bumped on each reset for guaranteed uniqueness.
export function sessionTokenName(state) {
  const n = state.tokenSeq || 0;
  return n > 0 ? `LOYALTY-${n}` : "LOYALTY";
}

// ── Stage 1: Issue ─────────────────────────────────────────────────────────────
export async function runStage1(state, { count, startIndex, ft_num_start_index } = {}) {
  if (!count) throw new Error("count required");
  const tokenName = sessionTokenName(state); // server-assigned, unique per session
  const tokenCount = Math.ceil(Number(count) / 1000); // whole RBT to back the FTs (1000 FT / RBT)
  // Continue past the last used index unless an explicit start is given.
  const start = Number(startIndex ?? ft_num_start_index ?? state.mintCursor ?? 0);
  const r = await mintFT(state.issuer.baseUrl, {
    did: state.issuer.did,
    ftName: tokenName,
    ftCount: Number(count),
    tokenCount,
    startIndex: start,
    password: PASSWORD,
  });
  if (!r.status) throw new Error("mint failed: " + r.message);
  state.token.name = tokenName;
  state.token.minted += Number(count);
  state.mintCursor = start + Number(count); // next free index
  ledgerAdd(state, {
    stage: "stage1-issue",
    type: "mint",
    from: state.issuer.name,
    fromLabel: "Issuer",
    to: state.issuer.name,
    toLabel: "Issuer",
    amount: Number(count),
    status: true,
    message: r.message,
    txId: parseTxId(r.message),
  });
  state.stageStatus[1] = true;
  return { token: tokenName, minted: Number(count), rbtUsed: tokenCount, startIndex: start, nextStartIndex: state.mintCursor };
}

// ── Stage 2: Distribute issuer -> 5 brands ──────────────────────────────────────
export async function runStage2(state, { perBrand } = {}) {
  if (!state.token.name) throw new Error("run stage 1 first");
  // default: split current issuer balance evenly across brands
  let each = Number(perBrand) || 0;
  if (!each) {
    const bal = await getFTBalance(state.issuer.baseUrl, state.issuer.did);
    const avail = (bal.find((f) => f.name === state.token.name && f.creator === state.issuer.did) || {}).count || 0;
    each = Math.floor(avail / state.brands.length);
  }
  if (each <= 0) throw new Error("issuer has no tokens to distribute");
  const results = [];
  for (const b of state.brands) {
    const r = await doTransfer(state, state.issuer, b, each, "stage2-distribute", `Distribute to ${b.label}`);
    results.push({ brand: b.label, amount: each, status: !!r.status, message: r.message });
  }
  state.stageStatus[2] = true;
  return { perBrand: each, results };
}

// ── Stage 3: Earn ───────────────────────────────────────────────────────────────
// First run creates the customer DIDs. Every run (including re-runs) awards the
// EXISTING customers another round of rewards — re-running Earn never creates new
// customers, it just tops up the ones already in this demo.
export async function runStage3(state, { numCustomers = 8, maxPerAward = 5, seed } = {}) {
  if (!state.token.name) throw new Error("run stages 1-2 first");
  // seed is used exactly as given (same seed -> same round); empty seed -> random
  const rng = makeRng(seed === undefined || seed === "" ? undefined : Number(seed));

  // create customers only on the first Earn
  const firstRun = state.customers.length === 0;
  if (firstRun) {
    for (let i = 0; i < numCustomers; i++) {
      const wallet = state.wallets[i % state.wallets.length];
      const { did } = await createDid(wallet.baseUrl, PASSWORD);
      if (!did) throw new Error("failed to create customer DID");
      await registerDid(wallet.baseUrl, did, PASSWORD);
      state.customers.push({
        id: "cust" + (state.customers.length + 1),
        label: "Customer " + (state.customers.length + 1),
        node: wallet.name,
        did,
        baseUrl: wallet.baseUrl,
        earnedTotal: 0,
        redeemedTotal: 0,
        earned: {},
      });
    }
  }

  // award round: every existing customer earns from 1-3 random brands
  const round = [];
  for (const cust of state.customers) {
    const k = randInt(rng, 1, 3);
    const sources = pickN(rng, state.brands, k);
    for (const b of sources) {
      const amt = randInt(rng, 1, maxPerAward);
      const r = await doTransfer(state, b, cust, amt, "stage3-earn", `${b.label} rewards ${cust.label}`);
      if (r.status) {
        cust.earnedTotal += amt;
        cust.earned[b.id] = (cust.earned[b.id] || 0) + amt;
      }
    }
    round.push({ id: cust.id, node: cust.node, earned: cust.earnedTotal, fromBrands: Object.keys(cust.earned).length });
  }
  state.stageStatus[3] = true;
  return {
    customersCreated: firstRun ? state.customers.length : 0,
    awarded: round,
    multiBrandEarners: round.filter((c) => c.fromBrands >= 2).length,
  };
}

// ── Stage 4: Redeem — customers send points to brands (cross-brand allowed) ──────
export async function runStage4(state, { seed } = {}) {
  if (!state.customers.length) throw new Error("run stage 3 first");
  const rng = makeRng(seed === undefined || seed === "" ? undefined : Number(seed) + 7);
  const redemptions = [];
  for (const cust of state.customers) {
    let available = cust.earnedTotal - cust.redeemedTotal;
    if (available <= 0) continue;
    const nRedeem = randInt(rng, 1, 2);
    for (let j = 0; j < nRedeem && available > 0; j++) {
      const brand = pick(rng, state.brands); // any brand, cross-brand allowed
      const amt = randInt(rng, 1, available);
      const r = await doTransfer(state, cust, brand, amt, "stage4-redeem", `${cust.label} redeems at ${brand.label}`);
      if (r.status) {
        cust.redeemedTotal += amt;
        available -= amt;
        redemptions.push({ customer: cust.id, brand: brand.label, amount: amt });
      }
    }
  }
  state.stageStatus[4] = true;
  return { redemptions, totalRedeemed: redemptions.reduce((s, r) => s + r.amount, 0) };
}

// ── Stage 5: Settle — provenance return, netted ─────────────────────────────────
//
// All brands deal in one fungible loyalty token, but the LEDGER knows where each
// redeemed point was originally earned. When a customer earned points from brand X
// and redeemed them at brand Y, those points are now physically held by Y but
// "belong to" X — so Y returns them home to X. Opposing flows between a pair are
// netted into one transfer. When everything has been redeemed this lands every
// brand back on its float; any residual per brand = points its customers still hold.
//
// Returns:
//   report      : per-brand { float, balance, net, result }
//   settlements : integer transfers [{from,to,amount}]  (from = holder, to = home brand)
function floatsFromLedger(state) {
  const f = {};
  state.brands.forEach((b) => (f[b.id] = 0));
  for (const e of state.ledger) {
    if (e.stage === "stage2-distribute" && e.status && f[e.to] !== undefined) f[e.to] += e.amount;
  }
  return f;
}

export async function computeSettlement(state) {
  if (!state.token.name) return { report: [], settlements: [] };
  const ids = state.brands.map((b) => b.id);
  const label = Object.fromEntries(state.brands.map((b) => [b.id, b.label]));
  const custById = Object.fromEntries(state.customers.map((c) => [c.id, c]));

  // prov[earnBrand][redeemBrand] = points earned from earnBrand that the customer
  // then redeemed at redeemBrand (split across the customer's earn mix). Held by
  // redeemBrand, owned by earnBrand.
  const prov = {};
  ids.forEach((x) => { prov[x] = {}; ids.forEach((y) => (prov[x][y] = 0)); });
  for (const e of state.ledger) {
    if (e.stage !== "stage4-redeem" || !e.status) continue;
    const cust = custById[e.from];
    if (!cust) continue;
    const redeemBrand = e.to;
    const earned = cust.earned || {};
    const earnedTotal = Object.values(earned).reduce((s, v) => s + v, 0) || 1;
    for (const [earnBrand, eAmt] of Object.entries(earned)) {
      if (earnBrand === redeemBrand) continue;
      prov[earnBrand][redeemBrand] += e.amount * (eAmt / earnedTotal);
    }
  }

  // net each pair: holder returns the home brand's points home
  const settlements = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const A = ids[i], B = ids[j];
      const aReturnsToB = prov[B][A]; // A holds B's points -> A returns to B
      const bReturnsToA = prov[A][B]; // B holds A's points -> B returns to A
      const net = aReturnsToB - bReturnsToA;
      const amount = Math.round(Math.abs(net));
      if (amount <= 0) continue;
      if (net > 0) settlements.push({ from: A, fromLabel: label[A], to: B, toLabel: label[B], amount });
      else settlements.push({ from: B, fromLabel: label[B], to: A, toLabel: label[A], amount });
    }
  }

  // live balances + float for the report
  const floats = floatsFromLedger(state);
  const balances = {};
  await Promise.all(
    state.brands.map(async (b) => {
      const fts = await getFTBalance(b.baseUrl, b.did);
      balances[b.id] = (fts.find((f) => f.name === state.token.name && f.creator === state.issuer.did) || {}).count || 0;
    })
  );
  const inAmt = {}, outAmt = {};
  ids.forEach((x) => { inAmt[x] = 0; outAmt[x] = 0; });
  settlements.forEach((s) => { outAmt[s.from] += s.amount; inAmt[s.to] += s.amount; });

  const report = state.brands.map((b) => {
    const net = inAmt[b.id] - outAmt[b.id];
    return {
      brand: b.id,
      label: b.label,
      float: floats[b.id] || 0,
      balance: balances[b.id] || 0,
      net,
      result: (balances[b.id] || 0) + net,
    };
  });

  return { report, settlements };
}

export async function runStage5(state) {
  if (!state.stageStatus[4]) throw new Error("run stage 4 first");
  if (state.stageStatus[5]) throw new Error("already settled — Reset the demo to settle again");
  const { report, settlements } = await computeSettlement(state);
  const transfers = [];
  for (const s of settlements) {
    const from = state.brands.find((b) => b.id === s.from);
    const to = state.brands.find((b) => b.id === s.to);
    const res = await doTransfer(state, from, to, s.amount, "stage5-settle", `Settlement ${from.label}→${to.label}`);
    transfers.push({ from: from.label, to: to.label, amount: s.amount, status: !!res.status });
  }
  state.settlementResult = { report, settlements }; // freeze the executed settlement for display
  state.stageStatus[5] = true;
  return { report, settlements, transfers };
}

// ── live holdings for issuer + brands + customers ───────────────────────────────
export async function liveHoldings(state) {
  if (!state.token.name) return { token: null, issuer: 0, brands: [], customers: [] };
  const get = async (did, baseUrl) => {
    const fts = await getFTBalance(baseUrl, did);
    return (fts.find((f) => f.name === state.token.name && f.creator === state.issuer.did) || {}).count || 0;
  };
  const [issuerBal, brandBals, custBals] = await Promise.all([
    get(state.issuer.did, state.issuer.baseUrl),
    Promise.all(state.brands.map((b) => get(b.did, b.baseUrl))),
    Promise.all(state.customers.map((c) => get(c.did, c.baseUrl))),
  ]);
  return {
    token: state.token.name,
    issuer: issuerBal,
    brands: state.brands.map((b, i) => ({ id: b.id, label: b.label, node: b.node, balance: brandBals[i] })),
    customers: state.customers.map((c, i) => ({
      id: c.id, label: c.label, node: c.node, balance: custBals[i],
      earned: c.earned, earnedTotal: c.earnedTotal, redeemedTotal: c.redeemedTotal,
    })),
  };
}
