// Shared Rubix node API helpers used by every orchestration script.
//
// Many node operations are asynchronous and use a two-step "signature" flow:
//   1. POST the request -> node replies { status:true, message:"Password needed",
//      result:{ id:"<uuid>", hash:null } }
//   2. POST /rubix/v1/signature { id, password } -> node finishes the work and
//      replies the real result, e.g. { status:true, message:"DID registered
//      successfully", result:null }
//
// register-did, mint-ft, faucet/local-rbt and transactions all use this flow.
// create-did, setup-quorum and addquorum are synchronous (single call).
//
// apiSigned() drives the loop automatically: it submits the password whenever
// the node hands back a pending request id, and returns the final response.

const DEFAULT_PASSWORD = "mypassword";
const DEFAULT_TIMEOUT_MS = 180000; // consensus ops can take a while

export async function apiRaw(method, baseUrl, path, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const opts = { method, headers: {}, signal: AbortSignal.timeout(timeoutMs) };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(baseUrl + path, opts);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { status: res.ok, message: text };
  }
  return json;
}

// Returns the id of a pending signature request, or null if the response is final.
function pendingSignatureId(resp) {
  const id = resp?.result?.id;
  if (!id) return null;
  // A final response has result:null (or no id). A pending one carries an id and
  // typically the message "Password needed".
  return id;
}

// Submit a request and automatically complete any signature step(s).
export async function apiSigned(
  baseUrl,
  path,
  { method = "POST", body, password = DEFAULT_PASSWORD, timeoutMs = DEFAULT_TIMEOUT_MS } = {}
) {
  let resp = await apiRaw(method, baseUrl, path, body, timeoutMs);

  let lastId = null;
  for (let guard = 0; guard < 10; guard++) {
    const id = pendingSignatureId(resp);
    if (!id) break; // final response
    if (id === lastId) break; // no progress — avoid infinite loop
    lastId = id;
    resp = await apiRaw(
      "POST",
      baseUrl,
      "/rubix/v1/signature",
      { id, password, signature: "" },
      timeoutMs
    );
  }
  return resp;
}

// ── Convenience wrappers ───────────────────────────────────────────────────

export async function createDid(baseUrl, password = DEFAULT_PASSWORD) {
  const resp = await apiRaw("POST", baseUrl, "/rubix/v1/dids/create", {
    password,
    childPath: 0,
  });
  if (!resp.status) throw new Error(`create-did failed: ${resp.message}`);
  return { did: resp.result?.did, peerId: resp.result?.peer_id || "" };
}

export async function registerDid(baseUrl, did, password = DEFAULT_PASSWORD) {
  return apiSigned(baseUrl, `/rubix/v1/dids/${did}/register`, { password });
}

export async function getPeerId(baseUrl) {
  try {
    const r = await apiRaw("GET", baseUrl, "/api/get-peer-id");
    if (typeof r.result === "string") return r.result.trim();
    return r.result?.peerID || r.result?.peer_id || "";
  } catch {
    return "";
  }
}

export async function getAllQuorum(baseUrl) {
  const r = await apiRaw("GET", baseUrl, "/api/getallquorum");
  return Array.isArray(r.result) ? r.result : [];
}

export async function setupQuorum(baseUrl, did, password = DEFAULT_PASSWORD) {
  // Synchronous: { did, password, priv_password }
  return apiRaw("POST", baseUrl, "/api/setup-quorum", {
    did,
    password,
    priv_password: password,
  });
}

// Idempotent: only adds the quorum DID if it isn't already in the node's list.
export async function addQuorumIfMissing(baseUrl, quorumDid) {
  const current = await getAllQuorum(baseUrl);
  if (current.includes(quorumDid)) return { status: true, skipped: true };
  const r = await apiRaw("POST", baseUrl, "/api/addquorum", { did: quorumDid });
  return { ...r, skipped: false };
}

// ── FT / transfer / balances ───────────────────────────────────────────────

// Mint fungible tokens. Backed by whole RBT (tokenCount). Max 1000 FT per 1 RBT.
// Async signature flow.
export async function mintFT(
  baseUrl,
  { did, ftName, ftCount, tokenCount, startIndex = 0, password = DEFAULT_PASSWORD }
) {
  return apiSigned(baseUrl, "/rubix/v1/fts/mint", {
    password,
    body: {
      did,
      ft_name: ftName,
      ft_count: ftCount,
      token_count: tokenCount,
      ft_num_start_index: startIndex,
    },
  });
}

// Transfer FTs. Sent to the SENDER's node. initiator = sender, owner = receiver.
// Async signature flow (quorum consensus).
export async function transferFT(
  senderBaseUrl,
  { initiator, owner, ftName, numberOfFts, creatorDID, memo = "FT transfer", password = DEFAULT_PASSWORD }
) {
  return apiSigned(senderBaseUrl, "/rubix/v1/tx", {
    password,
    body: {
      initiator,
      owner,
      tokens: {
        rbt: 0,
        ft: [{ ftName, numberOfFts, creatorDID }],
        nft: [],
        smartContract: [],
        transferNftOwnership: false,
      },
      memo,
    },
  });
}

// GET FT balances for a DID -> array of { name, creator, value, count }.
export async function getFTBalance(baseUrl, did) {
  const r = await apiRaw("GET", baseUrl, `/rubix/v1/dids/${did}/balances/ft`);
  return Array.isArray(r.result) ? r.result : [];
}

// GET RBT balance for a DID -> { balance, pledged, locked } (or null on error).
export async function getRBTBalance(baseUrl, did) {
  const r = await apiRaw("GET", baseUrl, `/rubix/v1/dids/${did}/balances/rbt`);
  return r.result || null;
}

export const PASSWORD = DEFAULT_PASSWORD;
