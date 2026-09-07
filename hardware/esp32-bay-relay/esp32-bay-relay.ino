/*
 * Bay garage relay — ESP32 firmware
 *
 * What it does:
 *   Connects to your Wi‑Fi and exposes the same HTTP API as mock-relay.js.
 *   Each /open, /close, /toggle, or /pulse request briefly closes a relay,
 *   which should be wired across your opener's wall-button terminals
 *   (the same two screws the indoor button uses).
 *
 * Hardware:
 *   - ESP32 board
 *   - Relay module (3.3V or 5V-compatible with transistor driver)
 *   - Relay COM + NO → garage opener wall-button terminals
 *
 * Setup (Arduino IDE):
 *   1. Board: ESP32 Dev Module
 *   2. Install "ESP32" boards via Boards Manager
 *   3. Edit WIFI_SSID, WIFI_PASS, DEVICE_KEY, RELAY_PIN below
 *   4. Upload, open Serial Monitor at 115200 for the IP address
 *   5. In Bay .env:
 *        DRIVER=esp
 *        ESP_URL=http://192.168.x.x
 *        DEVICE_KEY=same-key-as-below
 *
 * Safety: disconnect opener power before wiring. Keep this device on LAN only.
 */

#include <WiFi.h>
#include <WebServer.h>

// ========== EDIT THESE ==========
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";
const char* DEVICE_KEY = "bay-dev-key";  // must match Bay .env DEVICE_KEY
const int RELAY_PIN = 26;                // GPIO driving the relay
const bool RELAY_ACTIVE_LOW = true;      // most modules are active-low
const int DEFAULT_PULSE_MS = 500;
// ================================

WebServer server(80);
unsigned long pulses = 0;
String lastAction = "none";
String lastPulseAt = "never";

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  setRelay(false);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("Bay relay online: http://");
  Serial.println(WiFi.localIP());

  server.on("/health", HTTP_GET, handleHealth);
  server.on("/status", HTTP_GET, handleStatus);
  server.on("/pulse", HTTP_POST, handlePulse);
  server.on("/open", HTTP_POST, handlePulse);
  server.on("/close", HTTP_POST, handlePulse);
  server.on("/toggle", HTTP_POST, handlePulse);
  server.begin();
}

void loop() {
  server.handleClient();
}

bool authorized() {
  if (!server.hasHeader("X-Bay-Key")) return false;
  return server.header("X-Bay-Key") == String(DEVICE_KEY);
}

void handleHealth() {
  server.send(200, "application/json",
              "{\"ok\":true,\"device\":\"bay-esp32-relay\",\"role\":\"garage-wall-button\"}");
}

void handleStatus() {
  if (!authorized()) {
    server.send(401, "application/json", "{\"error\":\"Unauthorized\"}");
    return;
  }
  String body = "{";
  body += "\"ok\":true,";
  body += "\"device\":\"bay-esp32-relay\",";
  body += "\"pulses\":" + String(pulses) + ",";
  body += "\"lastAction\":\"" + lastAction + "\",";
  body += "\"lastPulseAt\":\"" + lastPulseAt + "\",";
  body += "\"ip\":\"" + WiFi.localIP().toString() + "\"";
  body += "}";
  server.send(200, "application/json", body);
}

void handlePulse() {
  if (!authorized()) {
    server.send(401, "application/json", "{\"error\":\"Unauthorized\"}");
    return;
  }

  int ms = DEFAULT_PULSE_MS;
  // Optional JSON body: {"ms":500}
  if (server.hasArg("plain")) {
    String plain = server.arg("plain");
    int idx = plain.indexOf("\"ms\"");
    if (idx >= 0) {
      int colon = plain.indexOf(':', idx);
      if (colon >= 0) {
        ms = constrain(plain.substring(colon + 1).toInt(), 50, 2000);
      }
    }
  }

  String action = server.uri().substring(1); // open|close|toggle|pulse
  doPulse(ms, action);

  String body = "{";
  body += "\"ok\":true,";
  body += "\"action\":\"" + action + "\",";
  body += "\"pulsedMs\":" + String(ms) + ",";
  body += "\"pulses\":" + String(pulses);
  body += "}";
  server.send(200, "application/json", body);
}

void doPulse(int ms, const String& action) {
  lastAction = action;
  lastPulseAt = String(millis()) + "ms";
  pulses++;
  Serial.printf("PULSE #%lu action=%s %dms\n", pulses, action.c_str(), ms);
  setRelay(true);
  delay(ms);
  setRelay(false);
}

void setRelay(bool on) {
  if (RELAY_ACTIVE_LOW) {
    digitalWrite(RELAY_PIN, on ? LOW : HIGH);
  } else {
    digitalWrite(RELAY_PIN, on ? HIGH : LOW);
  }
}
