"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createJob, getJob, ingestPlaywrightDocs, listJobs, retrievePlaywrightContext } from "@/lib/api-client";
import type {
  EvalCompareResult,
  EvalRunResult,
  IngestDocsResponse,
  JobKind,
  JobState,
  RetrieveResponse,
} from "@/lib/types";

const POLL_INTERVAL_MS = 1500;
const EVAL_KINDS: JobKind[] = ["eval_compare", "eval_advanced", "eval_baseline"];
const SAFE_DEFAULTS = { sampleSize: 8, topK: 4, fetchK: 8 } as const;
type EvalStep = { key: string; label: string };

const BASELINE_STEPS: EvalStep[] = [
  { key: "dataset_generation", label: "Dataset generation" },
  { key: "retrieval", label: "Retrieval" },
  { key: "scoring", label: "Scoring" },
];

const COMPARE_STEPS: EvalStep[] = [
  { key: "baseline_dataset_generation", label: "Baseline dataset" },
  { key: "baseline_retrieval", label: "Baseline retrieval" },
  { key: "baseline_scoring", label: "Baseline scoring" },
  { key: "advanced_dataset_generation", label: "Advanced dataset" },
  { key: "advanced_retrieval", label: "Advanced retrieval" },
  { key: "advanced_scoring", label: "Advanced scoring" },
];

function getEvalSteps(kind: JobKind | null): EvalStep[] {
  if (kind === "eval_compare") {
    return COMPARE_STEPS;
  }
  return BASELINE_STEPS;
}

function normalizePhase(
  phase?: string | null,
  kind: JobKind | null = null,
  progress: number | null = null,
): string | null {
  if (!phase) return null;
  if (phase === "baseline_initializing") return "baseline_dataset_generation";
  if (phase === "advanced_initializing") return "advanced_dataset_generation";
  if (kind === "eval_compare" && ["dataset_generation", "retrieval", "scoring"].includes(phase)) {
    const isBaselinePhase = (progress ?? 0) < 50;
    const prefix = isBaselinePhase ? "baseline" : "advanced";
    return `${prefix}_${phase}`;
  }
  return phase;
}

function humanizeEvalError(job: JobState | null, requestError: string | null): string | null {
  if (requestError) {
    return requestError;
  }
  if (!job?.error) {
    return null;
  }

  const code = job.error.code ?? "";
  const message = job.error.message ?? "";
  const text = `${code} ${message}`.toLowerCase();

  if (code === "INVALID_INPUT") {
    return "Invalid input values. Check Sample size, Top K, and Fetch K ranges.";
  }
  if (code === "EVAL_TIMEOUT" || job.status === "timeout" || text.includes("timed out")) {
    return "Evaluation timed out. Try smaller sample size and lower fetch K.";
  }
  if (text.includes("rate limit") || text.includes("rpd") || text.includes("quota")) {
    return "OpenAI rate/quota limit reached. Wait for reset or use a lower-traffic model.";
  }
  if (text.includes("max_tokens") || text.includes("increase openai_eval_max_tokens") || text.includes("llm generation was not completed")) {
    return "Generation stopped due to token/output limit. Lower sample size or increase evaluation max tokens.";
  }

  return `${code}: ${message}`;
}

