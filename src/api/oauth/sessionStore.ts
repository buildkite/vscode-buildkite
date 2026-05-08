import * as vscode from "vscode";
import { SESSIONS_SECRET_KEY } from "./constants";
import { warn } from "../../log";


export interface StoredSession {
  id: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
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
      if (isStoredSession(entry)) {
        valid.push(entry);
      } else {
        warn("[OAuth] Dropping malformed session entry from stored sessions");
      }
    }
    return valid;
  }
}

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string") return false;
  if (typeof v.accessToken !== "string") return false;
  if (typeof v.refreshToken !== "string") return false;
  if (typeof v.expiresAt !== "number") return false;
  if (!Array.isArray(v.scopes) || !v.scopes.every((s) => typeof s === "string")) return false;
  if (!v.account || typeof v.account !== "object") return false;
  const acc = v.account as Record<string, unknown>;
  if (typeof acc.id !== "string") return false;
  if (typeof acc.label !== "string") return false;
  return true;
}
