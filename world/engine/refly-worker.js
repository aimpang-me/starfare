// refly-worker.js -- module Web Worker: new Worker("refly-worker.js", {type: "module"})
// message in:  {id, fn: "refly" | "planRide" | "placeState", args: [...]}
// message out: {id, result} (result is plain data; errors come back as {error})
import * as F from "./sol-facade.js";
self.onmessage = (ev) => {
  const { id, fn, args } = ev.data || {};
  let result;
  try {
    if (!["refly", "planRide", "placeState", "stateOf", "periodDays", "propagate"].includes(fn)) throw new Error(`unknown fn ${fn}`);
    result = F[fn](...(args || []));
  } catch (e) { result = { error: String(e && e.message || e) }; }
  self.postMessage({ id, result });
};
