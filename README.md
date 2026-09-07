# Bay — phone remote for your garage

Control your automatic garage door from your phone. Bay unlocks with a passcode, then pulses a relay that acts like your wall button.

## Does it actually open the door?

**Software path: yes.** `npm start` runs Bay + a local relay controller. Open/Close on your phone hits the relay API (you’ll see `★ PULSE` in the terminal).

**Physical garage: yes, after one-time wiring.** Flash the included ESP32 sketch, connect a relay across your opener’s wall-button terminals, point `ESP_URL` at the ESP’s IP. Same API as the mock — no app changes.

## Quick start (working live demo)

```bash
cp .env.example .env
npm start
```

Open `http://<your-computer-lan-ip>:8787` on your phone (same Wi‑Fi).  
Default PIN: `1234` (change `GARAGE_PIN`).

You should see **Controller online** after unlock. Tapping Open prints a relay pulse in the terminal.

### Add to home screen

iPhone/Android → Share / menu → **Add to Home Screen**.

## Make it control your real garage

### Parts
- ESP32 board (~$5–10)
- 1-channel relay module
- 2 wires to the opener wall-button screws

### Wiring
1. **Kill power** to the opener first.
2. Relay **COM** and **NO** → the two wall-button terminals on the opener (parallel with the existing indoor button — don’t remove it).
3. Relay input → ESP32 `GPIO 26` (or change `RELAY_PIN` in the sketch), plus VCC/GND per your module.

```
[ESP32] -----> [Relay IN]
                 COM ●--------● Opener wall terminal A
                 NO  ●--------● Opener wall terminal B
```

Classic openers only **toggle**. Open and Close in Bay both pulse the same button; keep the door in view when you use it.

### Flash the ESP32
1. Arduino IDE → ESP32 board package  
2. Open `hardware/esp32-bay-relay/esp32-bay-relay.ino`  
3. Set `WIFI_SSID`, `WIFI_PASS`, `DEVICE_KEY`  
4. Upload; Serial Monitor (115200) shows the IP  

### Point Bay at the ESP

```env
DRIVER=esp
ESP_URL=http://192.168.1.50
DEVICE_KEY=bay-dev-key
GARAGE_PIN=your-strong-pin
```

Then `npm start` (or `npm run start:ui` if you don’t need the mock relay).

### Chamberlain / LiftMaster Security+ 2.0
A dry-contact relay often won’t work. Use [ratgdo](https://github.com/ratgdo/esp8266) + Home Assistant, then set `DRIVER=webhook`.

## Safety
- Disconnect power before wiring.
- LAN or VPN only — do not expose ports 8787/8788 to the public internet.
- Change `GARAGE_PIN` and `DEVICE_KEY` from defaults.
- Sessions expire after `SESSION_HOURS` (default 12).

## Scripts

| Command | What it runs |
|---------|----------------|
| `npm start` | Mock relay + Bay (`DRIVER=esp`) — full working stack |
| `npm run start:ui` | Bay only |
| `npm run start:relay` | Mock relay only |
| `npm run start:simulate` | UI demo with no relay |

## API

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/unlock` | no | `{ "pin": "...." }` → session token |
| POST | `/api/lock` | yes | End session |
| GET | `/api/status` | optional | Door state + hardware probe |
| GET | `/api/hardware` | yes | Relay controller health |
| POST | `/api/command` | yes | `{ "action": "open" \| "close" \| "toggle" }` |

Relay device API (mock or ESP32): `POST /open|/close|/toggle|/pulse` with header `X-Bay-Key`.

## Away-from-home
Use Tailscale/WireGuard to reach your home server, then open Bay on your phone.
