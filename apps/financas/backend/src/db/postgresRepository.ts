import { Pool } from "pg";
import type { OpaqueEntityType, OpaqueRecord } from "@financas/shared";
import type {
  ListOpaqueRecordsFilter,
  OpaqueRecordRepository,
  OpaqueStats,
} from "./repository.js";

interface PgRawRow {
  id: string;
  entity_type: string;
  period_key: string | null;
  blind_index: string | null;
  encrypted_payload: string;
  updated_at: string;
  deleted_at: string | null;
}

function mapRow(row: PgRawRow): OpaqueRecord {
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

export class PostgresOpaqueRepository implements OpaqueRecordRepository {
  readonly kind = "postgres" as const;
  private readonly pool: Pool;

  constructor(connectionString: string) {
    const disableSsl =
      process.env.DATABASE_SSL === "false" ||
      connectionString.includes("localhost") ||
      connectionString.includes("127.0.0.1") ||
      connectionString.includes(".railway.internal");

    this.pool = new Pool({
      connectionString,
      ssl: disableSsl ? false : { rejectUnauthorized: false },
    });
  }

  async init(): Promise<void> {
    await this.pool.query(`
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

  async list(filter: ListOpaqueRecordsFilter = {}): Promise<OpaqueRecord[]> {
    const clauses: string[] = [];
    const params: (string | number)[] = [];

    if (!filter.includeDeleted) {
      clauses.push("deleted_at IS NULL");
    }
    if (filter.entityType) {
      params.push(filter.entityType);
      clauses.push(`entity_type = $${params.length}`);
    }
    if (filter.periodKey) {
      params.push(filter.periodKey);
      clauses.push(`period_key = $${params.length}`);
    }
    if (filter.blindIndex) {
      params.push(filter.blindIndex);
      clauses.push(`blind_index = $${params.length}`);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    let limitClause = "";
    if (filter.limit && filter.limit > 0) {
      params.push(filter.limit);
      limitClause = `LIMIT $${params.length}`;
    }

    const result = await this.pool.query<PgRawRow>(
      `SELECT id, entity_type, period_key, blind_index, encrypted_payload, updated_at, deleted_at
       FROM opaque_records
       ${where}
       ORDER BY updated_at DESC
       ${limitClause}`,
      params
    );

    return result.rows.map(mapRow);
  }

  async getById(id: string): Promise<OpaqueRecord | null> {
    const result = await this.pool.query<PgRawRow>(
      `SELECT id, entity_type, period_key, blind_index, encrypted_payload, updated_at, deleted_at
       FROM opaque_records WHERE id = $1`,
      [id]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async upsert(record: OpaqueRecord): Promise<OpaqueRecord> {
    await this.pool.query(
      `INSERT INTO opaque_records (id, entity_type, period_key, blind_index, encrypted_payload, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT(id) DO UPDATE SET
         entity_type = EXCLUDED.entity_type,
         period_key = EXCLUDED.period_key,
         blind_index = EXCLUDED.blind_index,
         encrypted_payload = EXCLUDED.encrypted_payload,
         updated_at = EXCLUDED.updated_at,
         deleted_at = EXCLUDED.deleted_at`,
      [
        record.id,
        record.entityType,
        record.periodKey,
        record.blindIndex,
        record.encryptedPayload,
        record.updatedAt,
        record.deletedAt,
      ]
    );
    return record;
  }

  async upsertMany(records: OpaqueRecord[]): Promise<OpaqueRecord[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const record of records) {
        await client.query(
          `INSERT INTO opaque_records (id, entity_type, period_key, blind_index, encrypted_payload, updated_at, deleted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT(id) DO UPDATE SET
             entity_type = EXCLUDED.entity_type,
             period_key = EXCLUDED.period_key,
             blind_index = EXCLUDED.blind_index,
             encrypted_payload = EXCLUDED.encrypted_payload,
             updated_at = EXCLUDED.updated_at,
             deleted_at = EXCLUDED.deleted_at`,
          [
            record.id,
            record.entityType,
            record.periodKey,
            record.blindIndex,
            record.encryptedPayload,
            record.updatedAt,
            record.deletedAt,
          ]
        );
      }
      await client.query("COMMIT");
      return records;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async softDelete(id: string, deletedAt: string): Promise<boolean> {
    const result = await this.pool.query(
      "UPDATE opaque_records SET deleted_at = $1, updated_at = $1 WHERE id = $2 AND deleted_at IS NULL",
      [deletedAt, id]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async exportAll(): Promise<OpaqueRecord[]> {
    return this.list({ includeDeleted: true });
  }

  async importAll(records: OpaqueRecord[]): Promise<number> {
    await this.upsertMany(records);
    return records.length;
  }

  async stats(): Promise<OpaqueStats> {
    const result = await this.pool.query<{ entity_type: string; cnt: string }>(
      `SELECT entity_type, COUNT(*)::text AS cnt
       FROM opaque_records
       WHERE deleted_at IS NULL
       GROUP BY entity_type`
    );

    const byEntityType: Record<string, number> = {};
    let totalActive = 0;

    for (const row of result.rows) {
      const count = Number(row.cnt);
      byEntityType[row.entity_type] = count;
      totalActive += count;
    }

    return { totalActive, byEntityType };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
