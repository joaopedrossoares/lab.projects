import type { OpaqueEntityType, OpaqueRecord } from "@financas/shared";
import type { CryptoVault } from "@financas/shared/crypto";
import type { OpaqueTransport, OpaqueTransportHealth, OpaqueTransportStats } from "./opaqueTransport.js";

export interface EntityMeta {
  periodKey?: string | null;
  blindKey?: { namespace: string; value: string };
}

export interface AuditSample {
  id: string;
  entityType: OpaqueEntityType;
  periodKey: string | null;
  localReadable: unknown;
  productionOpaque: {
    id: string;
    entityType: OpaqueEntityType;
    periodKey: string | null;
    blindIndex: string | null;
    encryptedPayloadPreview: string;
    encryptedPayloadLength: number;
    updatedAt: string;
  };
}

export interface PrivacyStatus {
  mode: "hybrid-remote" | "local-sqlite";
  targetLabel: string;
  keyFingerprint: string;
  backendHealth: OpaqueTransportHealth;
  stats: OpaqueTransportStats;
}

export class VaultClient {
  constructor(
    private readonly vault: CryptoVault,
    private readonly transport: OpaqueTransport
  ) {}

  async init(): Promise<void> {
    await this.transport.init();
  }

  getKeyFingerprint(): string {
    return this.vault.fingerprint();
  }

  buildBlindIndex(namespace: string, value: string): string {
    return this.vault.blindIndex(namespace, value);
  }

  async saveEntity<T>(
    entityType: OpaqueEntityType,
    id: string,
    data: T,
    meta: EntityMeta = {}
  ): Promise<T> {
    const record: OpaqueRecord = {
      id,
      entityType,
      periodKey: meta.periodKey ?? null,
      blindIndex: meta.blindKey
        ? this.vault.blindIndex(meta.blindKey.namespace, meta.blindKey.value)
        : null,
      encryptedPayload: this.vault.encryptJson(data),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    };

    await this.transport.upsert(record);
    return data;
  }

  async saveManyEntities<T>(
    items: Array<{ entityType: OpaqueEntityType; id: string; data: T; meta?: EntityMeta }>
  ): Promise<number> {
    const now = new Date().toISOString();
    const records: OpaqueRecord[] = items.map((item) => ({
      id: item.id,
      entityType: item.entityType,
      periodKey: item.meta?.periodKey ?? null,
      blindIndex: item.meta?.blindKey
        ? this.vault.blindIndex(item.meta.blindKey.namespace, item.meta.blindKey.value)
        : null,
      encryptedPayload: this.vault.encryptJson(item.data),
      updatedAt: now,
      deletedAt: null,
    }));

    return this.transport.upsertMany(records);
  }

  async listEntities<T>(
    entityType: OpaqueEntityType,
    filter: { periodKey?: string; blindKey?: { namespace: string; value: string }; limit?: number } = {}
  ): Promise<T[]> {
    const records = await this.transport.list({
      entityType,
      periodKey: filter.periodKey,
      blindIndex: filter.blindKey
        ? this.vault.blindIndex(filter.blindKey.namespace, filter.blindKey.value)
        : undefined,
      limit: filter.limit,
    });

    return records.map((rec) => this.vault.decryptJson<T>(rec.encryptedPayload));
  }

  async getEntity<T>(id: string): Promise<T | null> {
    const record = await this.transport.getById(id);
    if (!record) return null;
    return this.vault.decryptJson<T>(record.encryptedPayload);
  }

  async deleteEntity(id: string): Promise<boolean> {
    return this.transport.deleteById(id);
  }

  async getPrivacyStatus(): Promise<PrivacyStatus> {
    const backendHealth = await this.transport.health();
    let stats: OpaqueTransportStats = { totalActive: 0, byEntityType: {} };
    if (backendHealth.reachable) {
      try {
        stats = await this.transport.stats();
      } catch {
        // Keep zero stats if authenticated stats call fails
      }
    }

    return {
      mode: this.transport.mode,
      targetLabel: this.transport.targetLabel,
      keyFingerprint: this.vault.fingerprint(),
      backendHealth,
      stats,
    };
  }

  async getAuditComparison(limit = 5): Promise<AuditSample[]> {
    const records = await this.transport.list({ limit });
    return records.map((rec) => {
      let localReadable: unknown = null;
      try {
        localReadable = this.vault.decryptJson(rec.encryptedPayload);
      } catch {
        localReadable = { error: "Chave local incompatível com este registro." };
      }

      return {
        id: rec.id,
        entityType: rec.entityType,
        periodKey: rec.periodKey,
        localReadable,
        productionOpaque: {
          id: rec.id,
          entityType: rec.entityType,
          periodKey: rec.periodKey,
          blindIndex: rec.blindIndex,
          encryptedPayloadPreview:
            rec.encryptedPayload.length > 72
              ? `${rec.encryptedPayload.slice(0, 72)}…`
              : rec.encryptedPayload,
          encryptedPayloadLength: rec.encryptedPayload.length,
          updatedAt: rec.updatedAt,
        },
      };
    });
  }

  async exportOpaqueSnapshot(): Promise<OpaqueRecord[]> {
    return this.transport.exportSnapshot();
  }

  async importOpaqueSnapshot(records: OpaqueRecord[]): Promise<number> {
    return this.transport.importSnapshot(records);
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}
