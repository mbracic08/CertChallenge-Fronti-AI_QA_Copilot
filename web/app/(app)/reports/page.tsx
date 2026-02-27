"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { listJobs, toRunTestsResult } from "@/lib/api-client";
import type { JobState, RunTestsResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  FileBarChart,
  Download,
  AlertTriangle,
  AlertCircle,
  Info,
  ShieldAlert,
  CheckCircle2,
  Loader2,
  XCircle,
} from "lucide-react";

type Severity = "critical" | "major" | "minor" | "info";

type ReportStatus = "ready" | "generating" | "failed";

interface ReportView {
  id: string;
  status: ReportStatus;
  generatedAt: string;
  totalIssues: number;
  criticalIssues: number;
  coveragePercent: number;
  progress: number;
  url: string;
}

interface QAIssue {
  id: string;
  title: string;
  severity: Severity;
  status: "open" | "resolved" | "ignored";
  page: string;
  selector: string;
  description: string;
  suggestion: string;
}

const severityConfig: Record<
  Severity,
  { label: string; className: string; icon: React.ElementType }
> = {
  critical: {
    label: "Critical",
    className: "bg-destructive/10 text-destructive border-destructive/20",
    icon: ShieldAlert,
  },
  major: {
    label: "Major",
    className: "bg-warning/10 text-warning border-warning/20",
    icon: AlertTriangle,
  },
  minor: {
    label: "Minor",
    className: "bg-muted text-muted-foreground border-border",
    icon: AlertCircle,
  },
  info: {
    label: "Info",
    className: "bg-primary/10 text-primary border-primary/20",
    icon: Info,
  },
};

const reportStatusConfig: Record<
  ReportStatus,
  { label: string; className: string; icon: React.ElementType }
> = {
  ready: {
    label: "Ready",
    className: "bg-success/10 text-success border-success/20",
    icon: CheckCircle2,
  },
  generating: {
    label: "Generating",
    className: "bg-primary/10 text-primary border-primary/20",
    icon: Loader2,
  },
  failed: {
    label: "Failed",
    className: "bg-destructive/10 text-destructive border-destructive/20",
    icon: XCircle,
  },
};

