"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

loadEnvFile(path.join(__dirname, "..", ".env"));

const PORT = Number(process.env.PORT || 8787);
const PIN = String(process.env.GARAGE_PIN || "1234");
const SESSION_MS = Number(process.env.SESSION_HOURS || 12) * 60 * 60 * 1000;
const DRIVER = (process.env.DRIVER || "simulate").toLowerCase();
const PUBLIC_DIR = path.join(__dirname, "..", "public");

/** @type {Map<string, number>} */
const sessions = new Map();

/** @type {"unknown" | "open" | "closed" | "opening" | "closing"} */
let doorState = "closed";
let lastActionAt = null;
let actionTimer = null;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    serveStatic(res, url.pathname);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: "Server error" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Bay garage remote listening on http://0.0.0.0:${PORT}`);
  console.log(`Driver: ${DRIVER}`);
  if (PIN === "1234") {
    console.warn("Warning: using default PIN 1234 — set GARAGE_PIN in .env");
  }
});

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (url.pathname === "/api/status" && req.method === "GET") {
    const authed = isAuthed(req);
    sendJson(res, 200, {
      ok: true,
      authenticated: authed,
      state: authed ? doorState : "locked",
      driver: DRIVER,
      lastActionAt,
    });
    return;
  }

  if (url.pathname === "/api/unlock" && req.method === "POST") {
    const body = await readJson(req);
    const pin = String(body.pin || "");
    if (!timingSafeEqual(pin, PIN)) {
      await sleep(400);
      sendJson(res, 401, { error: "Incorrect passcode" });
      return;
    }
    const token = issueSession();
    sendJson(res, 200, {
      ok: true,
      token,
      state: doorState,
      expiresInMs: SESSION_MS,
    });
    return;
  }

  if (url.pathname === "/api/lock" && req.method === "POST") {
    revokeSession(req);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/command" && req.method === "POST") {
    if (!isAuthed(req)) {
      sendJson(res, 401, { error: "Unlock required" });
      return;
    }
    const body = await readJson(req);
    const action = String(body.action || "").toLowerCase();
    if (!["open", "close", "toggle"].includes(action)) {
      sendJson(res, 400, { error: "action must be open, close, or toggle" });
      return;
    }

    const result = await runCommand(action);
    sendJson(res, result.ok ? 200 : 502, result);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function runCommand(action) {
  let resolved = action;
  if (action === "toggle") {
    resolved = doorState === "open" || doorState === "opening" ? "close" : "open";
  }

  if (resolved === "open" && (doorState === "open" || doorState === "opening")) {
    return { ok: true, state: doorState, message: "Already open" };
  }
  if (resolved === "close" && (doorState === "closed" || doorState === "closing")) {
    return { ok: true, state: doorState, message: "Already closed" };
  }

  doorState = resolved === "open" ? "opening" : "closing";
  lastActionAt = new Date().toISOString();

  try {
    await dispatchHardware(resolved);
  } catch (err) {
    doorState = "unknown";
    console.error("Hardware dispatch failed:", err.message);
    return { ok: false, state: doorState, error: err.message };
  }

  clearTimeout(actionTimer);
  actionTimer = setTimeout(() => {
    doorState = resolved === "open" ? "open" : "closed";
  }, DRIVER === "simulate" ? 2200 : 12000);

  return { ok: true, state: doorState, action: resolved };
}

async function dispatchHardware(action) {
  if (DRIVER === "simulate") {
    console.log(`[simulate] garage ${action}`);
    return;
  }

  if (DRIVER === "webhook") {
    const webhookUrl = process.env.WEBHOOK_URL;
    if (!webhookUrl) throw new Error("WEBHOOK_URL is not set");

    const bodyKey =
      action === "open"
        ? "WEBHOOK_OPEN_BODY"
        : action === "close"
          ? "WEBHOOK_CLOSE_BODY"
          : "WEBHOOK_TOGGLE_BODY";
    const rawBody = process.env[bodyKey] || JSON.stringify({ action });
    let headers = { "Content-Type": "application/json" };
    if (process.env.WEBHOOK_HEADERS) {
      headers = { ...headers, ...JSON.parse(process.env.WEBHOOK_HEADERS) };
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: rawBody,
    });
    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status}`);
    }
    return;
  }

  throw new Error(`Unsupported DRIVER "${DRIVER}". Use simulate or webhook.`);
}

function issueSession() {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, Date.now() + SESSION_MS);
  return token;
}

function revokeSession(req) {
  const token = getToken(req);
  if (token) sessions.delete(token);
}

function isAuthed(req) {
  const token = getToken(req);
  if (!token) return false;
  const expires = sessions.get(token);
  if (!expires) return false;
  if (Date.now() > expires) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function getToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return null;
}

function serveStatic(res, pathname) {
  let safePath = decodeURIComponent(pathname.split("?")[0]);
  if (safePath === "/") safePath = "/index.html";
  if (safePath.includes("..")) {
    res.writeHead(400);
    res.end("Bad path");
    return;
  }

  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(400);
    res.end("Bad path");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    });
    res.end(data);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    ...corsHeaders(),
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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

function timingSafeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) {
    crypto.timingSafeEqual(bb, bb);
    return false;
  }
  return crypto.timingSafeEqual(aa, bb);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
