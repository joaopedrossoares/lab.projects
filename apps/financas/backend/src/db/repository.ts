import type { OpaqueEntityType, OpaqueRecord } from "@financas/shared";

export interface ListOpaqueRecordsFilter {
  entityType?: OpaqueEntityType;
  periodKey?: string;
  blindIndex?: string;
  includeDeleted?: boolean;
  limit?: number;
}

export interface OpaqueStats {
  totalActive: number;
  byEntityType: Record<string, number>;
}

export interface OpaqueRecordRepository {
  readonly kind: "postgres" | "sqlite";
  init(): Promise<void>;
  list(filter?: ListOpaqueRecordsFilter): Promise<OpaqueRecord[]>;
  getById(id: string): Promise<OpaqueRecord | null>;
  upsert(record: OpaqueRecord): Promise<OpaqueRecord>;
  upsertMany(records: OpaqueRecord[]): Promise<OpaqueRecord[]>;
  softDelete(id: string, deletedAt: string): Promise<boolean>;
  exportAll(): Promise<OpaqueRecord[]>;
  importAll(records: OpaqueRecord[]): Promise<number>;
  stats(): Promise<OpaqueStats>;
  close(): Promise<void>;
}
