// Builds the fittings' plug-in tools from this folder: for each, SPECIAL TOOLS/<id>/tool.json and tool.js
// (the fitting's code bundled, run in the tool sandbox), and SPECIAL TOOLS/<id>.gnezdo-tool.zip with its
// icon.svg and diagram.svg (kept in the tool's folder).
//   node "SPECIAL TOOLS/fittings-src/build.mjs"        (after npm install in frontend/)

import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const esbuild = createRequire(join(here, "../../frontend/package.json"))("esbuild");

const TOOLS = ["tool-elbow", "tool-transition", "tool-branch", "tool-flange", "tool-thread", "tool-screw"];

// ---- a small zip writer (stored, no compression: the files are small)
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (b) => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function zip(files) {
  const parts = [], dir = [];
  let off = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name), crc = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8);
    h.writeUInt16LE(0, 10); h.writeUInt16LE(0x5b21, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(n.length, 26); h.writeUInt16LE(0, 28);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
    c.writeUInt16LE(0, 12); c.writeUInt16LE(0x5b21, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, n, data); dir.push(c, n);
    off += 30 + n.length + data.length;
  }
  const size = dir.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(size, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, ...dir, end]);
}

for (const name of TOOLS) {
  const out = await esbuild.build({
    stdin: { contents: `export { tool as T } from "./${name}";`, resolveDir: here, loader: "ts" },
    bundle: true, format: "iife", globalName: "FIT", target: "es2020", write: false, legalComments: "none", charset: "utf8",
  });
  // the manifest, from the bundle itself (the same code)
  const { manifest } = new Function(`${out.outputFiles[0].text}; return FIT.T;`)();
  const script = `// ${manifest.name}: a fitting of the HVAC Fittings workbench as a GNEZDO special tool.\n`
    + `// Made by SPECIAL TOOLS/fittings-src/build.mjs from the fitting's source there: change it there, not here.\n\n`
    + out.outputFiles[0].text.replace(/^\s*\/\/ [^\n]*\.ts\n/gm, "")   // (esbuild's source file names)
    + `\nfunction problems(v) { return FIT.T.problems(v); }\nfunction title(v) { return FIT.T.title(v); }\nfunction parts(v, gz) { return FIT.T.parts(v, gz); }\n`;
  if (/\bimport\b/.test(script)) throw new Error(`${name}: the script holds the word "import" (tools may not)`);
  const json = {
    format: "gnezdo-tool", version: 1, id: manifest.id, name: manifest.name, toolVersion: "1.0", description: manifest.description,
    countLabel: manifest.countLabel, script: "tool.js", icon: "icon.svg", diagram: "diagram.svg", fields: manifest.fields, ...(manifest.note ? { note: manifest.note } : {}),
  };
  const dir = join(root, manifest.id);
  mkdirSync(dir, { recursive: true });
  const text = `${JSON.stringify(json, null, 2)}\n`;
  writeFileSync(join(dir, "tool.json"), text);
  writeFileSync(join(dir, "tool.js"), script);
  const files = [["tool.json", Buffer.from(text)], ["tool.js", Buffer.from(script)], ["icon.svg", readFileSync(join(dir, "icon.svg"))], ["diagram.svg", readFileSync(join(dir, "diagram.svg"))]];
  writeFileSync(join(root, `${manifest.id}.gnezdo-tool.zip`), zip(files));
  console.log(`${manifest.id}: ${Math.round(script.length / 1024)} KB`);
}
