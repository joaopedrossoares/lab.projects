import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { OpaqueEntityType, OpaqueRecord } from "@financas/shared";

export interface OpaqueListQuery {
  entityType?: OpaqueEntityType;
  periodKey?: string;
  blindIndex?: string;
  includeDeleted?: boolean;
  limit?: number;
}

export interface OpaqueTransportHealth {
  reachable: boolean;
  storage?: string;
  totalActive?: number;
  error?: string;
}

export interface OpaqueTransportStats {
  totalActive: number;
  byEntityType: Record<string, number>;
}

export interface OpaqueTransport {
  readonly mode: "hybrid-remote" | "local-sqlite";
  readonly targetLabel: string;
  init(): Promise<void>;
  health(): Promise<OpaqueTransportHealth>;
  list(query?: OpaqueListQuery): Promise<OpaqueRecord[]>;
  getById(id: string): Promise<OpaqueRecord | null>;
  upsert(record: OpaqueRecord): Promise<OpaqueRecord>;
  upsertMany(records: OpaqueRecord[]): Promise<number>;
  deleteById(id: string): Promise<boolean>;
  stats(): Promise<OpaqueTransportStats>;
  exportSnapshot(): Promise<OpaqueRecord[]>;
  importSnapshot(records: OpaqueRecord[]): Promise<number>;
  close(): Promise<void>;
}

interface RawRow {
  id: string;
  entity_type: string;
  period_key: string | null;
  blind_index: string | null;
  encrypted_payload: string;
  updated_at: string;
  deleted_at: string | null;
}

