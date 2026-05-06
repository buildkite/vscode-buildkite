import * as vscode from "vscode";
import { SESSIONS_SECRET_KEY } from "./constants";


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

  // Drop every prior session and store `session` in one write, returning
  // whatever was there before so the caller can fire removed events
  //
  // Caller MUST pass a session with a fresh id, otherwise the returned
  // `previous` could contain the id of the new session and consumers
  // would fire `removed` for an id they just `added`, churning the UI
  async replace(session: StoredSession): Promise<StoredSession[]> {
    let previous: StoredSession[] = [];
    await this.mutate((sessions) => {
      if (sessions.some((s) => s.id === session.id)) {
        throw new Error(
          `SessionStore.replace called with an id (${session.id}) that already exists. ` +
            `Generate a new id for the replacement session.`,
        );
      }
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

  // Only writes if the stored session's `expectedRefreshToken` still
  // matches what the caller saw
  //
  // Used by the refresh path so a slower window can't overwrite a newer
  // rotation that landed in storage between its read and its write
  //
  // Returns true on write, false if the precondition failed (caller
  // should read again and retry)
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
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as StoredSession[]) : [];
    } catch {
      return [];
    }
  }
}
