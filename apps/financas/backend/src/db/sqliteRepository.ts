import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { OpaqueEntityType, OpaqueRecord } from "@financas/shared";
import type {
  ListOpaqueRecordsFilter,
  OpaqueRecordRepository,
  OpaqueStats,
} from "./repository.js";

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

export class SqliteOpaqueRepository implements OpaqueRecordRepository {
  readonly kind = "sqlite" as const;
  private db: DatabaseSync | null = null;

  constructor(private readonly dbPath: string) {}

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
      CREATE INDEX IF NOT EXISTS idx_opaque_entity_period
        ON opaque_records (entity_type, period_key);
      CREATE INDEX IF NOT EXISTS idx_opaque_entity_blind
        ON opaque_records (entity_type, blind_index);
    `);
  }

  private getDb(): DatabaseSync {
    if (!this.db) {
      throw new Error("SqliteOpaqueRepository não inicializado.");
    }
    return this.db;
  }

  /** Exposed strictly for Zero-Knowledge audit tests. */
  queryRawRows(): RawRow[] {
    return this.getDb()
      .prepare("SELECT * FROM opaque_records")
      .all() as unknown as RawRow[];
  }

  async list(filter: ListOpaqueRecordsFilter = {}): Promise<OpaqueRecord[]> {
    const clauses: string[] = [];
    const params: (string | number)[] = [];

    if (!filter.includeDeleted) {
      clauses.push("deleted_at IS NULL");
    }
    if (filter.entityType) {
      clauses.push("entity_type = ?");
      params.push(filter.entityType);
    }
    if (filter.periodKey) {
      clauses.push("period_key = ?");
      params.push(filter.periodKey);
    }
    if (filter.blindIndex) {
      clauses.push("blind_index = ?");
      params.push(filter.blindIndex);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limitClause = filter.limit && filter.limit > 0 ? "LIMIT ?" : "";
    if (limitClause) {
      params.push(filter.limit!);
    }

    const sql = `
      SELECT id, entity_type, period_key, blind_index, encrypted_payload, updated_at, deleted_at
      FROM opaque_records
      ${where}
      ORDER BY updated_at DESC
      ${limitClause}
    `;

    const rows = this.getDb().prepare(sql).all(...params) as unknown as RawRow[];
    return rows.map(mapRow);
  }

  async getById(id: string): Promise<OpaqueRecord | null> {
    const row = this.getDb()
      .prepare(
        `SELECT id, entity_type, period_key, blind_index, encrypted_payload, updated_at, deleted_at
         FROM opaque_records WHERE id = ?`
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

  async upsertMany(records: OpaqueRecord[]): Promise<OpaqueRecord[]> {
    const db = this.getDb();
    db.exec("BEGIN");
    try {
      for (const record of records) {
        await this.upsert(record);
      }
      db.exec("COMMIT");
      return records;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async softDelete(id: string, deletedAt: string): Promise<boolean> {
    const result = this.getDb()
      .prepare("UPDATE opaque_records SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
      .run(deletedAt, deletedAt, id);

    return Number(result.changes) > 0;
  }

  async exportAll(): Promise<OpaqueRecord[]> {
    return this.list({ includeDeleted: true });
  }

  async importAll(records: OpaqueRecord[]): Promise<number> {
    await this.upsertMany(records);
    return records.length;
  }

  async stats(): Promise<OpaqueStats> {
    const rows = this.getDb()
      .prepare(
        `SELECT entity_type, COUNT(*) as cnt
         FROM opaque_records
         WHERE deleted_at IS NULL
         GROUP BY entity_type`
      )
      .all() as unknown as Array<{ entity_type: string; cnt: number }>;

    const byEntityType: Record<string, number> = {};
    let totalActive = 0;

    for (const row of rows) {
      const count = Number(row.cnt);
      byEntityType[row.entity_type] = count;
      totalActive += count;
    }

    return { totalActive, byEntityType };
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }
}
