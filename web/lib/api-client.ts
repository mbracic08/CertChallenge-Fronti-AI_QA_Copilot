import type {
  CreateJobResponse,
  FlowSpecTest,
  JobKind,
  FlowSpecResponse,
  IngestDocsResponse,
  JobState,
  RunTestsResult,
  RetrieveResponse,
  ScanResult,
} from "@/lib/types";

export interface ScanRequest {
  url: string;
  prompt?: string;
  max_pages?: number;
  max_depth?: number;
}

export async function createJob(kind: JobKind, payload: object): Promise<CreateJobResponse> {
  const response = await fetch("/api/jobs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      kind,
      payload,
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof data === "object" && data !== null ? JSON.stringify(data) : "unknown error";
    throw new Error(`Failed to create scan job: ${detail}`);
  }

  const jobId =
    typeof data?.job_id === "string"
      ? data.job_id
      : typeof data?.jobId === "string"
        ? data.jobId
        : null;

  if (!jobId) {
    throw new Error("Failed to create scan job: missing job id in response.");
  }

  return {
    job_id: jobId,
    status: data.status,
  };
}

export async function createScanJob(payload: ScanRequest): Promise<CreateJobResponse> {
  return createJob("scan", payload);
}

export async function createRunTestsJob(payload: {
  url: string;
  tests: FlowSpecTest[];
  batch_size?: number;
}): Promise<CreateJobResponse> {
  return createJob("run_tests", payload);
}

export async function getJob(jobId: string): Promise<JobState> {
  const response = await fetch(`/api/jobs/${jobId}`, {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch job status.");
  }

  return response.json();
}

export async function cancelJob(jobId: string): Promise<JobState> {
  const response = await fetch(`/api/jobs/${jobId}/cancel`, {
    method: "POST",
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof data === "object" && data !== null ? JSON.stringify(data) : "unknown error";
    throw new Error(`Failed to cancel job: ${detail}`);
  }

  return data as JobState;
}

export async function listJobs(input?: {
  kind?: JobKind;
  status?: JobState["status"];
  limit?: number;
}): Promise<JobState[]> {
  const params = new URLSearchParams();
  if (input?.kind) {
    params.set("kind", input.kind);
  }
  if (input?.status) {
    params.set("status", input.status);
  }
  if (typeof input?.limit === "number") {
    params.set("limit", String(input.limit));
  }

  const query = params.toString();
  const response = await fetch(`/api/jobs${query ? `?${query}` : ""}`, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch jobs.");
  }
  return (await response.json()) as JobState[];
}

export async function ingestPlaywrightDocs(force = false): Promise<IngestDocsResponse> {
  const response = await fetch(`/api/rag/ingest?force=${force ? "true" : "false"}`, {
    method: "POST",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof data === "object" && data !== null ? JSON.stringify(data) : "unknown error";
    throw new Error(`Failed to ingest docs: ${detail}`);
  }
  return data as IngestDocsResponse;
}

export async function retrievePlaywrightContext(
  query: string,
  topK = 5,
): Promise<RetrieveResponse> {
  const response = await fetch("/api/rag/retrieve", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query,
      top_k: topK,
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof data === "object" && data !== null ? JSON.stringify(data) : "unknown error";
    throw new Error(`Failed to retrieve context: ${detail}`);
  }
  return data as RetrieveResponse;
}

export async function generateFlowSpec(input: {
  url: string;
  prompt?: string;
  scan: ScanResult;
}): Promise<FlowSpecResponse> {
  const response = await fetch("/api/agent/flow-spec", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof data === "object" && data !== null ? JSON.stringify(data) : "unknown error";
    throw new Error(`Failed to generate flow spec: ${detail}`);
  }

  return data as FlowSpecResponse;
}

export function toRunTestsResult(result: unknown): RunTestsResult | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const candidate = result as Partial<RunTestsResult>;
  if (
    typeof candidate.url !== "string" ||
    typeof candidate.total !== "number" ||
    typeof candidate.passed !== "number" ||
    typeof candidate.failed !== "number" ||
    typeof candidate.duration_ms !== "number" ||
    !Array.isArray(candidate.tests)
  ) {
    return null;
  }
  return candidate as RunTestsResult;
}
