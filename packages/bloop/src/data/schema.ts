import type { Bag } from "./bag";

export type BloopSchema<
  // CS extends ComponentSchema = ComponentSchema,
  B extends Bag = Bag,
  // IM extends InputMap = InputMap,
> = {
  // CS: CS;
  B: B;
  // IM: IM;
};
