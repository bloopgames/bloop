import "./style.css";
import { handleUpdate, mount } from "@bloopjs/bloop";
import { connect } from "@bloopjs/web";
import { game } from "./game";

const monorepoWasmUrl = new URL("/bloop-wasm/bloop.wasm", window.location.href);

let { runtime } = await mount({
  hooks: game.hooks,
  wasmUrl: monorepoWasmUrl,
});
let unsubscribe = connect(runtime);

import.meta.hot?.accept("./game", async (newModule) => {
  runtime = await handleUpdate(newModule, runtime, {
    wasmUrl: monorepoWasmUrl,
  });
  unsubscribe();
  unsubscribe = connect(runtime);
});
