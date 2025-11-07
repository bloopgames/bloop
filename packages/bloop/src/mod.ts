import type { System } from "./system";
import { EngineInputs, type PlatformEvent } from "@bloopjs/engine";

export function Bloop() {
	const systems = [] as System[];

	return {
		system(label: string, system: System) {
			systems.push(system);
		},
		systemsCallback: (events: PlatformEvent[]) => {
			for (const system of systems) {
				system.update?.();

				for (const event of events) {
					switch(event.type) {
						case "keydown":
							system.keydown?.({
								event: {
									key: event.key,
									pressure: 1,
								}
							})
							break;
						case "keyheld":
							system.keyheld?.({
								event: {
									key: event.key,
									pressure: 1,
								}
							})
							break;
						case "keyup":
							system.keyup?.({
								event: {
									key: event.key,
									pressure: 0,
								}
							})
							break;
						case "mousemove":
							system.mousemove?.({
								event: {
									x: event.x,
									y: event.y,
								}
							})
							break;
						case "mousedown":
							system.mousedown?.({
								event: {
									button: event.button,
									pressure: event.pressure,
								}
							})
							break;
						case "mouseup":
							system.mouseup?.({
								event: {
									button: event.button,
									pressure: event.pressure,
								}
							})
							break;
						case "mousewheel":
							system.mousewheel?.({
								event: {
									x: event.x,
									y: event.y,
								}
							})
							break;
						default:
							break;
					}
				}
			}
		}
	}
}

