# Bay — phone remote for your garage

Control your automatic garage door from your phone. Bay is a passcode-locked remote that runs on your home network and can trigger real hardware through a webhook.

## Important

- This is for **your own** garage.
- Do **not** put your real passcode in git. Set it in `.env` only.
- A phone app alone cannot open a garage. You need a small controller that presses the wall-button circuit (or a smart opener integration).

## Quick start (demo mode)

```bash
cp .env.example .env
# edit GARAGE_PIN in .env
npm start
```

Open `http://<your-computer-lan-ip>:8787` on your phone (same Wi‑Fi).

Default demo PIN is `1234` until you change `GARAGE_PIN`.

### Add to home screen

On iPhone/Android, open Bay in the browser → Share / menu → **Add to Home Screen**. It launches like an app.

## Wire it to a real opener

Most automatic openers have a wall button that simply shorts two low-voltage terminals. A relay or dry-contact smart module can mimic that press.

### Option A — Home Assistant / Shelly / ESP webhook (recommended with this app)

1. Install a dry-contact device across the opener’s wall-button terminals (Shelly 1, ESP32 + relay, etc.).
2. Create an automation or HTTP endpoint that pulses the relay (~0.5s).
3. In `.env`:

```env
DRIVER=webhook
WEBHOOK_URL=https://homeassistant.local:8123/api/webhook/your-garage-hook
WEBHOOK_OPEN_BODY={"action":"open"}
WEBHOOK_CLOSE_BODY={"action":"close"}
WEBHOOK_TOGGLE_BODY={"action":"toggle"}
WEBHOOK_HEADERS={"Authorization":"Bearer YOUR_TOKEN"}
```

If your hardware only supports a single “press” (like the wall button), point open/close/toggle at the same pulse endpoint and rely on the opener’s toggle behavior.

### Option B — ratgdo (Chamberlain / LiftMaster Security+ 2.0)

Many modern Chamberlain/LiftMaster units need [ratgdo](https://github.com/ratgdo/esp8266) instead of a simple relay. Expose it to Home Assistant, then point Bay’s webhook at that automation.

### Safety notes

- Disconnect power before wiring terminals.
- Keep Bay on your LAN or behind a VPN (Tailscale, WireGuard). Do not expose port 8787 to the public internet.
- Use a strong `GARAGE_PIN` and change it from the default.
- Sessions expire after `SESSION_HOURS` (default 12).

## API

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/unlock` | no | `{ "pin": "...." }` → session token |
| POST | `/api/lock` | yes | End session |
| GET | `/api/status` | optional | Door state + auth flag |
| POST | `/api/command` | yes | `{ "action": "open" \| "close" \| "toggle" }` |

Send `Authorization: Bearer <token>` after unlock.

## Away-from-home access

Use Tailscale/WireGuard to reach your home server, then open Bay’s URL on your phone. That keeps the passcode gate and avoids opening the garage port to the world.
