## Why Bloop?

I'm a gamedev who is sick of:

* Compile time
* Hot code reload not working
* Spending hours tracking down edge case bugs
* Writing netcode
* Webapps being more fun to code than games

Game engines like Godot and Unity are primarily *rendering* engines -  simulation is tightly coupled to rendering and can only step forward, making it increasingly difficult to iterate as the game grows.

Imagine a movie editing software that only allowed you to play the movie forward without being able to rewind or jump to a moment in time.

This would obviously make film editing much shittier and lead to frustration and crunch, and yet it's the cutting edge of game development today.

Meanwhile, people working on the web enjoy the benefits of hot reloading, declarative rendering and time-travel debugging.

I believe that 2d indie game development can be radically improved by applying this method of developing software to writing game logic.

bloop is an experimental npm package that lets you edit your 2d game logic live while replaying any gameplay session.

* Hot reload code changes instantly while playing your game
* Record any gameplay session as a "tape"
* Edit code live while rewinding and seeking through a tape
* Rollback netcode built in - every local multiplayer game is an online multiplayer game!