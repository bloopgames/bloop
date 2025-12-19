# bloop

## Why can't you rewind your game like a youtube video?

(insert gif here)

If you're a gamedev who is sick of:

* Compile time
* Hot code reload not working
* Spending hours tracking down edge case bugs
* Writing netcode

With bloop, an experimental npm package, you can edit your 2d game logic live while replaying any gameplay session.

- Hot reload code changes instantly while playing your game
- Record any gameplay session as a "tape"
- Edit code live while rewinding and seeking through a tape
- Rollback netcode built in - every local multiplayer game is an online multiplayer game!

[Why Bloop?](./why.md)

## Feature list

Bloop is in early development. The goals for 1.0 are:

### Features

- [x] Unit testable
- [x] Bag for singleton game state
- [x] Record gameplay "tapes"
- [x] Rewind any live or recorded gameplay session
- [x] Hot reload code changes during a rewinded play session
- [ ] [Rollback netcode](https://trybloop.gg/nu11/mario)

### Table Stakes

- [x] Keyboard and Mouse Input Handling
- [ ] Transform Hierarchy
- [ ] Animated Sprites
- [ ] Collision detection
- [ ] Cameras
- [ ] ECS
- [ ] Scene Loading
- [ ] Gameplay phases
- [ ] Feature flags
- [ ] Config values
- [ ] Gamepad (aka controller) input handling

### Performance

- [ ] Single frame object pools
- [ ] Multithreading

### Rendering Engine Integrations

- [ ] Godot
- [ ] [Toodle](https://toodle.gg)

### Platform Targets

- [x] Browser
- [ ] PC
- [ ] Desktop Mac
- [ ] iOS
- [ ] Steam Deck
- [ ] Nintendo Switch
- [ ] Run anywhere you can allocate a byte buffer

### Editing Integrations

- [ ] Aseprite
- [ ] LDtk
- [ ] VSCode / Cursor

--

This project was created using `bun init` in bun v1.3.1. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
