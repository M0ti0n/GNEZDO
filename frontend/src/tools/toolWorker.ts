// SPECIAL TOOLS plug-ins: the sandbox. Each tool runs in a worker of its own (a background thread with no
// page, no DOM). Before the tool's code runs, everything that reaches outside is taken away: the network
// (fetch, XHR, WebSocket, …), storage (IndexedDB, caches), other workers, timers that run text as code, and
// eval / the Function constructors. What is left: plain JavaScript, Math and the gz helpers. The page
// stops a tool that takes too long (toolRunner.ts).

import { loadTool, prepareTool, runTool, type CompiledTool } from "./toolCore";

type In = { type: "load"; script: string } | { type: "run"; id: number; values: Record<string, unknown> };

const reply = self.postMessage.bind(self) as (m: unknown) => void;

function lockDown() {
  const g = self as unknown as Record<string, unknown>;
  const gone = [
    "fetch", "XMLHttpRequest", "WebSocket", "WebSocketStream", "WebTransport", "EventSource", "importScripts",
    "indexedDB", "caches", "BroadcastChannel", "Worker", "SharedWorker", "navigator", "setTimeout", "setInterval",
    "eval", "Request", "Response", "Headers", "FileReaderSync", "close",
  ];
  // on the worker and on every object up its prototype chain (Object.getPrototypeOf(self).fetch …)
  const chain: object[] = [];
  for (let o: object | null = g; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) chain.push(o);
  for (const k of gone) {
    for (const o of chain) {
      if (o !== g && !Object.prototype.hasOwnProperty.call(o, k)) continue;
      try { Object.defineProperty(o, k, { value: undefined, writable: false, configurable: false }); } catch { /* not there */ }
    }
  }
  // new Function / async / generator functions made from text: (() => {}).constructor("…")
  const protos = [Function.prototype, Object.getPrototypeOf(async () => {}), Object.getPrototypeOf(function* () {}), Object.getPrototypeOf(async function* () {})];
  for (const p of protos) {
    try { Object.defineProperty(p, "constructor", { value: undefined, writable: false, configurable: false }); } catch { /* kept */ }
  }
  try { Object.defineProperty(g, "Function", { value: undefined, writable: false, configurable: false }); } catch { /* kept */ }
}

let tool: CompiledTool | null = null;
let loadError: string | null = null;

self.onmessage = (e: MessageEvent<In>) => {
  const m = e.data;
  if (m.type === "load") {
    if (tool || loadError) { reply({ type: "loaded", error: "Already loaded" }); return; }
    try {
      const prepared = prepareTool(m.script);   // made into a function first (needs Function) …
      lockDown();                                 // … then everything is locked before any of its code runs
      tool = loadTool(prepared);
      reply({ type: "loaded" });
    } catch (err) {
      lockDown();
      loadError = (err as Error).message;
      reply({ type: "loaded", error: loadError });
    }
    return;
  }
  if (m.type === "run") {
    if (!tool) { reply({ type: "result", id: m.id, result: { error: loadError ?? "The tool is not loaded" } }); return; }
    reply({ type: "result", id: m.id, result: runTool(tool, m.values) });
  }
};
