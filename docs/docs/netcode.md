---
sidebar_position: 4
---

# Rollback Netcode

## What is rollback netcode?

Rollback netcode is a technique for online multiplayer networking that synchronizes inputs instead of state.

- See this [excellent rollback explainer](https://bymuno.com/post/rollback) by [Muno](https://bymuno.com/)
- Try out the [2-player Mario demo](https://trybloop.gg/nu11/mario) ([source code](https://github.com/bloopgames/bloop/tree/main/games/mario)) inspired by Muno's post

## Adding Rollback Netcode to Your Game

It's easy to create an online multiplayer action game for 2-12 players with Bloop, thanks to the rewindable architecture used by tapes.

If you have a local multiplayer game, you can make it work as an online multiplayer game with 20 lines of code.

### Example: Pong Controls

With these controls for a simple pong-like:

```ts
game.system('gameplay', {
  update({players, bag}) {
    if (players[0].keys.arrowUp.held) {
      bag.leftPaddle.y += 5;
    }
    if (players[0].keys.arrowDown.held) {
      bag.leftPaddle.y -= 5;
    }
    if (players[1].keys.w.held) {
      bag.rightPaddle.y += 5;
    }
    if (players[1].keys.s.held) {
      bag.rightPaddle.y -= 5;
    }
  }
})
```

### Adding Matchmaking

You can add rollback netcode like this:

```ts
game.system('matchmaking', {
  keydown({event, net, bag}) {
    // create or join a room called 'TEST'
    if (event.key == 'Enter') {
      net.wantsRoomCode = 'TEST'
      bag.status = 'Waiting for opponent...'
    }
  },

  netcode({event}) {
    // a rollback session is started when someone else joins the room
    if (event.type === 'session:start') {
      bag.status = 'Opponent joined! Start game'
    }
  }
})
```

## Under the Hood

Bloop handles all the complexity for you:

- Uses a websocket server for signaling
- Establishes a peer-to-peer connection using WebRTC
- Sends packets each frame with unacked local inputs
- Listens for incoming packets and tracks confirmed state
- Listens for packet events and reconciles inputs between peers
- Performs rollback and resimulation using your game systems
