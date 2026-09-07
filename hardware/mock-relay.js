"use strict";

/**
 * Local stand-in for the ESP32 relay board.
 * Same HTTP API as hardware/esp32-bay-relay — Bay talks to this in live demo mode.
 *
 * Endpoints:
 *   GET  /health
 *   GET  /status
 *   POST /pulse   { "ms": 500 }   — mimics pressing the wall button
 *   POST /open    — alias for /pulse (classic openers are toggle-only)
 *   POST /close   — alias for /pulse
 *   POST /toggle  — alias for /pulse
 *
 * Auth: header X-Bay-Key: <DEVICE_KEY>
 */

const http = require("http");
const { URL } = require("url");

const PORT = Number(process.env.RELAY_PORT || 8788);
const DEVICE_KEY = String(process.env.DEVICE_KEY || "bay-dev-key");

let pulses = 0;
let lastPulseAt = null;
let lastAction = null;
let relayClosed = false;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors());
    res.end();
    return;
  }

  if (url.pathname === "/health" && req.method === "GET") {
    send(res, 200, { ok: true, device: "bay-mock-relay", role: "garage-wall-button" });
    return;
  }

  if (!authorize(req)) {
    send(res, 401, { error: "Unauthorized — set X-Bay-Key" });
    return;
  }

  if (url.pathname === "/status" && req.method === "GET") {
    send(res, 200, {
      ok: true,
      device: "bay-mock-relay",
      relay: relayClosed ? "closed" : "open",
      pulses,
      lastPulseAt,
      lastAction,
    });
    return;
  }

  if (
    ["/pulse", "/open", "/close", "/toggle"].includes(url.pathname) &&
    req.method === "POST"
  ) {
    const body = await readJson(req);
    const ms = Math.min(Math.max(Number(body.ms || 500), 50), 2000);
    const action = url.pathname.slice(1);
    await pulse(ms, action);
    send(res, 200, {
      ok: true,
      action,
      pulsedMs: ms,
      pulses,
      lastPulseAt,
      note: "Wall-button circuit shorted (toggle). Wire COM/NO across opener wall terminals.",
    });
    return;
  }

  send(res, 404, { error: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[mock-relay] listening on http://0.0.0.0:${PORT}`);
  console.log(`[mock-relay] DEVICE_KEY=${DEVICE_KEY}`);
});

function authorize(req) {
  const key = req.headers["x-bay-key"] || "";
  return key === DEVICE_KEY;
}

async function pulse(ms, action) {
  relayClosed = true;
  lastAction = action;
  lastPulseAt = new Date().toISOString();
  pulses += 1;
  console.log(`[mock-relay] ★ PULSE #${pulses} action=${action} ${ms}ms  (garage wall button pressed)`);
  await sleep(ms);
  relayClosed = false;
  console.log(`[mock-relay]   relay released`);
}

function send(res, status, payload) {
  res.writeHead(status, { ...cors(), "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Bay-Key",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
