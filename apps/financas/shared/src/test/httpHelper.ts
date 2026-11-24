import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

export type RequestHandlerLike = (req: IncomingMessage, res: ServerResponse) => unknown;

export interface InjectedResponse<T = unknown> {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
  body: T;
}

/**
 * Invokes an Express app completely in-memory without binding a TCP port.
 * Works reliably inside restricted sandboxes and CI environments.
 */
export async function injectExpress<T = unknown>(
  app: RequestHandlerLike,
  options: {
    method?: string;
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
  }
): Promise<InjectedResponse<T>> {
  const method = (options.method || "GET").toUpperCase();
  const payload =
    options.body === undefined
      ? undefined
      : typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body);

  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.method = method;
  req.url = options.url;
  req.headers = {};

  for (const [k, v] of Object.entries(options.headers || {})) {
    req.headers[k.toLowerCase()] = v;
  }

  if (payload !== undefined) {
    if (!req.headers["content-type"]) {
      req.headers["content-type"] = "application/json";
    }
    req.headers["content-length"] = String(Buffer.byteLength(payload));
  }

  const res = new ServerResponse(req);
  const chunks: Buffer[] = [];

  const originalWrite = res.write.bind(res);
  res.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (chunk !== undefined && chunk !== null) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    return (originalWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof res.write;

  const originalEnd = res.end.bind(res);

  return await new Promise<InjectedResponse<T>>((resolve, reject) => {
    res.end = ((chunk?: unknown, ...rest: unknown[]) => {
      if (chunk !== undefined && chunk !== null && typeof chunk !== "function") {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      const result = (originalEnd as (...args: unknown[]) => ServerResponse)(chunk, ...rest);
      const text = Buffer.concat(chunks).toString("utf8");
      let parsed: unknown = text;
      const contentType = String(res.getHeader("content-type") || "");
      if (contentType.includes("application/json") && text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      resolve({
        status: res.statusCode,
        headers: res.getHeaders() as Record<string, string | string[] | undefined>,
        text,
        body: parsed as T,
      });
      return result;
    }) as typeof res.end;

    res.on("error", reject);

    app(req, res);

    if (payload !== undefined) {
      req.push(payload);
    }
    req.push(null);
  });
}
