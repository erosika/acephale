// Unified entrypoint -- runs server + all station loops in one process.
// Shared memory means call queues, now-playing, and archive state are all connected.

import "./server/index.js";
import { runCrateDiggerLoop } from "./stations/crate-digger/loop.js";
import { runConspiracyLoop } from "./stations/conspiracy-hour/loop.js";
import { runRequestLineLoop } from "./stations/request-line/loop.js";
import { runLoop as runMorningZooLoop } from "./stations/morning-zoo/loop.js";

console.log("[main] Starting all station loops...");

runCrateDiggerLoop().catch((err) => console.error("[main] crate-digger crashed:", err));
runConspiracyLoop().catch((err) => console.error("[main] conspiracy-hour crashed:", err));
runRequestLineLoop().catch((err) => console.error("[main] request-line crashed:", err));
runMorningZooLoop().catch((err) => console.error("[main] morning-zoo crashed:", err));
