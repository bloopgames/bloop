This is a barebones websocket broker server for testing netcode and webrtc.

It is deployed to a single instance on fly.io, currently it won't work on multiple instances.

To run locally:

```bash
bun server.ts
```

To deploy:

```bash
fly deploy
```