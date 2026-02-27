"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getJob, listJobs, toRunTestsResult } from "@/lib/api-client";
import type { JobState, JobStatus, RunTestsResult } from "@/lib/types";
import { CheckCircle2, Clock, Filter, Loader2, RotateCcw, Search, XCircle } from "lucide-react";

const statusConfig: Record<
  JobStatus,
  { label: string; className: string; icon: React.ElementType }
> = {
  completed: {
    label: "Completed",
    className: "bg-success/10 text-success border-success/20",
    icon: CheckCircle2,
  },
  failed: {
    label: "Failed",
    className: "bg-destructive/10 text-destructive border-destructive/20",
    icon: XCircle,
  },
  running: {
    label: "Running",
    className: "bg-primary/10 text-primary border-primary/20",
    icon: Loader2,
  },
  queued: {
    label: "Queued",
    className: "bg-muted text-muted-foreground border-border",
    icon: Clock,
  },
  timeout: {
    label: "Timeout",
    className: "bg-amber-500/10 text-amber-300 border-amber-500/20",
    icon: Clock,
  },
  canceled: {
    label: "Canceled",
    className: "bg-destructive/10 text-destructive border-destructive/20",
    icon: XCircle,
  },
};

const STATUS_FILTERS: { label: string; value: JobStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Completed", value: "completed" },
  { label: "Failed", value: "failed" },
  { label: "Running", value: "running" },
  { label: "Queued", value: "queued" },
  { label: "Timeout", value: "timeout" },
  { label: "Canceled", value: "canceled" },
];

function formatDuration(durationMs: number | null): string {
  if (!durationMs || durationMs <= 0) {
    return "—";
  }
  const totalSec = Math.round(durationMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}

function formatDate(timestamp: string): string {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return timestamp;
  }
  return value.toLocaleString();
}

function getPassRate(result: RunTestsResult | null): string {
  if (!result || result.total === 0) {
    return "—";
  }
  return `${Math.round((result.passed / result.total) * 100)}%`;
}