function mapRow(row: RawRow): OpaqueRecord {
  return {
    id: row.id,
    entityType: row.entity_type as OpaqueEntityType,
    periodKey: row.period_key,
    blindIndex: row.blind_index,
    encryptedPayload: row.encrypted_payload,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export class SqliteLocalOpaqueTransport implements OpaqueTransport {
  readonly mode = "local-sqlite" as const;
  readonly targetLabel: string;
  private db: DatabaseSync | null = null;

  constructor(private readonly dbPath: string) {
    this.targetLabel = dbPath === ":memory:" ? "sqlite://memory" : `sqlite://${path.basename(dbPath)}`;
  }

  async init(): Promise<void> {
    if (this.dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS opaque_records (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        period_key TEXT,
        blind_index TEXT,
        encrypted_payload TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_local_opaque_entity_period
        ON opaque_records (entity_type, period_key);
      CREATE INDEX IF NOT EXISTS idx_local_opaque_entity_blind
        ON opaque_records (entity_type, blind_index);
    `);
  }

  private getDb(): DatabaseSync {
    if (!this.db) throw new Error("SqliteLocalOpaqueTransport não inicializado.");
    return this.db;
  }

  /** Exposed strictly for Zero-Knowledge audit verification tests. */
  inspectRawRows(): RawRow[] {
    return this.getDb().prepare("SELECT * FROM opaque_records").all() as unknown as RawRow[];
  }

  async health(): Promise<OpaqueTransportHealth> {
    const stats = await this.stats();
    return { reachable: true, storage: "sqlite", totalActive: stats.totalActive };
  }

  async list(query: OpaqueListQuery = {}): Promise<OpaqueRecord[]> {
    const clauses: string[] = [];
    const params: (string | number)[] = [];

    if (!query.includeDeleted) clauses.push("deleted_at IS NULL");
    if (query.entityType) {
      clauses.push("entity_type = ?");
      params.push(query.entityType);
    }
    if (query.periodKey) {
      clauses.push("period_key = ?");
      params.push(query.periodKey);
    }
    if (query.blindIndex) {
      clauses.push("blind_index = ?");
      params.push(query.blindIndex);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limitClause = query.limit && query.limit > 0 ? "LIMIT ?" : "";
    if (limitClause) params.push(query.limit!);

    const rows = this.getDb()
      .prepare(
        `SELECT id, entity_type, period_key, blind_index, encrypted_payload, updated_at, deleted_at
         FROM opaque_records ${where} ORDER BY updated_at DESC ${limitClause}`
      )
      .all(...params) as unknown as RawRow[];

    return rows.map(mapRow);
  }

  async getById(id: string): Promise<OpaqueRecord | null> {
    const row = this.getDb()
      .prepare(
        `SELECT id, entity_type, period_key, blind_index, encrypted_payload, updated_at, deleted_at
         FROM opaque_records WHERE id = ? AND deleted_at IS NULL`
      )
      .get(id) as unknown as RawRow | undefined;

    return row ? mapRow(row) : null;
  }

  async upsert(record: OpaqueRecord): Promise<OpaqueRecord> {
    this.getDb()
      .prepare(
        `INSERT INTO opaque_records (id, entity_type, period_key, blind_index, encrypted_payload, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           entity_type = excluded.entity_type,
           period_key = excluded.period_key,
           blind_index = excluded.blind_index,
           encrypted_payload = excluded.encrypted_payload,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at`
      )
      .run(
        record.id,
        record.entityType,
        record.periodKey,
        record.blindIndex,
        record.encryptedPayload,
        record.updatedAt,
        record.deletedAt
      );
    return record;
  }

  async upsertMany(records: OpaqueRecord[]): Promise<number> {
    const db = this.getDb();
    db.exec("BEGIN");
    try {
      for (const rec of records) {
        await this.upsert(rec);
      }
      db.exec("COMMIT");
      return records.length;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  async deleteById(id: string): Promise<boolean> {
    const now = new Date().toISOString();
    const res = this.getDb()
      .prepare("UPDATE opaque_records SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
      .run(now, now, id);
    return Number(res.changes) > 0;
  }

  async stats(): Promise<OpaqueTransportStats> {
    const rows = this.getDb()
      .prepare(
        "SELECT entity_type, COUNT(*) as cnt FROM opaque_records WHERE deleted_at IS NULL GROUP BY entity_type"
      )
      .all() as unknown as Array<{ entity_type: string; cnt: number }>;

    const byEntityType: Record<string, number> = {};
    let totalActive = 0;
    for (const r of rows) {
      const c = Number(r.cnt);
      byEntityType[r.entity_type] = c;
      totalActive += c;
    }
    return { totalActive, byEntityType };
  }

  async exportSnapshot(): Promise<OpaqueRecord[]> {
    return this.list({ includeDeleted: true });
  }

  async importSnapshot(records: OpaqueRecord[]): Promise<number> {
    return this.upsertMany(records);
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }
}

export class HttpOpaqueTransport implements OpaqueTransport {
  readonly mode = "hybrid-remote" as const;
  readonly targetLabel: string;
  private readonly baseUrl: string;

  constructor(
    backendUrl: string,
    private readonly syncApiToken?: string
  ) {
    this.baseUrl = backendUrl.replace(/\/+$/, "");
    try {
      const parsed = new URL(this.baseUrl);
      this.targetLabel = parsed.host;
    } catch {
      this.targetLabel = this.baseUrl;
    }
  }

  async init(): Promise<void> {
    // Remote backend initializes its own schema on boot.
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.syncApiToken) {
      h.Authorization = `Bearer ${this.syncApiToken}`;
    }
    return h;
  }

  private async requestJson<T>(pathAndQuery: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${pathAndQuery}`, {
      ...init,
      headers: {
        ...this.headers(),
        ...(init.headers as Record<string, string> | undefined),
      },
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(`Backend opaco respondeu HTTP ${response.status}: ${bodyText.slice(0, 200)}`);
    }

    return (await response.json()) as T;
  }

  async health(): Promise<OpaqueTransportHealth> {
    try {
      const data = await this.requestJson<{ status: string; storage?: string; totalActive?: number }>(
        "/health"
      );
      return {
        reachable: data.status === "ok",
        storage: data.storage,
        totalActive: data.totalActive,
      };
    } catch (err) {
      return {
        reachable: false,
        error: err instanceof Error ? err.message : "Backend inacessível",
      };
    }
  }

  async list(query: OpaqueListQuery = {}): Promise<OpaqueRecord[]> {
    const params = new URLSearchParams();
    if (query.entityType) params.set("entityType", query.entityType);
    if (query.periodKey) params.set("periodKey", query.periodKey);
    if (query.blindIndex) params.set("blindIndex", query.blindIndex);
    if (query.includeDeleted) params.set("includeDeleted", "true");
    if (query.limit) params.set("limit", String(query.limit));

    const qs = params.toString();
    const data = await this.requestJson<{ records: OpaqueRecord[] }>(
      `/api/v1/records${qs ? `?${qs}` : ""}`
    );
    return data.records;
  }

  async getById(id: string): Promise<OpaqueRecord | null> {
    const response = await fetch(`${this.baseUrl}/api/v1/records/${encodeURIComponent(id)}`, {
      headers: this.headers(),
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Backend opaco respondeu HTTP ${response.status}`);
    }
    const data = (await response.json()) as { record: OpaqueRecord };
    return data.record;
  }

  async upsert(record: OpaqueRecord): Promise<OpaqueRecord> {
    const data = await this.requestJson<{ record: OpaqueRecord }>(
      `/api/v1/records/${encodeURIComponent(record.id)}`,
      {
        method: "PUT",
        body: JSON.stringify(record),
      }
    );
    return data.record;
  }

  async upsertMany(records: OpaqueRecord[]): Promise<number> {
    const data = await this.requestJson<{ count: number }>("/api/v1/records/batch", {
      method: "POST",
      body: JSON.stringify({ records }),
    });
    return data.count;
  }

  async deleteById(id: string): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/api/v1/records/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (response.status === 404) return false;
    if (!response.ok) {
      throw new Error(`Backend opaco respondeu HTTP ${response.status}`);
    }
    return true;
  }

  async stats(): Promise<OpaqueTransportStats> {
    return this.requestJson<OpaqueTransportStats>("/api/v1/stats");
  }

  async exportSnapshot(): Promise<OpaqueRecord[]> {
    const data = await this.requestJson<{ records: OpaqueRecord[] }>("/api/v1/snapshot");
    return data.records;
  }

  async importSnapshot(records: OpaqueRecord[]): Promise<number> {
    const data = await this.requestJson<{ imported: number }>("/api/v1/snapshot", {
      method: "POST",
      body: JSON.stringify({ records }),
    });
    return data.imported;
  }

  async close(): Promise<void> {
    // Nothing to close for HTTP transport.
  }
}
