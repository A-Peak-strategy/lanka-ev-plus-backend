# OCPP Real Charger Setup Guide

## Overview

To connect a real OCPP 1.6 charger to this Central System, you need to:

1. **Register the charger** in the backend (via Admin API or seed)
2. **Configure the charger** with the OCPP WebSocket server URL
3. Ensure the charger can reach your server over the network

---

## 1. Register the Charger

### Option A: Admin API (recommended for real chargers)

**POST** `/api/admin/chargers`

```json
{
  "serialNumber": "YOUR_CHARGER_SERIAL",
  "id": "charger-id-for-url",
  "stationId": "station-uuid",
  "numberOfConnectors": 2
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `serialNumber` | Yes | Unique serial from charger label/datasheet |
| `id` | No | Charger ID used in WebSocket URL (defaults to serialNumber) |
| `stationId` | No | UUID of the station this charger belongs to |
| `numberOfConnectors` | No | Number of connectors (default: 1) |

**Example (cURL):**
```bash
curl -X POST http://localhost:7070/api/admin/chargers \
  -H "Content-Type: application/json" \
  -d '{
    "serialNumber": "ABB-2024-001",
    "id": "CP-COLOMBO-01",
    "stationId": "<station-uuid-from-db>",
    "numberOfConnectors": 2
  }'
```

**Important:** The `id` you use here is what the charger must use in its WebSocket URL path.

### Option B: Add to seed (for development)

Edit `prisma/seed.js` and add a charger entry, then run `npm run db:seed`.

---

## 2. OCPP WebSocket Server URL

**Format:**
```
ws://<HOST>:<PORT>/<CHARGER_ID>
```

**Examples:**
- Local: `ws://localhost:7070/CP-COLOMBO-01`
- Same machine: `ws://127.0.0.1:7070/CP-COLOMBO-01`
- LAN (server IP 192.168.1.100): `ws://192.168.1.100:7070/CP-COLOMBO-01`
- Domain: `ws://your-domain.com:7070/CP-COLOMBO-01`

**Your current config (from .env):**
- Port: `7070` (or `process.env.PORT`)
- Base URL: `ws://YOUR_SERVER_IP_OR_HOST:7070/`

**Production:** Use `wss://` (TLS) if your server has SSL. You may need a reverse proxy (e.g. nginx) to terminate TLS for WebSockets.

---

## 3. Charger Configuration

On your physical charger (via its display, config tool, or vendor portal):

1. **OCPP Central System URL** → Set to `ws://<your-server>:7070/<charger-id>`
2. **Charger ID** → Must match the `id` you used when registering
3. **OCPP Version** → 1.6
4. **Protocol** → WebSocket, subprotocol: `ocpp1.6`

---

## 4. Checklist

- [ ] Charger registered via `POST /api/admin/chargers` (or in seed)
- [ ] Station exists and is assigned (optional but recommended for billing)
- [ ] Charger ID in URL matches the registered charger `id`
- [ ] Firewall allows incoming TCP on port 7070 (or your PORT)
- [ ] Charger and server can reach each other on the network

---

## 5. Verify Connection

When the charger connects successfully, you should see in the server logs:

```
🔌 Charger connected: CP-COLOMBO-01 from <ip>
[BOOT] CP-COLOMBO-01: <vendor> <model>
```

You can also list chargers: `GET /api/admin/chargers` or `GET /api/chargers`
