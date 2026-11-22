// The shared settings (machines, stock, import and nesting rules) are read when the page opens and then
// kept: an admin's change on another computer was not seen until the page was reloaded, so one job gave
// other E codes, tech program or leads depending on which computer posted it and since when (QA R2-04).
// The page now reads again what changed on the server every minute and when its window comes back, and
// Auto cut and Post process ask for it first and use the machines as they are now.

import type { MachineList } from "./machine";

let refresher: (() => Promise<MachineList | null>) | null = null;

/** The page's way of reading again what changed (App sets it). */
export const setSharedRefresher = (f: (() => Promise<MachineList | null>) | null) => { refresher = f; };

/** The shared settings read again where the server has a newer version: the machines as they are now
 *  (null: no server, or not reached: the page's own). */
export const refreshShared = (): Promise<MachineList | null> => (refresher ? refresher().catch(() => null) : Promise.resolve(null));
