import http from "http";
import { WebSocketServer } from "ws";
import { ocppEvents } from "../ocpp/ocppEvents.js";

export function startMobileSocket() {
    const server = http.createServer();

    const wss = new WebSocketServer({
        server,
        path: "/ws/mobile",
    });

    // 📱 Mobile connects
    wss.on("connection", (ws, req) => {
        const url = new URL(req.url, "http://localhost");
        const chargerId = url.searchParams.get("chargerId");

        if (!chargerId) {
            ws.close();
            return;
        }

        ws.chargerId = chargerId;

        console.log("📱 Mobile connected for charger:", chargerId);

        ws.on("close", () => {
            console.log("📱 Mobile disconnected:", chargerId);
        });
    });

    // ⚡ Listen meter updates from OCPP
    ocppEvents.on("session:meterUpdate", (data) => {
        const msg = JSON.stringify({
            type: "METER_UPDATE",
            payload: data,
        });

        wss.clients.forEach((client) => {
            if (
                client.readyState === 1 &&
                client.chargerId === data.chargerId   // 🔥 filter by charger
            ) {
                client.send(msg);
            }
        });
    });

    // 🔌 Start mobile WS server
    server.listen(7074, () => {
        console.log("📱 Mobile WS running on ws://localhost:7074/ws/mobile");
    });
}
