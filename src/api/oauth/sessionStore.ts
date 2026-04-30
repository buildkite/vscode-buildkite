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

export class SessionStore {
  private writeMutex: Promise<unknown> = Promise.resolve();

  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getAll(): Promise<StoredSession[]> {
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

  async upsert(session: StoredSession): Promise<void> {
    await this.mutate((sessions) => {
      const idx = sessions.findIndex((s) => s.id === session.id);
      if (idx >= 0) {
        sessions[idx] = session;
      } else {
        sessions.push(session);
      }
      return sessions;
    });
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

  private async mutate(
    fn: (sessions: StoredSession[]) => StoredSession[],
  ): Promise<void> {
    const next = this.writeMutex.then(async () => {
      const current = await this.getAll();
      const updated = fn(current);
      await this.secrets.store(SESSIONS_SECRET_KEY, JSON.stringify(updated));
    });
    // Swallow errors so one failed write doesn't break subsequent ones.
    this.writeMutex = next.catch(() => undefined);
    await next;
  }
}
