// Where an NC program goes: the machine's NC folder on the server; with no folder, a download in the
// browser when the machine allows it (Settings -> Machines -> Machine -> Folders), else nowhere.

import { api } from "../api/api";
import { foldersOf, type Machine } from "./machine";

export function downloadText(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Writes the program; the message to show. Throws when it cannot go anywhere. */
export async function saveNcFile(machine: Machine, name: string, text: string): Promise<string> {
  const f = foldersOf(machine);
  if (f.nc.trim() && api.hasServer) return `Written to ${(await api.writeNc(machine.id, name, text)).path}`;
  if (f.ncDownload) { downloadText(name, text); return `${name} downloaded`; }
  throw new Error(`${machine.name} has no NC folder: set it in Settings → Machines → Machine → Folders`);
}