function ReportCard({
  report,
  index,
  onExport,
}: {
  report: ReportView;
  index: number;
  onExport: (report: ReportView) => void;
}) {
  const config = reportStatusConfig[report.status];
  const StatusIcon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
    >
      <Card className="border-border bg-card">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-medium text-foreground">Test Report</h3>
              <p className="mt-1 text-xs text-muted-foreground break-all">Test id: {report.id}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Date: {new Date(report.generatedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>
            <Badge
              variant="outline"
              className={cn("shrink-0 gap-1 text-xs", config.className)}
            >
              <StatusIcon
                className={cn(
                  "h-3 w-3",
                  report.status === "generating" && "animate-spin"
                )}
              />
              {config.label}
            </Badge>
          </div>

          {report.status === "ready" && (
            <>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div>
                  <p className="text-lg font-bold text-foreground">{report.totalIssues}</p>
                  <p className="text-xs text-muted-foreground">Issues</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-destructive">
                    {report.criticalIssues}
                  </p>
                  <p className="text-xs text-muted-foreground">Critical</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-foreground">
                    {report.coveragePercent}%
                  </p>
                  <p className="text-xs text-muted-foreground">Coverage</p>
                </div>
              </div>

              <div className="mt-3">
                <Progress
                  value={report.coveragePercent}
                  className="h-1.5 bg-muted [&>div]:bg-primary"
                />
              </div>

              <div className="mt-3 flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => onExport(report)}
                >
                  <Download className="h-3 w-3" />
                  Export
                </Button>
              </div>
            </>
          )}

          {report.status === "generating" && (
            <div className="mt-4">
              <Progress value={report.progress} className="h-1.5 bg-muted [&>div]:bg-primary" />
              <p className="mt-2 text-xs text-muted-foreground">
                Generating report...
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function IssueItem({ issue }: { issue: QAIssue }) {
  const config = severityConfig[issue.severity];
  const SeverityIcon = config.icon;

  const issueStatusConfig = {
    open: "bg-warning/10 text-warning border-warning/20",
    resolved: "bg-success/10 text-success border-success/20",
    ignored: "bg-muted text-muted-foreground border-border",
  } as const;

  return (
    <AccordionItem value={issue.id} className="border-border">
      <AccordionTrigger className="px-4 py-3 text-sm hover:no-underline hover:bg-accent/50 [&>svg]:text-muted-foreground">
        <div className="flex flex-1 items-center gap-3 text-left">
          <SeverityIcon className={cn("h-4 w-4 shrink-0", config.className.split(" ")[1])} />
          <span className="flex-1 font-medium text-foreground truncate">{issue.title}</span>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn("text-xs", config.className)}
            >
              {config.label}
            </Badge>
            <Badge
              variant="outline"
              className={cn("text-xs", issueStatusConfig[issue.status])}
            >
              {issue.status}
            </Badge>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-4">
        <div className="flex flex-col gap-3 rounded-lg bg-muted/50 p-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Page:</span>
            <code className="text-xs font-mono text-foreground">{issue.page}</code>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Selector:</span>
            <code className="text-xs font-mono text-foreground">{issue.selector}</code>
          </div>
          <p className="text-sm text-foreground">{issue.description}</p>
          <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
            <p className="text-xs font-medium text-primary">AI Suggestion</p>
            <p className="mt-1 text-sm text-foreground">{issue.suggestion}</p>
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState("reports");
  const [jobs, setJobs] = useState<JobState[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetchRuns = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await listJobs({ kind: "run_tests", limit: 200 });
        if (mounted) {
          setJobs(data);
        }
      } catch (fetchError) {
        if (mounted) {
          const message = fetchError instanceof Error ? fetchError.message : "Failed to load reports.";
          setError(message);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    void fetchRuns();
    const poll = window.setInterval(() => {
      void fetchRuns();
    }, 5000);

    return () => {
      mounted = false;
      window.clearInterval(poll);
    };
  }, []);

  const reports = useMemo<ReportView[]>(() => {
    return jobs.map((job) => {
      const result = toRunTestsResult(job.result);
      const status: ReportStatus =
        job.status === "completed"
          ? "ready"
          : job.status === "running" || job.status === "queued"
            ? "generating"
            : "failed";
      const generatedAt = job.finished_at ?? job.created_at;
      const failed = result?.failed ?? 0;
      const total = result?.total ?? 0;
      const passed = result?.passed ?? 0;
      const criticalIssues =
        result?.tests.filter(
          (test) =>
            test.status === "failed" &&
            (test.failure_category === "runtime_error" || test.failure_category === "http_error"),
        ).length ?? 0;
      const coveragePercent = total > 0 ? Math.round((passed / total) * 100) : 0;

      return {
        id: job.job_id,
        status,
        generatedAt,
        totalIssues: failed,
        criticalIssues,
        coveragePercent,
        progress: Math.max(5, job.progress),
        url: result?.url ?? "unknown",
      };
    });
  }, [jobs]);

  const issues = useMemo<QAIssue[]>(() => {
    const rows: QAIssue[] = [];

    for (const job of jobs) {
      const result: RunTestsResult | null = toRunTestsResult(job.result);
      if (!result) {
        continue;
      }
      for (const test of result.tests) {
        if (test.status !== "failed") {
          continue;
        }

        const severity: Severity =
          test.failure_category === "runtime_error" || test.failure_category === "http_error"
            ? "critical"
            : test.failure_category === "timeout" || test.failure_category === "navigation_error"
              ? "major"
              : "minor";

        rows.push({
          id: `${job.job_id}-${test.id}`,
          title: test.title,
          severity,
          status: "open",
          page: test.route,
          selector: "N/A",
          description: test.error ?? "Test failed without explicit error message.",
          suggestion:
            "Review locator stability, waiting strategy, and backend response assumptions for this flow.",
        });
      }
    }

    return rows;
  }, [jobs]);

  function exportReport(report: ReportView) {
    const relatedJob = jobs.find((job) => job.job_id === report.id);
    const result = relatedJob ? toRunTestsResult(relatedJob.result) : null;
    const payload = {
      report,
      run: result,
      generated_at: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `fronti-report-${report.id.slice(0, 8)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          View generated QA reports and detailed issue findings.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-muted">
          <TabsTrigger value="reports" className="gap-1.5 data-[state=active]:bg-card data-[state=active]:text-foreground">
            <FileBarChart className="h-3.5 w-3.5" />
            Reports
          </TabsTrigger>
          <TabsTrigger value="issues" className="gap-1.5 data-[state=active]:bg-card data-[state=active]:text-foreground">
            <AlertTriangle className="h-3.5 w-3.5" />
            Issues ({issues.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="reports" className="mt-4">
          {error ? (
            <Card className="border-border bg-card">
              <CardContent className="py-8 text-sm text-destructive">{error}</CardContent>
            </Card>
          ) : isLoading && reports.length === 0 ? (
            <Card className="border-border bg-card">
              <CardContent className="py-8 text-sm text-muted-foreground">Loading reports...</CardContent>
            </Card>
          ) : reports.length === 0 ? (
            <Card className="border-border bg-card">
              <CardContent className="py-8 text-sm text-muted-foreground">
                No run reports available yet. Execute tests from Workspace first.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {reports.map((report, i) => (
                <ReportCard key={report.id} report={report} index={i} onExport={exportReport} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="issues" className="mt-4">
          <Card className="border-border bg-card">
            {issues.length === 0 ? (
              <CardContent className="py-8 text-sm text-muted-foreground">
                No failed test issues found yet.
              </CardContent>
            ) : (
              <Accordion type="multiple">
                {issues.map((issue) => (
                  <IssueItem key={issue.id} issue={issue} />
                ))}
              </Accordion>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
