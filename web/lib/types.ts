export type JobKind =
  | "scan"
  | "run_tests"
  | "eval_baseline"
  | "eval_advanced"
  | "eval_compare"
  | "report_pdf";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "timeout" | "canceled";

export interface ScanResult {
  url: string;
  pages_found: number;
  forms_detected: number;
  auth_walls: boolean;
  top_routes: string[];
  pages: Array<{
    url: string;
    title: string;
    forms_count: number;
    links_count: number;
  }>;
}

export interface JobError {
  code: string;
  message: string;
  details?: Record<string, unknown> | null;
}

export interface JobState {
  job_id: string;
  kind: JobKind;
  status: JobStatus;
  phase?: string | null;
  progress: number;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  result?: Record<string, unknown> | null;
  error?: JobError | null;
}

export interface CreateJobResponse {
  job_id: string;
  status: JobStatus;
}

export interface IngestDocsResponse {
  collection: string;
  ingested: boolean;
  chunks_total: number;
  message: string;
}

export interface RetrievedChunk {
  id: string;
  score: number;
  source: string;
  title?: string | null;
  text: string;
}

export interface RetrieveResponse {
  query: string;
  collection: string;
  chunks: RetrievedChunk[];
}

export interface FlowSpecTest {
  id: string;
  title: string;
  tags: string[];
  risk: "low" | "medium" | "high";
  duration_sec: number;
  steps: string[];
  expected_result: string;
  why_suggested: string;
}

export interface FlowSpecResponse {
  url: string;
  prompt?: string | null;
  tests: FlowSpecTest[];
  citations: string[];
}

export interface TestRunItem {
  id: string;
  title: string;
  status: "passed" | "failed";
  route: string;
  duration_ms: number;
  error?: string | null;
  technical_error?: string | null;
  failure_category?: "http_error" | "timeout" | "navigation_error" | "runtime_error" | null;
}

export interface RunTestsResult {
  url: string;
  total: number;
  passed: number;
  failed: number;
  duration_ms: number;
  batch_size: number;
  tests: TestRunItem[];
}

export interface EvalMetricSet {
  faithfulness: number;
  context_precision: number;
  context_recall: number;
}

export interface EvalRunResult {
  metrics: EvalMetricSet;
  samples: Array<{
    sample_id: string;
    query: string;
    expected_source: string;
    retrieved_sources: string[];
    precision: number;
    recall: number;
    faithfulness: number;
  }>;
  config: {
    sample_size: number;
    top_k: number;
    fetch_k: number;
    mode: "baseline" | "advanced";
  };
  conclusion: string;
}

export interface EvalCompareResult {
  baseline: EvalRunResult;
  advanced: EvalRunResult;
  delta: EvalMetricSet;
  config: {
    sample_size: number;
    top_k: number;
    fetch_k: number;
    mode: "compare";
  };
  conclusion: string;
}
