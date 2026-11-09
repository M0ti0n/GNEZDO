// Files dropped from Explorer / a file manager.

/** Every file in what was dropped: folders are read through, subfolders included. */
export async function droppedFiles(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return [...dt.files];
  const out: File[] = [];
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) {
      out.push(await new Promise<File>((ok, bad) => (e as FileSystemFileEntry).file(ok, bad)));
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      // a directory reader hands its entries out in batches until an empty one
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((ok, bad) => reader.readEntries(ok, bad));
        if (!batch.length) break;
        for (const c of batch) await walk(c);
      }
    }
  };
  for (const e of entries) await walk(e).catch(() => undefined);
  return out;
}

/** Something from the computer is being dragged (not a part or a tile inside GNEZDO). */
export const draggingFiles = (dt: DataTransfer | null) => !!dt && [...dt.types].includes("Files");

/** A folder among what was dropped. */
export const droppedFolder = (dt: DataTransfer) => [...dt.items].some((i) => i.webkitGetAsEntry?.()?.isDirectory);