export default function RunsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<JobStatus | "all">("all");
  const [jobs, setJobs] = useState<JobState[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<JobState | null>(null);

  const fetchRuns = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await listJobs({ kind: "run_tests", limit: 200 });
      setJobs(data);
      if (selectedJob) {
        const updated = data.find((job) => job.job_id === selectedJob.job_id);
        if (updated) {
          setSelectedJob(updated);
        }
      }
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : "Failed to load runs.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchRuns();
    const poll = window.setInterval(() => {
      void fetchRuns();
    }, 4000);
    return () => window.clearInterval(poll);
  }, []);

  const filteredRuns = useMemo(() => {
    return jobs.filter((job) => {
      const result = toRunTestsResult(job.result);
      const url = result?.url ?? "";
      const matchesSearch =
        job.job_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        url.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === "all" || job.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [jobs, searchQuery, statusFilter]);

  const openDetails = async (job: JobState) => {
    setSelectedJob(job);
    if (job.status === "running" || job.status === "queued") {
      try {
        const fresh = await getJob(job.job_id);
        setSelectedJob(fresh);
      } catch {
        // Keep last known state if refresh fails.
      }
    }
  };

  const handleReset = () => {
    setSearchQuery("");
    setStatusFilter("all");
  };

  const selectedResult = selectedJob ? toRunTestsResult(selectedJob.result) : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Test Runs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          View run history from executed Flow Spec test jobs.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by job id or URL..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-[320px] border-border bg-card pl-9 text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 border-border text-muted-foreground">
                <Filter className="h-3.5 w-3.5" />
                {statusFilter === "all" ? "Status" : statusConfig[statusFilter].label}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="border-border bg-popover text-popover-foreground">
              {STATUS_FILTERS.map((filter) => (
                <DropdownMenuItem
                  key={filter.value}
                  onClick={() => setStatusFilter(filter.value)}
                  className={cn("text-sm", statusFilter === filter.value && "font-medium text-primary")}
                >
                  {filter.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {(searchQuery || statusFilter !== "all") && (
            <Button variant="ghost" size="sm" onClick={handleReset} className="gap-1.5 text-xs text-muted-foreground">
              <RotateCcw className="h-3 w-3" />
              Reset
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={fetchRuns} disabled={isLoading}>
            Refresh
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {filteredRuns.length} of {jobs.length} runs
        </p>
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.24 }}>
        <Card className="border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-xs font-medium text-muted-foreground">Test id</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground">Status</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground">URL</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground">Created</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground">Duration</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground text-right">Passed</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground text-right">Failed</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground text-right">Pass Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {error ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center text-sm text-destructive">
                    {error}
                  </TableCell>
                </TableRow>
              ) : isLoading && jobs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                    Loading run history...
                  </TableCell>
                </TableRow>
              ) : filteredRuns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                    No runs match your filters.
                  </TableCell>
                </TableRow>
              ) : (
                filteredRuns.map((job) => {
                  const config = statusConfig[job.status];
                  const StatusIcon = config.icon;
                  const result = toRunTestsResult(job.result);
                  return (
                    <TableRow
                      key={job.job_id}
                      className="cursor-pointer border-border transition-colors hover:bg-accent/50"
                      onClick={() => void openDetails(job)}
                    >
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {job.job_id.slice(0, 8)}...
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("gap-1 text-xs font-medium", config.className)}>
                          <StatusIcon className={cn("h-3 w-3", job.status === "running" && "animate-spin")} />
                          {config.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[360px] truncate text-sm text-foreground">
                        {result?.url ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(job.created_at)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDuration(result?.duration_ms ?? null)}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium text-success">
                        {typeof result?.passed === "number" ? result.passed : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium text-destructive">
                        {typeof result?.failed === "number" ? result.failed : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium text-foreground">
                        {getPassRate(result)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Card>
      </motion.div>

      {selectedJob && (
        <Card className="border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">Selected run</p>
              <p className="text-sm text-muted-foreground">
                Test id: <span className="font-medium text-foreground break-all">{selectedJob.job_id}</span>
              </p>
            </div>
            <Badge variant="outline" className={cn("text-xs", statusConfig[selectedJob.status].className)}>
              {statusConfig[selectedJob.status].label}
            </Badge>
          </div>

          {selectedResult ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-md border border-border bg-background p-3">
                <p className="text-xs text-muted-foreground">URL tested</p>
                <p className="mt-1 text-sm font-medium text-foreground break-all">{selectedResult.url}</p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="rounded-md border border-border bg-background p-3">
                  <p className="text-xs text-muted-foreground">Passed</p>
                  <p className="mt-1 text-lg font-semibold text-success">{selectedResult.passed}</p>
                </div>
                <div className="rounded-md border border-border bg-background p-3">
                  <p className="text-xs text-muted-foreground">Failed</p>
                  <p className="mt-1 text-lg font-semibold text-destructive">{selectedResult.failed}</p>
                </div>
                <div className="rounded-md border border-border bg-background p-3">
                  <p className="text-xs text-muted-foreground">Duration</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">{formatDuration(selectedResult.duration_ms)}</p>
                </div>
              </div>
              <div className="space-y-2">
                {selectedResult.tests.map((test) => (
                  <div key={test.id} className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{test.title}</p>
                      <p className="text-xs text-muted-foreground">
                        route: {test.route} • duration: {formatDuration(test.duration_ms)}
                      </p>
                      {test.error ? (
                        <p className="mt-1 text-xs text-destructive">{test.error}</p>
                      ) : null}
                    </div>
                    <Badge variant={test.status === "passed" ? "secondary" : "destructive"}>{test.status}</Badge>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">No structured test result for this run yet.</p>
          )}
        </Card>
      )}
    </div>
  );
}
