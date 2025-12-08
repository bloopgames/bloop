# bloop

Make faster mistakes.

(insert gif here)

Bloop is a rewindable 2d game simulation library that can be embedded in any game engine.

- Write game state and logic in TypeScript
- Rewind any live or recorded gameplay session
- Hot reload code changes during a rewinded play session

[Technical Details](./details.md) | [Why Bloop?](./why.md)

## 1.0

Bloop is in early development. The goals for 1.0 are:

### Features

- [x] Unit testable
- [x] Keyboard and Mouse Input Handling
- [x] Bag for singleton game state
- [x] Record gameplay "tapes"
- [x] Rewind any live or recorded gameplay session
- [x] Hot reload code changes during a rewinded play session
- [ ] Rollback netcode out of the box

### Table Stakes

- [ ] ECS
- [ ] Transforms
- [ ] Animated Sprites
- [ ] Collision detection
- [ ] Cameras
- [ ] Scene Loading
- [ ] Feature flags
- [ ] Config values
- [ ] Gamepad (aka controller) input handling
- [ ] Single frame object pools
- [ ] Multithreading

### Rendering Engine Integrations

- [ ] [Toodle](https://toodle.gg)
- [ ] Godot

### Platform Targets

- [x] Browser
- [ ] Desktop Mac
- [ ] iOS
- [ ] Steam Deck
- [ ] PC
- [ ] Nintendo Switch
- [ ] Run anywhere you can allocate a byte buffer

### Editing Integrations

- [ ] Aseprite
- [ ] LDtk
- [ ] VSCode / Cursor

--

This project was created using `bun init` in bun v1.3.1. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
