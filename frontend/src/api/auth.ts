// Sign-in (server build): who is signed in, the first admin, users (admin), one's own password.
// The demo and the desktop build have no sign-in: the state says not required.
import { demoMode } from "./api";
import { diagHeaders } from "../job/diag";

export interface Me { id: number; name: string; isAdmin: boolean; hasPassword: boolean }
export interface UserRow extends Me { createdAt: string; lastSignInAt: string | null }
/** A key of the status API (another app reads GNEZDO's status with it); the key itself is shown once. */
export interface ApiKeyRow { id: number; name: string; prefix: string; createdAt: string; createdBy: string; lastUsedAt: string | null }
export interface AuthState {
  required: boolean; setupNeeded: boolean; user: Me | null;
  /** The server has no database yet: "Set up the database" comes first. */
  dbSetup?: boolean;
}

async function call<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method, credentials: "same-origin",
    headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...diagHeaders() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    let m = "";
    try { const j = await res.json(); m = j.message ?? Object.values(j.errors ?? {}).flat().join(" "); } catch { /* not JSON */ }
    throw new Error(m || (res.status === 403 ? "Only an admin can do that." : `${res.status} ${res.statusText}`));
  }
  return (await res.json()) as T;
}

export const auth = {
  state: async (): Promise<AuthState> => {
    if (demoMode) return { required: false, setupNeeded: false, user: null };
    try {
      const h = (await (await fetch("/api/health", { headers: { Accept: "application/json" } })).json()) as { setup?: boolean };
      if (h.setup) return { required: true, setupNeeded: false, user: null, dbSetup: true };
    } catch { /* answered below */ }
    try { return await call<AuthState>("/api/auth/state"); }
    catch { return { required: false, setupNeeded: false, user: null }; }   // an older server without sign-in
  },
  setup: (name: string, password: string) => call<Me>("/api/auth/setup", "POST", { name, password: password || null }),
  signIn: (name: string, password: string) => call<Me>("/api/auth/signin", "POST", { name, password: password || null }),
  signOut: () => call<void>("/api/auth/signout", "POST"),
  changePassword: (current: string, password: string) => call<Me>("/api/auth/password", "POST", { current: current || null, password: password || null }),
  users: () => call<UserRow[]>("/api/users"),
  addUser: (name: string, password: string, isAdmin: boolean) => call<UserRow>("/api/users", "POST", { name, password: password || null, isAdmin }),
  updateUser: (id: number, patch: { name?: string; password?: string; clearPassword?: boolean; isAdmin?: boolean }) => call<UserRow>(`/api/users/${id}`, "PUT", patch),
  removeUser: (id: number) => call<void>(`/api/users/${id}`, "DELETE"),
  apiKeys: () => call<ApiKeyRow[]>("/api/apikeys"),
  addApiKey: (name: string) => call<{ key: string; info: ApiKeyRow }>("/api/apikeys", "POST", { name }),
  removeApiKey: (id: number) => call<void>(`/api/apikeys/${id}`, "DELETE"),
};

/** A call came back "sign in first" (the sign-in ended): the app shows the sign-in page. */
export const SIGN_IN_NEEDED = "gnezdo:signin-needed";
export const signInNeeded = () => window.dispatchEvent(new Event(SIGN_IN_NEEDED));
