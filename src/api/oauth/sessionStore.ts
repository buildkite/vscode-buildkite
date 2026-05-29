import * as vscode from "vscode";
import { SESSIONS_SECRET_KEY } from "./constants";
import { warn } from "../../log";


export interface StoredSession {
  id: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  /** what the server actually granted, may be narrower than requestedScopes if the user's role is limited */
  scopes: string[];
  /**
   * what the caller originally asked for at sign in, kept alongside scopes so
   * the provider can satisfy a later getSessions for the same wider request
   * without re-prompting forever when the server keeps trimming the grant
   */
  requestedScopes: string[];
  account: {
    id: string;
    label: string;
  };
}

export class SessionStore implements vscode.Disposable {
  private writeMutex: Promise<unknown> = Promise.resolve();
  private readonly externalChangeEmitter = new vscode.EventEmitter<void>();
  private readonly secretsSubscription: vscode.Disposable;

  // fires on any window's write (including ours), subscribers should diff
  // against what they last acted on
  readonly onExternalChange = this.externalChangeEmitter.event;

  constructor(private readonly secrets: vscode.SecretStorage) {
    this.secretsSubscription = this.secrets.onDidChange((e) => {
      if (e.key === SESSIONS_SECRET_KEY) {
        this.externalChangeEmitter.fire();
      }
    });
  }

  dispose(): void {
    this.secretsSubscription.dispose();
    this.externalChangeEmitter.dispose();
  }

  async getAll(): Promise<StoredSession[]> {
    return this.withLock(() => this.readRaw());
  }

  async remove(id: string): Promise<StoredSession | undefined> {
    let removed: StoredSession | undefined;
    await this.mutate((sessions) => {
      const idx = sessions.findIndex((s) => s.id === id);
      if (idx >= 0) {
        removed = sessions[idx];
        sessions.splice(idx, 1);
      }
      return sessions;
    });
    return removed;
  }

  // single write swap, returns what was there
  async replace(session: StoredSession): Promise<StoredSession[]> {
    let previous: StoredSession[] = [];
    await this.mutate((sessions) => {
      previous = sessions;
      return [session];
    });
    return previous;
  }

  // single write wipe, returns what was there, used by signout so a
  // concurrent createSession in another window can't slip past
  async clearAll(): Promise<StoredSession[]> {
    let previous: StoredSession[] = [];
    await this.mutate((sessions) => {
      previous = sessions;
      return [];
    });
    return previous;
  }

  // reads through the mutex so a retry after refresh sees other windows' writes
  async getById(id: string): Promise<StoredSession | undefined> {
    return this.withLock(async () => {
      const all = await this.readRaw();
      return all.find((s) => s.id === id);
    });
  }

  // CAS write, returns false if another window rotated first, caller
  // should re-read and back off
  async swapIfRefreshTokenMatches(
    next: StoredSession,
    expectedRefreshToken: string,
  ): Promise<boolean> {
    let wrote = false;
    await this.withLock(async () => {
      const current = await this.readRaw();
      const idx = current.findIndex((s) => s.id === next.id);
      if (idx < 0 || current[idx].refreshToken !== expectedRefreshToken) {
        return;
      }
      current[idx] = next;
      await this.secrets.store(SESSIONS_SECRET_KEY, JSON.stringify(current));
      wrote = true;
    });
    return wrote;
  }

  private async mutate(
    fn: (sessions: StoredSession[]) => StoredSession[],
  ): Promise<void> {
    await this.withLock(async () => {
      const current = await this.readRaw();
      await this.secrets.store(SESSIONS_SECRET_KEY, JSON.stringify(fn(current)));
    });
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeMutex.then(fn);
    // swallow so one failed op doesn't poison the chain
    this.writeMutex = next.catch(() => undefined);
    return next;
  }

  private async readRaw(): Promise<StoredSession[]> {
    const raw = await this.secrets.get(SESSIONS_SECRET_KEY);
    if (!raw) {
      return [];
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      warn(`[OAuth] Stored sessions failed to parse, treating as empty: ${detail}`);
      return [];
    }
    if (!Array.isArray(parsed)) {
      warn("[OAuth] Stored sessions secret is not an array, treating as empty");
      return [];
    }
    const valid: StoredSession[] = [];
    for (const entry of parsed) {
      const normalised = normaliseStoredSession(entry);
      if (normalised) {
        valid.push(normalised);
      } else {
        warn("[OAuth] Dropping malformed session entry from stored sessions");
      }
    }
    return valid;
  }
}

// validates the required fields and back-fills requestedScopes for legacy
// sessions stored before that field existed, returns undefined if the entry
// is malformed
function normaliseStoredSession(value: unknown): StoredSession | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string") return undefined;
  if (typeof v.accessToken !== "string") return undefined;
  if (typeof v.refreshToken !== "string") return undefined;
  if (typeof v.expiresAt !== "number") return undefined;
  if (!Array.isArray(v.scopes) || !v.scopes.every((s) => typeof s === "string")) return undefined;
  if (!v.account || typeof v.account !== "object") return undefined;
  const acc = v.account as Record<string, unknown>;
  if (typeof acc.id !== "string") return undefined;
  if (typeof acc.label !== "string") return undefined;
  const requestedScopes = Array.isArray(v.requestedScopes) && v.requestedScopes.every((s) => typeof s === "string")
    ? (v.requestedScopes as string[])
    : (v.scopes as string[]).slice();
  return {
    id: v.id,
    accessToken: v.accessToken,
    refreshToken: v.refreshToken,
    expiresAt: v.expiresAt,
    scopes: v.scopes as string[],
    requestedScopes,
    account: { id: acc.id, label: acc.label },
  };
}
