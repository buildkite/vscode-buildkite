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

  /**
   * Fires whenever the sessions secret changes from any window on the
   * host, including this one
   *
   * Subscribers should ignore echoes from their own window by diffing
   * the new state against what they last acted on
   */
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

  // Wipes everything and stores the new one in one write, returns the
  // old set so the caller can fire removed events
  async replace(session: StoredSession): Promise<StoredSession[]> {
    let previous: StoredSession[] = [];
    await this.mutate((sessions) => {
      previous = sessions;
      return [session];
    });
    return previous;
  }

  // Wipe every stored session in one shot and return what was there
  //
  // Used by signout so a createSession running concurrently in another
  // window can't slip in between a snapshot then loop remove and survive
  async clearAll(): Promise<StoredSession[]> {
    let previous: StoredSession[] = [];
    await this.mutate((sessions) => {
      previous = sessions;
      return [];
    });
    return previous;
  }

  // Reads through the mutex so callers retrying after a refresh see
  // writes committed by other windows on the same host
  async getById(id: string): Promise<StoredSession | undefined> {
    return this.withLock(async () => {
      const all = await this.readRaw();
      return all.find((s) => s.id === id);
    });
  }

  // CAS, only writes if the stored refresh token still matches what we
  // expected, stops a slow refresh from clobbering a newer rotation,
  // returns false if we lost the race (caller should re-read and retry)
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
    // Swallow errors so one failed op doesn't poison the chain for
    // later ones
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
