const RAILWAY_GRAPHQL_URL = "https://backboard.railway.com/graphql/v2";

export interface RailwayServiceResourceSnapshot {
  serviceId: string;
  serviceName: string;
  cpuAvg: number;
  cpuPeak: number;
  memoryMbCurrent: number;
  memoryMbPeak: number;
  diskGbCurrent: number;
  networkTxMb: number;
}

export interface RailwayUsageReport {
  configured: true;
  projectId: string;
  projectName: string;
  environmentName: string;
  fetchedAt: string;
  windowHours: number;
  services: RailwayServiceResourceSnapshot[];
  totals: {
    memoryMbCurrent: number;
    memoryMbPeak: number;
    diskGbCurrent: number;
    cpuAvg: number;
  };
  billingEstimate: {
    available: boolean;
    monthToDateUsd: number | null;
    projectedMonthlyUsd: number | null;
    note: string;
  };
  recommendation: {
    level: "ok" | "tip" | "warn";
    message: string;
  };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

// Approximate public Railway per-unit rates for estimated usage visualization:
// CPU: $0.000463 / vCPU-min | RAM: $0.000231 / GB-min | Disk: $0.00000006 / GB-sec | Egress: $0.05 / GB
function estimateRailwayCostFromMeasurements(
  items: Array<{ measurement?: string; value?: number; estimatedValue?: number }>
): number | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  let usd = 0;
  let matched = false;

  for (const item of items) {
    const raw =
      typeof item.estimatedValue === "number"
        ? item.estimatedValue
        : typeof item.value === "number"
          ? item.value
          : NaN;
    if (!Number.isFinite(raw) || raw < 0) continue;

    switch (item.measurement) {
      case "CPU_USAGE":
        // Railway usage reports vCPU-minutes
        usd += raw * 0.000463;
        matched = true;
        break;
      case "MEMORY_USAGE_GB":
        // Railway usage reports GB-minutes
        usd += raw * 0.000231;
        matched = true;
        break;
      case "DISK_USAGE_GB":
        // Railway usage reports GB-minutes (~$0.15 / GB-month => ~$0.00000347 / GB-min)
        usd += raw * 0.00000347;
        matched = true;
        break;
      case "NETWORK_TX_GB":
        usd += raw * 0.05;
        matched = true;
        break;
      default:
        break;
    }
  }

  return matched ? Math.round(usd * 100) / 100 : null;
}

