"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const toolStack = [
  {
    title: "1. LLM(s)",
    description:
      "OpenAI chat model is the reasoning engine behind Fronti. It generates Flow Spec test suggestions and also powers evaluation-time answering/scoring with stable, structured outputs.",
  },
  {
    title: "2. Agent orchestration framework",
    description:
      "LangGraph gives us a clear, auditable agent flow (agent -> tools -> finalize), so every step is explicit and predictable instead of hidden inside a black box.",
  },
  {
    title: "3. Tool(s)",
    description:
      "Fronti uses three focused tools: scan_site_context to summarize scanned app state, search_playwright_docs to ground decisions in indexed docs, and search_web_tavily as fallback only when internal context is not enough.",
  },
  {
    title: "4. Embedding model",
    description:
      "OpenAI embeddings create a shared semantic space for both document ingest and query retrieval, so matching stays consistent end to end.",
  },
  {
    title: "5. Vector Database",
    description:
      "Qdrant Cloud is our retrieval memory: it stores chunk vectors and source metadata so answers can be grounded, filtered, and cited.",
  },
  {
    title: "6. Monitoring tool",
    description:
      "For this prototype, observability is intentionally lightweight: job status and progress are shown in the UI during execution.",
  },
  {
    title: "7. Evaluation framework",
    description:
      "RAGAS is our quality gate for retrieval, measuring faithfulness, response relevance, context precision, and context recall on synthetic QA-style samples.",
  },
  {
    title: "8. User interface",
    description:
      "The UI stack (Next.js App Router, TypeScript, shadcn/ui, Tailwind) helps us ship fast while keeping the product clean, consistent, and enterprise-ready.",
  },
  {
    title: "9. Deployment tool",
    description:
      "Deployment is split by workload: Vercel serves frontend + API proxy, while a separate Python runner executes long scan/test/eval jobs safely in the background.",
  },
  {
    title: "10. Other components",
    description:
      "Playwright drives page scan and E2E execution, while FastAPI exposes async job APIs and coordinates workers behind the scenes.",
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">About Fronti</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Why, Who, What</CardTitle>
          <CardDescription>Problem, audience, and value in one place.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="space-y-1">
            <p className="font-medium text-foreground">Why Fronti?</p>
            <p className="text-muted-foreground">
              Frontend regressions are often found too late, when releases are already at risk. Manual QA planning is
              slow, brittle, and hard to keep aligned with fast product changes.
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-medium text-foreground">Who is it for?</p>
            <p className="text-muted-foreground">
              Frontend and QA engineers who need fast, trustworthy feedback on critical user flows before release.
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-medium text-foreground">What is Fronti?</p>
            <p className="text-muted-foreground">
              Fronti is an AI QA Copilot that scans a target app, generates Flow Spec tests, runs Playwright checks,
              and returns clear pass/fail outcomes with actionable failure context.
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-medium text-foreground">What does it improve?</p>
            <p className="text-muted-foreground">
              It reduces manual QA effort, improves coverage visibility, and helps teams ship with lower regression
              risk using a repeatable, evidence-based workflow.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Proposed Solution</CardTitle>
          <CardDescription>How the system works end-to-end for the user.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Fronti-AI QA Copilot is a web application that combines automated page scanning, RAG-grounded Flow Spec
            generation, Playwright test execution, and retrieval evaluation.
          </p>
          <p>
            The user provides a target URL and optional prompt. The system scans same-origin pages, proposes runnable
            E2E flows, enables selective execution, and returns pass/fail outcomes with clear error summaries.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Architecture Diagram</CardTitle>
          <CardDescription>High-level runtime flow and component connections.</CardDescription>
        </CardHeader>
        <CardContent>
          <img
            alt="Fronti architecture diagram"
            className="w-full rounded-md border border-border"
            src="/diagrams/fronti-architecture-excalidraw.svg"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tool Stack</CardTitle>
          <CardDescription>Core components and why each tooling choice is used.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {toolStack.map((item) => (
            <div key={item.title} className="rounded-md border border-border bg-card p-3 text-sm">
              <p className="font-medium text-foreground">{item.title}</p>
              <p className="text-muted-foreground">{item.description}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>E2E flow</CardTitle>
          <CardDescription>End-to-end flow in the app.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>1. Scan target URL and discover relevant pages.</p>
          <p>2. Retrieve Playwright context from Qdrant-backed RAG.</p>
          <p>3. Generate Flow Spec test suggestions with citations.</p>
          <p>4. Execute selected Playwright tests via runner jobs.</p>
          <p>5. Evaluate retriever quality with RAGAS metrics.</p>
        </CardContent>
      </Card>

    </div>
  );
}
