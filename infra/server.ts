console.log("Listening on port 3000...");

const peerIds = new Map<Bun.ServerWebSocket<undefined>, string>();

const serverId = crypto.randomUUID();

Bun.serve({
  async fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/ws") {
      if (server.upgrade(req)) {
        return;
      }
      return new Response("Upgrade failed", { status: 500 });
    }

    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = `./dist${path}`;
    const file = Bun.file(filePath);
    const exists = await file.exists();
    if (!exists) {
      return new Response(`Not found: ${filePath}`, { status: 404 });
    }
    return new Response(file);
  },
  websocket: {
    message(ws, message) {
      const id = peerIds.get(ws);

      const isString = typeof message === "string";
      console.log({ event: "message", message, id });

      for (const [peer, _otherId] of peerIds) {
        if (peer === ws) continue;
        if (isString) {
          try {
            const json = JSON.parse(message);
            peer.send(
              JSON.stringify({
                type: "message:json",
                peerId: id,
                message: json,
              }),
            );
          } catch (e) {
            console.warn("Failed to parse message as JSON", e);
            peer.send(
              JSON.stringify({ type: "message:string", peerId: id, message }),
            );
          }
        } else {
          peer.send(
            JSON.stringify({ type: "message:buffer", peerId: id, message }),
          );
        }
      }
    },
    open(ws) {
      const id = crypto.randomUUID();
      peerIds.set(ws, id);
      console.log({ event: "open", id });
      ws.send(
        JSON.stringify({
          type: "welcome",
          yourId: id,
          peerIds: Array.from(peerIds.values()),
          serverId,
        }),
      );

      for (const [peer] of peerIds) {
        if (peer === ws) continue;
        peer.send(JSON.stringify({ type: "peer:connect", peerId: id }));
      }
    },
    close(ws, code, reason) {
      const id = peerIds.get(ws);
      if (!id) {
        console.warn("Could not find peer id on close");
      }
      console.log({ event: "close", id, code, reason });
      peerIds.delete(ws);
      for (const [peer] of peerIds) {
        peer.send(JSON.stringify({ type: "peer:disconnect", peerId: id }));
      }
    },
    drain(ws) {
      console.log({ event: "drain" });
    },
  },
});