async function callRailwayGraphQL<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
  fetchImpl: typeof fetch,
  headerMode: "bearer" | "project"
): Promise<GraphQLResponse<T>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (headerMode === "project") {
    headers["Project-Access-Token"] = token;
  } else {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetchImpl(RAILWAY_GRAPHQL_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Railway API respondeu HTTP ${res.status}`);
  }

  return (await res.json()) as GraphQLResponse<T>;
}

async function queryRailwayWithAuthFallback<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
  fetchImpl: typeof fetch
): Promise<{ data: T; headerMode: "bearer" | "project" }> {
  const first = await callRailwayGraphQL<T>(token, query, variables, fetchImpl, "bearer");
  if (first.data && (!first.errors || first.errors.length === 0)) {
    return { data: first.data, headerMode: "bearer" };
  }

  const firstErr = first.errors?.map((e) => e.message).filter(Boolean).join("; ") || "";
  const maybeAuthErr = /not authorized|unauthenticated|forbidden|invalid token/i.test(firstErr);

  if (maybeAuthErr) {
    const second = await callRailwayGraphQL<T>(token, query, variables, fetchImpl, "project");
    if (second.data && (!second.errors || second.errors.length === 0)) {
      return { data: second.data, headerMode: "project" };
    }
    const secondErr = second.errors?.map((e) => e.message).filter(Boolean).join("; ");
    throw new Error(secondErr || firstErr || "Token da Railway sem permissão para este projeto.");
  }

  throw new Error(firstErr || "Resposta inesperada da API da Railway.");
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

export async function fetchRailwayProjectUsage(options: {
  apiToken: string;
  projectId: string;
  windowHours?: number;
  fetchImpl?: typeof fetch;
}): Promise<RailwayUsageReport> {
  const { apiToken, projectId, windowHours = 24, fetchImpl = fetch } = options;

  const projectQuery = `
    query getProject($id: String!) {
      project(id: $id) {
        id
        name
        environments { edges { node { id name } } }
        services { edges { node { id name } } }
      }
    }
  `;

  const { data: projectData, headerMode } = await queryRailwayWithAuthFallback<{
    project?: {
      id: string;
      name: string;
      environments?: { edges?: Array<{ node?: { id: string; name: string } }> };
      services?: { edges?: Array<{ node?: { id: string; name: string } }> };
    };
  }>(apiToken, projectQuery, { id: projectId }, fetchImpl);

  const project = projectData.project;
  if (!project) {
    throw new Error("Projeto não encontrado na Railway. Confira o Project ID e o escopo do token.");
  }

  const envs = (project.environments?.edges || [])
    .map((e) => e.node)
    .filter((n): n is { id: string; name: string } => Boolean(n?.id));
  const targetEnv =
    envs.find((e) => e.name.toLowerCase() === "production") || envs[0];
  if (!targetEnv) {
    throw new Error("Nenhum ambiente encontrado neste projeto da Railway.");
  }

  const serviceNameById = new Map<string, string>();
  for (const edge of project.services?.edges || []) {
    if (edge.node?.id) {
      serviceNameById.set(edge.node.id, edge.node.name || edge.node.id);
    }
  }

  const now = new Date();
  const startDate = new Date(now.getTime() - windowHours * 3600 * 1000).toISOString();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const metricsQuery = `
    query getMetrics($environmentId: String!, $startDate: DateTime!, $measurements: [MetricMeasurement!]!) {
      metrics(
        environmentId: $environmentId
        startDate: $startDate
        groupBy: [SERVICE_ID]
        measurements: $measurements
      ) {
        measurement
        tags { serviceId }
        values { ts value }
      }
    }
  `;

  const usageQuery = `
    query getUsage($projectId: String!, $startDate: DateTime!, $measurements: [MetricMeasurement!]!) {
      usage(projectId: $projectId, startDate: $startDate, measurements: $measurements) {
        measurement
        value
      }
      estimatedUsage(projectId: $projectId, measurements: $measurements) {
        measurement
        estimatedValue
      }
    }
  `;

  const measurements = ["CPU_USAGE", "MEMORY_USAGE_GB", "DISK_USAGE_GB", "NETWORK_TX_GB"];

  const [metricsSettled, usageSettled] = await Promise.allSettled([
    callRailwayGraphQL<{
      metrics?: Array<{
        measurement: string;
        tags?: { serviceId?: string };
        values?: Array<{ ts: number; value: number }>;
      }>;
    }>(apiToken, metricsQuery, { environmentId: targetEnv.id, startDate, measurements }, fetchImpl, headerMode),
    callRailwayGraphQL<{
      usage?: Array<{ measurement?: string; value?: number }>;
      estimatedUsage?: Array<{ measurement?: string; estimatedValue?: number }>;
    }>(apiToken, usageQuery, { projectId: project.id, startDate: monthStart, measurements }, fetchImpl, headerMode),
  ]);

  const serviceMap = new Map<string, RailwayServiceResourceSnapshot>();
  for (const [id, name] of serviceNameById.entries()) {
    serviceMap.set(id, {
      serviceId: id,
      serviceName: name,
      cpuAvg: 0,
      cpuPeak: 0,
      memoryMbCurrent: 0,
      memoryMbPeak: 0,
      diskGbCurrent: 0,
      networkTxMb: 0,
    });
  }

  if (metricsSettled.status === "fulfilled" && Array.isArray(metricsSettled.value.data?.metrics)) {
    for (const series of metricsSettled.value.data.metrics) {
      const sid = series.tags?.serviceId || "unknown";
      const entry = serviceMap.get(sid) || {
        serviceId: sid,
        serviceName: serviceNameById.get(sid) || sid,
        cpuAvg: 0,
        cpuPeak: 0,
        memoryMbCurrent: 0,
        memoryMbPeak: 0,
        diskGbCurrent: 0,
        networkTxMb: 0,
      };
      const vals = (series.values || [])
        .map((v) => Number(v.value))
        .filter((v) => Number.isFinite(v) && v >= 0);

      if (vals.length > 0) {
        const current = vals[vals.length - 1];
        const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
        const peak = Math.max(...vals);

        if (series.measurement === "CPU_USAGE") {
          entry.cpuAvg = round4(avg);
          entry.cpuPeak = round4(peak);
        } else if (series.measurement === "MEMORY_USAGE_GB") {
          entry.memoryMbCurrent = round2(current * 1024);
          entry.memoryMbPeak = round2(peak * 1024);
        } else if (series.measurement === "DISK_USAGE_GB") {
          entry.diskGbCurrent = round4(current);
        } else if (series.measurement === "NETWORK_TX_GB") {
          entry.networkTxMb = round2(vals.reduce((s, v) => s + v, 0) * 1024);
        }
      }
      serviceMap.set(sid, entry);
    }
  }

  const services = Array.from(serviceMap.values()).sort((a, b) =>
    a.serviceName.localeCompare(b.serviceName)
  );

  const totals = {
    memoryMbCurrent: round2(services.reduce((s, svc) => s + svc.memoryMbCurrent, 0)),
    memoryMbPeak: round2(services.reduce((s, svc) => s + svc.memoryMbPeak, 0)),
    diskGbCurrent: round4(services.reduce((s, svc) => s + svc.diskGbCurrent, 0)),
    cpuAvg: round4(services.reduce((s, svc) => s + svc.cpuAvg, 0)),
  };

  let monthToDateUsd: number | null = null;
  let projectedMonthlyUsd: number | null = null;
  if (usageSettled.status === "fulfilled" && usageSettled.value.data) {
    monthToDateUsd = estimateRailwayCostFromMeasurements(usageSettled.value.data.usage || []);
    projectedMonthlyUsd = estimateRailwayCostFromMeasurements(
      usageSettled.value.data.estimatedUsage || []
    );
  }

  let recommendation: RailwayUsageReport["recommendation"];
  if ((projectedMonthlyUsd !== null && projectedMonthlyUsd >= 5) || totals.memoryMbPeak >= 512) {
    recommendation = {
      level: "warn",
      message:
        projectedMonthlyUsd !== null && projectedMonthlyUsd >= 5
          ? `Projeção do ciclo em ~US$ ${projectedMonthlyUsd.toFixed(2)} (acima de US$ 5). Vale ativar App Sleeping na API ou avaliar migração para seu homelab local.`
          : `Pico de memória de ${totals.memoryMbPeak} MB; monitore os serviços ativos ou ative App Sleeping na API.`,
    };
  } else if (totals.memoryMbCurrent <= 200 && totals.cpuAvg < 0.05) {
    recommendation = {
      level: "ok",
      message: `Consumo muito baixo (${totals.memoryMbCurrent.toFixed(0)} MB RAM total, CPU média ${totals.cpuAvg.toFixed(4)} vCPU). Não precisa reduzir configurações; se quiser economizar ainda mais, ative App Sleeping no serviço api.`,
    };
  } else {
    recommendation = {
      level: "tip",
      message: `Consumo moderado (${totals.memoryMbCurrent.toFixed(0)} MB RAM total). Acompanhe mensalmente pela aba Configurações.`,
    };
  }

  return {
    configured: true,
    projectId: project.id,
    projectName: project.name,
    environmentName: targetEnv.name,
    fetchedAt: now.toISOString(),
    windowHours,
    services,
    totals,
    billingEstimate: {
      available: monthToDateUsd !== null || projectedMonthlyUsd !== null,
      monthToDateUsd,
      projectedMonthlyUsd,
      note:
        monthToDateUsd !== null || projectedMonthlyUsd !== null
          ? "Estimativa calculada pelas tarifas públicas da Railway (não substitui a fatura oficial)."
          : "Métricas de recurso carregadas; estimativa em dólar indisponível para este escopo de token.",
    },
    recommendation,
  };
}