export default function EvaluationPage() {
  const [sampleSize, setSampleSize] = useState(12);
  const [topK, setTopK] = useState(5);
  const [fetchK, setFetchK] = useState(20);
  const [isRunning, setIsRunning] = useState(false);
  const [job, setJob] = useState<JobState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ragQuery, setRagQuery] = useState("");
  const [isIngesting, setIsIngesting] = useState(false);
  const [isRetrieving, setIsRetrieving] = useState(false);
  const [ingestResult, setIngestResult] = useState<IngestDocsResponse | null>(null);
  const [retrieveResult, setRetrieveResult] = useState<RetrieveResponse | null>(null);
  const [ragError, setRagError] = useState<string | null>(null);
  const [latestBaselineJob, setLatestBaselineJob] = useState<JobState | null>(null);
  const [latestAdvancedJob, setLatestAdvancedJob] = useState<JobState | null>(null);
  const [latestCompareJob, setLatestCompareJob] = useState<JobState | null>(null);

  const isEvalJob = useMemo(() => {
    return Boolean(job && EVAL_KINDS.includes(job.kind));
  }, [job]);

  useEffect(() => {
    let active = true;

    const restoreLatestEvalJob = async () => {
      try {
        const jobs = await listJobs({ limit: 200 });
        if (!active) {
          return;
        }
        const latestCompletedBaseline =
          jobs.find((candidate) => candidate.kind === "eval_baseline" && candidate.status === "completed") ?? null;
        const latestCompletedAdvanced =
          jobs.find((candidate) => candidate.kind === "eval_advanced" && candidate.status === "completed") ?? null;
        const latestCompletedCompare =
          jobs.find((candidate) => candidate.kind === "eval_compare" && candidate.status === "completed") ?? null;
        setLatestBaselineJob(latestCompletedBaseline);
        setLatestAdvancedJob(latestCompletedAdvanced);
        setLatestCompareJob(latestCompletedCompare);

        const latestEvalJob = jobs.find((candidate) => EVAL_KINDS.includes(candidate.kind));
        if (!latestEvalJob) {
          return;
        }
        setJob(latestEvalJob);
        if (latestEvalJob.status === "running" || latestEvalJob.status === "queued") {
          setIsRunning(true);
          await pollJobUntilDone(latestEvalJob.job_id);
          if (active) {
            setIsRunning(false);
          }
        }
      } catch {
        // Ignore restore errors and keep manual run flow available.
      }
    };

    void restoreLatestEvalJob();

    return () => {
      active = false;
    };
  }, []);

  async function run(
    kind: JobKind,
    overrides?: { sampleSize?: number; topK?: number; fetchK?: number },
  ) {
    setIsRunning(true);
    setError(null);
    setJob(null);
    const effectiveSampleSize = overrides?.sampleSize ?? sampleSize;
    const effectiveTopK = overrides?.topK ?? topK;
    const effectiveFetchK = overrides?.fetchK ?? fetchK;
    try {
      const created = await createJob(kind, {
        sample_size: effectiveSampleSize,
        top_k: effectiveTopK,
        fetch_k: effectiveFetchK,
        force_ingest: false,
      });
      await pollJobUntilDone(created.job_id);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Evaluation failed.");
    } finally {
      setIsRunning(false);
    }
  }

  async function pollJobUntilDone(jobId: string) {
    let done = false;
    while (!done) {
      const current = await getJob(jobId);
      setJob(current);
      done = ["completed", "failed", "timeout", "canceled"].includes(current.status);
      if (current.status === "completed") {
        if (current.kind === "eval_baseline") {
          setLatestBaselineJob(current);
        } else if (current.kind === "eval_advanced") {
          setLatestAdvancedJob(current);
        } else if (current.kind === "eval_compare") {
          setLatestCompareJob(current);
        }
      }
      if (!done) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    }
  }

  async function handleIngest() {
    setIsIngesting(true);
    setRagError(null);
    try {
      const result = await ingestPlaywrightDocs(true);
      setIngestResult(result);
    } catch (ingestError) {
      const message = ingestError instanceof Error ? ingestError.message : "Failed to ingest docs.";
      setRagError(message);
    } finally {
      setIsIngesting(false);
    }
  }

  async function handleRetrieve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsRetrieving(true);
    setRagError(null);
    setRetrieveResult(null);
    try {
      const result = await retrievePlaywrightContext(ragQuery, 5);
      setRetrieveResult(result);
    } catch (retrieveError) {
      const message = retrieveError instanceof Error ? retrieveError.message : "Failed to retrieve context.";
      setRagError(message);
    } finally {
      setIsRetrieving(false);
    }
  }

  const baselineJob = useMemo(() => {
    if (job?.kind === "eval_baseline" && job.status === "completed") {
      return job;
    }
    return latestBaselineJob;
  }, [job, latestBaselineJob]);

  const advancedJob = useMemo(() => {
    if (job?.kind === "eval_advanced" && job.status === "completed") {
      return job;
    }
    return latestAdvancedJob;
  }, [job, latestAdvancedJob]);

  const compareJob = useMemo(() => {
    if (job?.kind === "eval_compare" && job.status === "completed") {
      return job;
    }
    return latestCompareJob;
  }, [job, latestCompareJob]);

  const baseline = baselineJob?.result ? (baselineJob.result as unknown as EvalRunResult) : null;
  const advanced = advancedJob?.result ? (advancedJob.result as unknown as EvalRunResult) : null;
  const compare = compareJob?.result ? (compareJob.result as unknown as EvalCompareResult) : null;
  const evalSteps = getEvalSteps(job?.kind ?? null);
  const phaseKey = normalizePhase(job?.phase, job?.kind ?? null, job?.progress ?? null);
  const activeStepIndex = phaseKey ? evalSteps.findIndex((step) => step.key === phaseKey) : -1;
  const friendlyEvalError = humanizeEvalError(job, error);
  const canShowRecoveryActions = Boolean(
    job &&
      isEvalJob &&
      !isRunning &&
      (job.status === "failed" || job.status === "timeout" || job.status === "canceled"),
  );

  async function handleRetryWithSafeDefaults() {
    const kind = job && EVAL_KINDS.includes(job.kind) ? job.kind : "eval_baseline";
    setSampleSize(SAFE_DEFAULTS.sampleSize);
    setTopK(SAFE_DEFAULTS.topK);
    setFetchK(SAFE_DEFAULTS.fetchK);
    await run(kind, {
      sampleSize: SAFE_DEFAULTS.sampleSize,
      topK: SAFE_DEFAULTS.topK,
      fetchK: SAFE_DEFAULTS.fetchK,
    });
  }

  async function handleRunBaselineOnly() {
    await run("eval_baseline");
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Evaluation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Run baseline and advanced retrieval evaluation for faithfulness, context precision, and context recall.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>RAG Retrieval Test</CardTitle>
          <CardDescription>
            Ingest Playwright docs into Qdrant, then test retrieval results for a query.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Button disabled={isIngesting} onClick={handleIngest} type="button" variant="outline">
              {isIngesting ? "Ingesting..." : "Ingest Playwright docs"}
            </Button>
            {ingestResult ? (
              <p className="text-sm text-muted-foreground">
                {ingestResult.message} ({ingestResult.chunks_total} chunks)
              </p>
            ) : null}
          </div>

          <form className="space-y-3" onSubmit={handleRetrieve}>
            <Input
              aria-label="RAG question"
              placeholder="Why does strict mode locator failure happen?"
              required
              value={ragQuery}
              onChange={(event) => setRagQuery(event.target.value)}
            />
            <Button disabled={isRetrieving} type="submit">
              {isRetrieving ? "Retrieving..." : "Retrieve context"}
            </Button>
          </form>

          {ragError ? <p className="text-sm text-red-500">{ragError}</p> : null}

          {retrieveResult ? (
            <div className="space-y-3">
              {retrieveResult.chunks.map((chunk, index) => (
                <div key={`${chunk.id}-${index}`} className="rounded-md border border-border p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">{chunk.source}</p>
                    <Badge variant="secondary">score: {chunk.score.toFixed(3)}</Badge>
                  </div>
                  <p className="text-sm leading-relaxed">{chunk.text}</p>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Run Evaluation</CardTitle>
          <CardDescription>Runs as async job on the runner and returns metric tables for this session.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Sample size</p>
              <Input
                className="bg-card [color-scheme:dark]"
                min={4}
                max={40}
                type="number"
                value={sampleSize}
                onChange={(event) => setSampleSize(Number(event.target.value))}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Top K</p>
              <Input
                className="bg-card [color-scheme:dark]"
                min={1}
                max={10}
                type="number"
                value={topK}
                onChange={(event) => setTopK(Number(event.target.value))}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Fetch K</p>
              <Input
                className="bg-card [color-scheme:dark]"
                min={5}
                max={50}
                type="number"
                value={fetchK}
                onChange={(event) => setFetchK(Number(event.target.value))}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button disabled={isRunning} onClick={() => run("eval_baseline")} type="button" variant="outline">
              Run Baseline
            </Button>
            <Button disabled={isRunning} onClick={() => run("eval_advanced")} type="button" variant="outline">
              Run Advanced
            </Button>
            <Button disabled={isRunning} onClick={() => run("eval_compare")} type="button">
              Run Compare
            </Button>
          </div>

          {job && isEvalJob ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="secondary">{job.status}</Badge>
                <span className="text-muted-foreground">{job.kind}</span>
                <span className="text-muted-foreground">progress: {job.progress}%</span>
                {phaseKey ? <span className="text-muted-foreground">phase: {phaseKey}</span> : null}
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                {evalSteps.map((step, index) => {
                  const isCompleted = job.status === "completed" || (activeStepIndex >= 0 && index < activeStepIndex);
                  const isActive = job.status === "running" && index === activeStepIndex;
                  const isPending = !isCompleted && !isActive;
                  return (
                    <div
                      key={step.key}
                      className={`rounded-md border px-3 py-2 text-xs ${
                        isCompleted
                          ? "border-green-500/40 bg-green-500/10 text-green-400"
                          : isActive
                            ? "border-primary/60 bg-primary/10 text-primary"
                            : isPending
                              ? "border-border text-muted-foreground"
                              : "border-border text-muted-foreground"
                      }`}
                    >
                      {step.label}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {friendlyEvalError ? <p className="text-sm text-red-500">{friendlyEvalError}</p> : null}
          {job?.status === "timeout" ? (
            <p className="text-xs text-muted-foreground">
              Tip: reduce sample size/fetch K or run baseline first, then advanced/compare.
            </p>
          ) : null}
          {canShowRecoveryActions ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleRetryWithSafeDefaults} type="button" variant="outline">
                Retry with safe defaults (8/4/8)
              </Button>
              <Button onClick={handleRunBaselineOnly} type="button" variant="secondary">
                Run baseline only
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {baseline ? <MetricCard title="Baseline Metrics" result={baseline} /> : null}
      {advanced ? <MetricCard title="Advanced Metrics" result={advanced} /> : null}

      {compare ? (
        <Card>
          <CardHeader>
            <CardTitle>Comparison</CardTitle>
            <CardDescription>{compare.conclusion}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <MetricTable baseline={compare.baseline.metrics} advanced={compare.advanced.metrics} delta={compare.delta} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function MetricCard({ title, result }: { title: string; result: EvalRunResult }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{result.conclusion}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <MetricItem label="Faithfulness" value={result.metrics.faithfulness} />
          <MetricItem label="Context precision" value={result.metrics.context_precision} />
          <MetricItem label="Context recall" value={result.metrics.context_recall} />
        </div>
      </CardContent>
    </Card>
  );
}

function MetricItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value.toFixed(4)}</p>
    </div>
  );
}

function MetricTable({
  baseline,
  advanced,
  delta,
}: {
  baseline: { faithfulness: number; context_precision: number; context_recall: number };
  advanced: { faithfulness: number; context_precision: number; context_recall: number };
  delta: { faithfulness: number; context_precision: number; context_recall: number };
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="min-w-full text-sm">
        <thead className="border-b border-border bg-card">
          <tr>
            <th className="px-3 py-2 text-left">Metric</th>
            <th className="px-3 py-2 text-left">Baseline</th>
            <th className="px-3 py-2 text-left">Advanced</th>
            <th className="px-3 py-2 text-left">Delta</th>
          </tr>
        </thead>
        <tbody>
          <Row name="Faithfulness" baseline={baseline.faithfulness} advanced={advanced.faithfulness} delta={delta.faithfulness} />
          <Row
            name="Context precision"
            baseline={baseline.context_precision}
            advanced={advanced.context_precision}
            delta={delta.context_precision}
          />
          <Row
            name="Context recall"
            baseline={baseline.context_recall}
            advanced={advanced.context_recall}
            delta={delta.context_recall}
          />
        </tbody>
      </table>
    </div>
  );
}

function Row({ name, baseline, advanced, delta }: { name: string; baseline: number; advanced: number; delta: number }) {
  return (
    <tr className="border-b border-border">
      <td className="px-3 py-2">{name}</td>
      <td className="px-3 py-2">{baseline.toFixed(4)}</td>
      <td className="px-3 py-2">{advanced.toFixed(4)}</td>
      <td className={`px-3 py-2 ${delta >= 0 ? "text-green-500" : "text-red-500"}`}>{delta.toFixed(4)}</td>
    </tr>
  );
}
