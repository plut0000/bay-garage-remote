(() => {
  const TOKEN_KEY = "bay.garage.token";

  const lockScreen = document.getElementById("lock-screen");
  const remoteScreen = document.getElementById("remote-screen");
  const unlockForm = document.getElementById("unlock-form");
  const pinInput = document.getElementById("pin");
  const lockError = document.getElementById("lock-error");
  const door = document.getElementById("door");
  const statusLabel = document.getElementById("status-label");
  const remoteMsg = document.getElementById("remote-msg");
  const lockBtn = document.getElementById("lock-btn");

  let token = localStorage.getItem(TOKEN_KEY) || "";
  let busy = false;

  boot();

  unlockForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    lockError.hidden = true;
    const pin = pinInput.value.trim();
    if (!pin) return;

    setFormBusy(true);
    try {
      const data = await api("/api/unlock", {
        method: "POST",
        body: { pin },
        auth: false,
      });
      token = data.token;
      localStorage.setItem(TOKEN_KEY, token);
      pinInput.value = "";
      showRemote(data.state || "closed");
    } catch (err) {
      lockError.textContent = err.message || "Could not unlock";
      lockError.hidden = false;
    } finally {
      setFormBusy(false);
    }
  });

  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => sendCommand(btn.dataset.action));
  });

  lockBtn.addEventListener("click", async () => {
    try {
      await api("/api/lock", { method: "POST" });
    } catch {
      /* still clear local session */
    }
    token = "";
    localStorage.removeItem(TOKEN_KEY);
    showLock();
  });

  async function boot() {
    if (!token) {
      showLock();
      return;
    }
    try {
      const status = await api("/api/status", { method: "GET" });
      if (!status.authenticated) {
        token = "";
        localStorage.removeItem(TOKEN_KEY);
        showLock();
        return;
      }
      showRemote(status.state);
    } catch {
      showLock();
    }
  }

  async function sendCommand(action) {
    if (busy) return;
    busy = true;
    setControlsDisabled(true);
    remoteMsg.hidden = true;

    const optimistic =
      action === "open"
        ? "opening"
        : action === "close"
          ? "closing"
          : door.classList.contains("open") || door.classList.contains("opening")
            ? "closing"
            : "opening";
    setDoorState(optimistic);

    try {
      const result = await api("/api/command", {
        method: "POST",
        body: { action },
      });
      setDoorState(result.state);
      if (result.message) {
        remoteMsg.textContent = result.message;
        remoteMsg.hidden = false;
      }
      pollUntilSettled();
    } catch (err) {
      remoteMsg.textContent = err.message || "Command failed";
      remoteMsg.hidden = false;
      refreshStatus();
    } finally {
      busy = false;
      setControlsDisabled(false);
    }
  }

  async function pollUntilSettled() {
    for (let i = 0; i < 8; i += 1) {
      await wait(400);
      const status = await refreshStatus();
      if (!status) return;
      if (status.state === "open" || status.state === "closed" || status.state === "unknown") {
        return;
      }
    }
  }

  async function refreshStatus() {
    try {
      const status = await api("/api/status", { method: "GET" });
      if (!status.authenticated) {
        showLock();
        return null;
      }
      setDoorState(status.state);
      return status;
    } catch {
      return null;
    }
  }

  function showLock() {
    remoteScreen.hidden = true;
    lockScreen.hidden = false;
    pinInput.focus();
  }

  function showRemote(state) {
    lockScreen.hidden = true;
    remoteScreen.hidden = false;
    setDoorState(state);
  }

  function setDoorState(state) {
    door.classList.remove("open", "closed", "opening", "closing");
    door.classList.add(state || "closed");
    statusLabel.dataset.state = state || "closed";
    statusLabel.textContent = labelFor(state);
  }

  function labelFor(state) {
    switch (state) {
      case "open":
        return "Open";
      case "opening":
        return "Opening…";
      case "closing":
        return "Closing…";
      case "unknown":
        return "Status unknown";
      default:
        return "Closed";
    }
  }

  function setFormBusy(isBusy) {
    unlockForm.querySelector("button").disabled = isBusy;
    pinInput.disabled = isBusy;
  }

  function setControlsDisabled(disabled) {
    document.querySelectorAll("[data-action]").forEach((btn) => {
      btn.disabled = disabled;
    });
  }

  async function api(path, { method = "GET", body, auth = true } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (auth && token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status})`);
    }
    return data;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
