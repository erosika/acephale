// Unified entrypoint -- runs server + all station loops in one process.
// Shared memory means call queues, now-playing, and archive state are all connected.

import "./server/index.js";
import { runCrateDiggerLoop } from "./stations/crate-digger/loop.js";
import { runConspiracyLoop } from "./stations/conspiracy-hour/loop.js";
import { runStaticLoop } from "./stations/static/loop.js";
import { runLoop as runMorningZooLoop } from "./stations/morning-zoo/loop.js";

console.log("[main] Starting all station loops...");

runCrateDiggerLoop().catch((err) => console.error("[main] crate-digger crashed:", err));
runConspiracyLoop().catch((err) => console.error("[main] conspiracy-hour crashed:", err));
runStaticLoop().catch((err) => console.error("[main] static (generator) crashed:", err));
runMorningZooLoop().catch((err) => console.error("[main] morning-zoo crashed:", err));
