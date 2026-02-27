"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  cancelJob,
  createScanJob,
  createRunTestsJob,
  generateFlowSpec,
  getJob,
  toRunTestsResult,
} from "@/lib/api-client";
import type {
  FlowSpecResponse,
  JobState,
  RunTestsResult,
  ScanResult,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";

const POLL_INTERVAL_MS = 1500;
const WORKSPACE_STATE_STORAGE_KEY = "fronti.workspace.state.v1";

interface WorkspaceSnapshot {
  url: string;
  prompt: string;
  job: JobState | null;
  error: string | null;
  flowSpecResult: FlowSpecResponse | null;
  selectedTestIds: string[];
  runJob: JobState | null;
  runResult: RunTestsResult | null;
  runError: string | null;
  flowSpecError: string | null;
}

export default function WorkspacePage() {
  const [hasRestoredState, setHasRestoredState] = useState(false);
  const [url, setUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [job, setJob] = useState<JobState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGeneratingSpec, setIsGeneratingSpec] = useState(false);
  const [flowSpecResult, setFlowSpecResult] = useState<FlowSpecResponse | null>(null);
  const [selectedTestIds, setSelectedTestIds] = useState<Set<string>>(new Set());
  const [isRunningTests, setIsRunningTests] = useState(false);
  const [runJob, setRunJob] = useState<JobState | null>(null);
  const [runResult, setRunResult] = useState<RunTestsResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [flowSpecError, setFlowSpecError] = useState<string | null>(null);
  const [isCancelingRun, setIsCancelingRun] = useState(false);

  const scan = useMemo<ScanResult | null>(() => {
    if (!job?.result || typeof job.result !== "object") {
      return null;
    }
    const result = job.result as { scan?: ScanResult };
    return result.scan ?? null;
  }, [job]);
  const isScanInProgress = isSubmitting || job?.status === "running";
  const flowSpecCitationSummary = useMemo(() => {
    const citations = flowSpecResult?.citations ?? [];
    const webCitations = citations.filter((citation) => /^https?:\/\//i.test(citation));
    const docCitations = citations.filter((citation) => !/^https?:\/\//i.test(citation));
    return {
      webCitations,
      docCitations,
      usedWebFallback: webCitations.length > 0,
    };
  }, [flowSpecResult?.citations]);
  const flowSpecProgress = isGeneratingSpec ? 65 : flowSpecResult ? 100 : 0;
  const flowSpecStatus = isGeneratingSpec ? "running" : flowSpecResult ? "completed" : flowSpecError ? "failed" : "idle";
  const runProgress = runJob?.progress ?? (runResult ? 100 : 0);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(WORKSPACE_STATE_STORAGE_KEY);
      if (!raw) {
        setHasRestoredState(true);
        return;
      }

      const snapshot = JSON.parse(raw) as WorkspaceSnapshot;
      setUrl(snapshot.url ?? "");
      setPrompt(snapshot.prompt ?? "");
      setJob(snapshot.job ?? null);
      setError(snapshot.error ?? null);
      setFlowSpecResult(snapshot.flowSpecResult ?? null);
      setSelectedTestIds(new Set(snapshot.selectedTestIds ?? []));
      setRunJob(snapshot.runJob ?? null);
      setRunResult(snapshot.runResult ?? null);
      setRunError(snapshot.runError ?? null);
      setFlowSpecError(snapshot.flowSpecError ?? null);
    } catch {
      // Ignore invalid persisted state and continue with defaults.
    } finally {
      setHasRestoredState(true);
    }
  }, []);

  useEffect(() => {
    if (!hasRestoredState) {
      return;
    }
    const snapshot: WorkspaceSnapshot = {
      url,
      prompt,
      job,
      error,
      flowSpecResult,
      selectedTestIds: Array.from(selectedTestIds),
      runJob,
      runResult,
      runError,
      flowSpecError,
    };
    window.localStorage.setItem(WORKSPACE_STATE_STORAGE_KEY, JSON.stringify(snapshot));
  }, [
    hasRestoredState,
    url,
    prompt,
    job,
    error,
    flowSpecResult,
    selectedTestIds,
    runJob,
    runResult,
    runError,
    flowSpecError,
  ]);

  useEffect(() => {
    if (!hasRestoredState || !job) {
      return;
    }
    if (!["queued", "running"].includes(job.status) || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    void pollJobUntilDone(job.job_id).finally(() => setIsSubmitting(false));
  }, [hasRestoredState, job, isSubmitting]);

  useEffect(() => {
    if (!hasRestoredState || !runJob) {
      return;
    }
    if (!["queued", "running"].includes(runJob.status) || isRunningTests) {
      return;
    }

    setIsRunningTests(true);
    void pollRunJobUntilDone(runJob.job_id).finally(() => setIsRunningTests(false));
  }, [hasRestoredState, runJob, isRunningTests]);

  async function handleScan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    setJob(null);

    try {
      const created = await createScanJob({
        url,
        prompt: prompt || undefined,
        max_pages: 30,
        max_depth: 2,
      });

      await pollJobUntilDone(created.job_id);
    } catch (scanError) {
      const message = scanError instanceof Error ? scanError.message : "Scan failed.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function pollJobUntilDone(jobId: string) {
    let done = false;
    while (!done) {
      const current = await getJob(jobId);
      setJob(current);
      done = ["completed", "failed", "timeout", "canceled"].includes(current.status);
      if (!done) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    }
  }

  async function pollRunJobUntilDone(jobId: string) {
    let done = false;
    while (!done) {
      const current = await getJob(jobId);
      setRunJob(current);
      done = ["completed", "failed", "timeout", "canceled"].includes(current.status);
      if (!done) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
      if (done && current.status === "completed") {
        setRunResult(toRunTestsResult(current.result) ?? null);
      }
      if (done && current.status !== "completed" && current.error) {
        setRunError(`${current.error.code}: ${current.error.message}`);
      }
    }
  }

  async function handleGenerateFlowSpec() {
    if (!scan) {
      setFlowSpecError("Run scan first, then generate Flow Spec.");
      return;
    }
    setIsGeneratingSpec(true);
    setFlowSpecError(null);
    setFlowSpecResult(null);
    try {
      const result = await generateFlowSpec({
        url,
        prompt: prompt || undefined,
        scan,
      });
      setFlowSpecResult(result);
      setSelectedTestIds(new Set(result.tests.map((test) => test.id)));
      setRunResult(null);
      setRunJob(null);
      setRunError(null);
    } catch (specError) {
      const message = specError instanceof Error ? specError.message : "Failed to generate flow spec.";
      setFlowSpecError(message);
    } finally {
      setIsGeneratingSpec(false);
    }
  }

  async function handleRunSelected() {
    if (!flowSpecResult || selectedTestIds.size === 0) {
      setRunError("Select at least one test before running.");
      return;
    }
    setIsRunningTests(true);
    setRunError(null);
    setRunResult(null);
    setRunJob(null);
    try {
      const selectedTests = flowSpecResult.tests.filter((test) => selectedTestIds.has(test.id));
      const created = await createRunTestsJob({
        url: flowSpecResult.url || url,
        tests: selectedTests,
        batch_size: 4,
      });
      await pollRunJobUntilDone(created.job_id);
    } catch (testsError) {
      setRunError(testsError instanceof Error ? testsError.message : "Failed to run selected tests.");
    } finally {
      setIsRunningTests(false);
    }
  }

  async function handleRerunFailedOnly() {
    if (!flowSpecResult || !runResult) {
      return;
    }
    const failedIds = new Set(runResult.tests.filter((item) => item.status === "failed").map((item) => item.id));
    if (failedIds.size === 0) {
      return;
    }
    setSelectedTestIds(failedIds);
    setIsRunningTests(true);
    setRunError(null);
    setRunResult(null);
    setRunJob(null);
    try {
      const selectedTests = flowSpecResult.tests.filter((test) => failedIds.has(test.id));
      const created = await createRunTestsJob({
        url: flowSpecResult.url || url,
        tests: selectedTests,
        batch_size: 4,
      });
      await pollRunJobUntilDone(created.job_id);
    } catch (testsError) {
      setRunError(testsError instanceof Error ? testsError.message : "Failed to re-run failed tests.");
    } finally {
      setIsRunningTests(false);
    }
  }

  async function handleCancelRunTests() {
    if (!runJob || runJob.kind !== "run_tests") {
      return;
    }
    if (!["queued", "running"].includes(runJob.status)) {
      return;
    }
    setIsCancelingRun(true);
    setRunError(null);
    try {
      const canceled = await cancelJob(runJob.job_id);
      setRunJob(canceled);
    } catch (cancelError) {
      setRunError(cancelError instanceof Error ? cancelError.message : "Failed to cancel test run.");
    } finally {
      setIsCancelingRun(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Workspace</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The agent scans the target application, generates Flow Spec test suggestions, and runs Playwright-based
          frontend checks.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Submit a URL and Scan</CardTitle>
          <CardDescription>Submit a URL to run a scan job through the runner service.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="space-y-4" onSubmit={handleScan}>
            <Input
              aria-label="Target URL"
              placeholder="https://example.com"
              required
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
            <Textarea
              aria-label="Optional prompt"
              placeholder="Optional prompt for later flow generation..."
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting ? "Scanning..." : "Scan site"}
            </Button>
          </form>
          {job ? (
            <div className="space-y-3 rounded-md border border-border p-3">
              <p className="text-sm font-medium">Scan URL status</p>
              <p className="text-xs text-muted-foreground">
                Tracks URL scan execution and current progress while same-origin pages are discovered and summarized.
              </p>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">status: {job.status}</Badge>
                <span className="text-xs text-muted-foreground">progress: {job.progress}%</span>
              </div>
              <Progress value={job.progress} />
              {job.error ? (
                <p className="text-sm text-red-500">
                  {job.error.code}: {job.error.message}
                </p>
              ) : null}
            </div>
          ) : null}
          {error ? <p className="mt-3 text-sm text-red-500">{error}</p> : null}
        </CardContent>
      </Card>

      {scan ? (
        <Card>
          <CardHeader>
            <CardTitle>Scan URL Summary</CardTitle>
            <CardDescription>Shows what was discovered during URL scan.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <SummaryItem label="Pages found" value={scan.pages_found.toString()} />
              <SummaryItem label="Forms detected" value={scan.forms_detected.toString()} />
              <SummaryItem label="Auth walls" value={scan.auth_walls ? "Yes" : "No"} />
              <SummaryItem label="Top routes" value={scan.top_routes.length.toString()} />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium">Discovered routes</h3>
              <div className="flex flex-wrap gap-2">
                {scan.top_routes.map((route) => (
                  <Badge key={route} variant="outline">
                    {route}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Flow Spec Test Generation</CardTitle>
          <CardDescription>
            Generate suggested E2E flows using current scan context and retrieved Playwright knowledge.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button disabled={isGeneratingSpec || !scan} onClick={handleGenerateFlowSpec} type="button">
            {isGeneratingSpec ? "Generating Flow Spec Tests..." : "Generate Flow Spec Tests"}
          </Button>
          <div className="space-y-1">
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>status: {flowSpecStatus}</span>
              <span>progress: {flowSpecProgress}%</span>
            </div>
            <Progress value={flowSpecProgress} />
          </div>
          {flowSpecError ? <p className="text-sm text-red-500">{flowSpecError}</p> : null}

          {flowSpecResult ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Generated {flowSpecResult.tests.length} tests. Citations: {flowSpecResult.citations.length}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={flowSpecCitationSummary.usedWebFallback ? "secondary" : "outline"}>
                  {flowSpecCitationSummary.usedWebFallback
                    ? "Web fallback used (Tavily)"
                    : "Playwright docs only"}
                </Badge>
                <Badge variant="outline">Docs: {flowSpecCitationSummary.docCitations.length}</Badge>
                <Badge variant="outline">Web: {flowSpecCitationSummary.webCitations.length}</Badge>
              </div>
              <p className="text-sm font-medium">List of generated Flow Spec Test</p>
              {flowSpecResult.tests.map((test) => (
                <div key={test.id} className="rounded-md border border-border p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        disabled={isScanInProgress}
                        checked={selectedTestIds.has(test.id)}
                        onCheckedChange={(checked) => {
                          const next = new Set(selectedTestIds);
                          if (checked) {
                            next.add(test.id);
                          } else {
                            next.delete(test.id);
                          }
                          setSelectedTestIds(next);
                        }}
                      />
                      <p className="font-medium">{test.title}</p>
                    </div>
                    <Badge variant="secondary">
                      {test.risk} • {test.duration_sec}s
                    </Badge>
                  </div>
                  <p className="mb-2 text-sm text-muted-foreground">{test.why_suggested}</p>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {test.steps.slice(0, 3).map((step, index) => (
                      <li key={`${test.id}-step-${index}`}>{step}</li>
                    ))}
                  </ul>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={isScanInProgress || isRunningTests || selectedTestIds.size === 0}
                  onClick={handleRunSelected}
                  type="button"
                >
                  {isRunningTests ? "Running Tests..." : "Run Selected Tests"}
                </Button>
                <Button
                  disabled={isScanInProgress || isRunningTests || !runResult || runResult.failed === 0}
                  onClick={handleRerunFailedOnly}
                  type="button"
                  variant="outline"
                >
                  Re-run Failed Tests Only
                </Button>
                <Button
                  disabled={
                    !runJob ||
                    runJob.kind !== "run_tests" ||
                    !["queued", "running"].includes(runJob.status) ||
                    isCancelingRun
                  }
                  onClick={handleCancelRunTests}
                  type="button"
                  variant="outline"
                >
                  {isCancelingRun ? "Canceling..." : "Cancel Run Tests"}
                </Button>
                <Button
                  disabled={isScanInProgress || flowSpecResult.tests.length === 0}
                  onClick={() => setSelectedTestIds(new Set(flowSpecResult.tests.map((test) => test.id)))}
                  type="button"
                  variant="secondary"
                >
                  Select all
                </Button>
                <Button
                  disabled={isScanInProgress || flowSpecResult.tests.length === 0}
                  onClick={() => setSelectedTestIds(new Set())}
                  type="button"
                  variant="secondary"
                >
                  Clear
                </Button>
              </div>

              {runError ? <p className="text-sm text-red-500">{runError}</p> : null}

              {runJob || runResult ? (
                <div className="space-y-3 rounded-md border border-border p-3">
                  <h3 className="text-sm font-semibold">Flow Spec Test Results</h3>
                  <p className="text-xs text-muted-foreground">
                    Shows current run status, summary metrics, and per-test execution outcomes.
                  </p>
                  {runJob ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">status: {runJob.status}</Badge>
                      <span>test id: {runJob.job_id}</span>
                      <span>progress: {runProgress}%</span>
                    </div>
                  ) : null}
                  <Progress value={runProgress} />
                  {runResult ? (
                  <div className="space-y-3 rounded-md border border-border bg-card p-3">
                    <p className="text-sm font-medium">Run test summary</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <div className="rounded-md border border-border bg-background p-3">
                        <p className="text-xs text-muted-foreground">Passed</p>
                        <p className="mt-1 text-lg font-semibold text-green-500">{runResult.passed}</p>
                      </div>
                      <div className="rounded-md border border-border bg-background p-3">
                        <p className="text-xs text-muted-foreground">Failed</p>
                        <p className="mt-1 text-lg font-semibold text-red-500">{runResult.failed}</p>
                      </div>
                      <div className="rounded-md border border-border bg-background p-3">
                        <p className="text-xs text-muted-foreground">Duration</p>
                        <p className="mt-1 text-lg font-semibold text-foreground">
                          {Math.round(runResult.duration_ms / 1000)}s
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">Total tests: {runResult.total}</p>
                  </div>
                  ) : null}
                  {runResult ? runResult.tests.map((item) => (
                    <div
                      key={`run-${item.id}`}
                      className="rounded-md border border-border bg-card p-2 text-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span>{item.title}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant={item.status === "passed" ? "secondary" : "destructive"}>{item.status}</Badge>
                          {item.failure_category ? <Badge variant="outline">{item.failure_category}</Badge> : null}
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        test id: <span className="font-medium">{item.id}</span>
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        route: {item.route} • duration: {Math.max(1, Math.round(item.duration_ms / 1000))}s
                      </p>
                      {item.error ? <p className="mt-1 text-xs text-red-500">{item.error}</p> : null}
                      {item.technical_error ? (
                        <details className="mt-2 text-xs">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                            Show technical details
                          </summary>
                          <pre className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-background p-2 text-[11px] text-muted-foreground">
                            {item.technical_error}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                  )) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
