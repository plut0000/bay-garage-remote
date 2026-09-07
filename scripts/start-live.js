"use strict";

/** Starts mock relay + Bay server together for a working live demo. */

const { spawn } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..");
const kids = [];

function run(label, script, env = {}) {
  const child = spawn(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  kids.push(child);
  const tag = (stream) => {
    child[stream].on("data", (buf) => {
      String(buf)
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => console.log(`[${label}] ${line}`));
    });
  };
  tag("stdout");
  tag("stderr");
  child.on("exit", (code) => {
    console.log(`[${label}] exited (${code})`);
    shutdown(code || 0);
  });
  return child;
}

function shutdown(code) {
  for (const child of kids) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("relay", path.join(root, "hardware", "mock-relay.js"), {
  RELAY_PORT: process.env.RELAY_PORT || "8788",
  DEVICE_KEY: process.env.DEVICE_KEY || "bay-dev-key",
});

setTimeout(() => {
  run("bay", path.join(root, "server", "index.js"), {
    DRIVER: process.env.DRIVER || "esp",
    ESP_URL: process.env.ESP_URL || "http://127.0.0.1:8788",
    DEVICE_KEY: process.env.DEVICE_KEY || "bay-dev-key",
    GARAGE_PIN: process.env.GARAGE_PIN || "1234",
    PORT: process.env.PORT || "8787",
  });
  console.log("Bay live stack ready → http://127.0.0.1:8787  (PIN from GARAGE_PIN)");
}, 400);
