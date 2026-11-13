// Settings -> Projects and parts: the project parts are saved under when the importer's project box is
// left empty (kept in this browser). Empty: such parts are not saved until a project is set.
const KEY = "gnezdo.defaultProject";
export const loadDefaultProject = (): string => { try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; } };
export const saveDefaultProject = (v: string) => { try { localStorage.setItem(KEY, v.trim()); } catch { /* not kept */ } };
