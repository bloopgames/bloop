---
sidebar_position: 1
slug: /
---

# Introduction

**Rewind game sessions and edit code live.**

## Why Bloop?

Game engines like Godot and Unity are primarily *rendering* engines - simulation is tightly coupled to rendering and can only step forward, making it increasingly difficult to iterate as the game grows.

Imagine a movie editing software that only allowed you to play the movie forward without being able to rewind or jump to a moment in time. This would obviously make film editing much harder, and yet it's the cutting edge of game development today.

Meanwhile, people working on the web enjoy the benefits of hot reloading, declarative rendering and time-travel debugging.

Bloop is an experimental npm package that lets you edit your 2D game logic live while replaying any gameplay session:

- Hot reload code changes instantly while playing your game
- Record any gameplay session as a "tape"
- Edit code live while rewinding and seeking through a tape
- Rollback netcode built in - every local multiplayer game is an online multiplayer game!

## Quickstart

Bloop has 0 dependencies. Experiment with it in 30 seconds:

```bash
bun create bloop@latest
```

## Features

- Unit testable game logic
- Record gameplay "tapes"
- Rewind any live or recorded gameplay session
- Hot reload code changes during a rewinded play session
- Rollback netcode for online multiplayer

## Demo

Try out the [2-player Mario demo](https://trybloop.gg/nu11/mario) ([source code](https://github.com/bloopgames/bloop/tree/main/games/mario)) to see rollback netcode in action.
