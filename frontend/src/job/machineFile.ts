// A machine's configuration as a file (Settings -> Machines -> Export / Import machine): a .zip with
// machine.json (everything about the machine, its technology tables included), postprocessor.js (its
// NC postprocessor, if it has one) and technology.csv (the tables to read in a spreadsheet; not read
// back). A bare machine.json imports too.

import { newMachine, type Machine } from "./machine";
import { technologiesCsv } from "./technology";

const FORMAT = "gnezdo-machine";

export interface MachineFile { format: typeof FORMAT; version: 1; exportedAt: string; machine: Omit<Machine, "id"> }

// ---------------------------------------------------------------- zip (store only to write; store / deflate to read)

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b: Uint8Array) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), n = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true); lh.setUint32(18, n, true); lh.setUint32(22, n, true);
    lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true); ch.setUint32(20, n, true); ch.setUint32(24, n, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + n;
  }
  const cSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

/** The files of a zip (stored or deflated), by name. */
export async function unzip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const u8 = new Uint8Array(buf), v = new DataView(buf);
  let e = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error("Not a zip file");
  const count = v.getUint16(e + 10, true);
  let c = v.getUint32(e + 16, true);
  const dec = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  for (let k = 0; k < count; k++) {
    if (v.getUint32(c, true) !== 0x02014b50) throw new Error("Damaged zip file");
    const method = v.getUint16(c + 10, true), size = v.getUint32(c + 20, true);
    const nl = v.getUint16(c + 28, true), xl = v.getUint16(c + 30, true), cl = v.getUint16(c + 32, true), lo = v.getUint32(c + 42, true);
    const name = dec.decode(u8.subarray(c + 46, c + 46 + nl));
    const start = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true);
    const raw = u8.subarray(start, start + size);
    if (method === 0) out.set(name, raw);
    else if (method === 8) {
      const s = new Blob([raw.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      out.set(name, new Uint8Array(await new Response(s).arrayBuffer()));
    }
    c += 46 + nl + xl + cl;
  }
  return out;
}

// ---------------------------------------------------------------- machine file

/** File name for a machine's zip: "Plasma.gnezdo-machine.zip" */
export const machineFileName = (m: Machine) => `${(m.name || "machine").replace(/[\\/:*?"<>|]+/g, "_")}.gnezdo-machine.zip`;

export function machineZip(m: Machine): Uint8Array {
  const machine: Omit<Machine, "id"> & { id?: string } = { ...m };
  delete machine.id;
  const pp = machine.postprocessor;
  // the postprocessor's source goes in its own file (to read and change); machine.json names it
  if (pp) machine.postprocessor = { ...pp, source: "postprocessor.js" };
  const file: MachineFile = { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), machine };
  const enc = new TextEncoder();
  const files = [{ name: "machine.json", data: enc.encode(JSON.stringify(file, null, 2)) }];
  if (pp) files.push({ name: "postprocessor.js", data: enc.encode(pp.source) });
  if (m.technologies?.length) files.push({ name: "technology.csv", data: enc.encode("﻿" + technologiesCsv(m.technologies)) });
  return zip(files);
}

/** The machine in a .zip (machine.json inside) or a bare machine.json; it gets a new id. */
export async function readMachineFile(buf: ArrayBuffer): Promise<Machine> {
  const u8 = new Uint8Array(buf);
  let json: string;
  let ppSource: string | undefined;
  if (u8[0] === 0x50 && u8[1] === 0x4b) {
    const files = await unzip(buf);
    const key = [...files.keys()].find((k) => k.toLowerCase().endsWith("machine.json"));
    if (!key) throw new Error("There is no machine.json in this zip");
    json = new TextDecoder().decode(files.get(key));
    const pk = [...files.keys()].find((k) => k.toLowerCase().endsWith("postprocessor.js"));
    if (pk) ppSource = new TextDecoder().decode(files.get(pk));
  } else json = new TextDecoder().decode(u8);
  let f: Partial<MachineFile>;
  try { f = JSON.parse(json.replace(/^﻿/, "")); } catch { throw new Error("machine.json is not valid"); }
  if (f.format !== FORMAT || !f.machine) throw new Error("This is not a GNEZDO machine file");
  const base = newMachine(1);
  const m: Machine = { ...base, ...f.machine, trims: { ...base.trims, ...(f.machine.trims ?? {}) }, id: `m${Date.now().toString(36)}` };
  if (m.postprocessor) {
    if (ppSource !== undefined) m.postprocessor = { ...m.postprocessor, source: ppSource };
    else if (m.postprocessor.source === "postprocessor.js") delete m.postprocessor;   // named but missing
  }
  return m;
}
