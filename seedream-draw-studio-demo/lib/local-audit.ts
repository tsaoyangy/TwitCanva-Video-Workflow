export type AuditRequestSnapshot = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  rawBodyBytes: number;
  rawBodySha256: string;
};

export type AuditResponseSnapshot = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  rawBody: string;
  parsedBody: unknown;
  rawBodyBytes: number;
  rawBodySha256: string;
  redactions?: string[];
};

export type LocalAuditTrace = {
  traceVersion: 2;
  traceId: string;
  capturedAt: string;
  durationMs: number;
  retention: "memory-only";
  security: {
    authorizationCaptured: false;
    note: string;
  };
  provider: {
    id: "volcengine" | "byteplus";
    displayName: string;
    endpoint: string;
    model: string;
  };
  clientRequest: AuditRequestSnapshot;
  arkRequest: AuditRequestSnapshot;
  arkResponse?: AuditResponseSnapshot;
  appResponse: {
    status: number;
    headers: Record<string, string>;
    body: unknown;
    auditEnvelopeIncluded: true;
  };
  failure?: { kind: "network" | "timeout" | "cancelled" };
};
