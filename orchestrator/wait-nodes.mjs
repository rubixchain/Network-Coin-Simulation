#!/usr/bin/env node
// Block until all 10 node HTTP APIs respond. Used by the container entrypoint
// before bootstrap/wiring. Reaches nodes via their host-published ports
// (the orchestrator container runs on the host network).
const HOST = process.env.NODE_HOST || "localhost";
const PORTS = [20000, 20001, 20002, 20003, 20004, 20005, 20006, 20007, 20008, 20009];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const p of PORTS) {
  process.stdout.write(`[wait] ${HOST}:${p} `);
  let ok = false;
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`http://${HOST}:${p}/api/ping`, { signal: AbortSignal.timeout(2500) });
      if (res.ok) { ok = true; break; }
    } catch { /* not up yet */ }
    process.stdout.write(".");
    await sleep(3000);
  }
  console.log(ok ? " ready" : " NOT READY");
  if (!ok) { console.error(`node on port ${p} never came up`); process.exit(1); }
}
console.log("[wait] all nodes ready");
