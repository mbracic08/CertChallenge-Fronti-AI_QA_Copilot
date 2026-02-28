# Fronti-AI QA Copilot - Certification Challenge Writeup
Loom video: https://www.loom.com/share/cb67120fcdaf41bb85ab68729fda6f4d

---
## Task 1: Defining your Problem, Audience, and Scope
### 1. Write a succinct 1-sentence description of the problem
Frontend regressions and broken frontend-backend integrations are often detected too late, causing delayed releases, production incidents, and excessive manual QA effort.

### 2. Write 1-2 paragraphs on why this is a problem for your specific user
Frontend and QA engineers working on fast-moving web applications need immediate, trustworthy feedback on whether critical user flows still work after changes. Because frontend behavior depends on backend APIs, auth/session state, and timing-sensitive UI interactions, small changes can break core flows without obvious warnings. Teams then discover issues late in the cycle or post-release, leading to emergency fixes, unstable releases, and context switching. Maintaining E2E coverage manually also does not scale. Test planning, writing, and updates are labor-intensive, tests drift from product behavior, and brittle selectors increase maintenance cost. This creates a persistent gap between documented requirements, implemented functionality, and real tested coverage.

### 3. Create a list of questions or input-output pairs that you can use to evaluate your application
1. Input: User submits target URL and clicks Scan  
   Output: App returns discovered routes, pages found, forms detected, auth-wall signal, and scan summary.
2. Input: User clicks Generate Flow Spec after a completed scan  
   Output: App returns structured E2E test suggestions (title, risk, steps, rationale) with citations.
3. Input: User selects generated tests and clicks Run Selected  
   Output: App executes tests in batches and returns run summary (passed/failed/total/duration) with per-test results.
4. Input: User clicks Re-run Failed Only after a mixed run  
   Output: App runs only previously failed tests and returns updated pass/fail outcomes.
5. Input: User opens Runs page after execution  
   Output: App shows historical run jobs with status, timestamps, progress, and details.
6. Input: User opens Reports page after execution  
   Output: App shows report cards and issue breakdown derived from run results, with exportable structured JSON.
7. Input: User clicks Ingest Playwright Docs in Evaluation  
   Output: App ingests Playwright docs into Qdrant and confirms chunk count + status.
8. Input: User runs Baseline / Advanced / Compare evaluation  
   Output: App returns faithfulness, context_precision, context_recall, and comparison deltas with conclusion.
---
## Task 2: Propose a Solution
### 1. Propose a Solution 1-2 paragraphs
Fronti-AI QA Copilot is a web application that combines (a) automated page scanning, (b) RAG-grounded Flow Spec generation, (c) Playwright test execution, and (d) retrieval evaluation. The user provides a target URL and optional prompt. The system scans same-origin pages, proposes runnable E2E flows, allows selective execution, and returns pass/fail outcomes with error summaries. 

For this project, I will use a tool stack that supports reliable retrieval, controllable agent behavior, and practical QA execution.
LangGraph will orchestrate the agent flow in explicit steps (agent -> tools -> finalize) so tool usage is traceable and deterministic.
OpenAI chat models will generate Flow Spec test suggestions and support evaluation-time scoring, while OpenAI embeddings will map Playwright documentation into semantic vectors. Qdrant Cloud will store those vectors and metadata for grounded retrieval and citations. Playwright will be used both for page scanning and executable E2E checks against target URLs. Tavily will be enabled as fallback-only web search when internal documentation context is insufficient. RAGAS will evaluate retrieval quality across baseline and advanced retrievers using faithfulness, context precision, and context recall. FastAPI with async workers will run long jobs (scan/run/eval), and the user interface will be built in Next.js App Router + TypeScript + shadcn/ui + Tailwind. Deployment plan: the frontend and API proxy are hosted on Vercel, while a separate Python runner service handles long-running scan, test, and evaluation jobs.

### 2. Create an infrastructure diagram of your stack showing how everything fits together. Write one sentence on why you made each tooling choice.
Infrastructure diagram
![Fronti architecture diagram](../web/public/diagrams/fronti-architecture-excalidraw.png)

Tooling choices:
1. LLM(s): OpenAI chat model generates agent outputs for Flow Spec Test suggestions and also supports evaluation-time answer generation and scoring because it provides stable API behavior and reliable instruction following.
2. Agent orchestration framework: LangGraph orchestrates the agent flow as agent to tools to finalize, which keeps state transitions explicit and predictable.
3. Tool(s): The agent uses three tools: scan_site_context to use scan output from the target URL, search_playwright_docs to retrieve relevant context from Qdrant, and search_web_tavily as fallback web search when Playwright docs context is insufficient.
4. Embedding model: OpenAI embeddings are used to keep semantic retrieval consistent across both document ingest and query-time retrieval.
5. Vector Database: Qdrant Cloud stores vectors and metadata such as source and chunk_id to support filtered retrieval and citations.
6. Monitoring tool: This prototype does not include a dedicated monitoring stack, so runtime visibility is handled through job status and progress in the UI.
7. Evaluation framework: RAGAS evaluates retrieval quality using faithfulness, context_precision, and context_recall on synthetic QA-style samples.
8. User interface: The user interface is built with Next.js App Router, TypeScript, shadcn/ui, and Tailwind to provide fast iteration and a clean internal-tool experience.
9. Deployment tool: Deployment is split so Vercel serves the frontend and API proxy, while a separate Python runner service handles long-running scan, test, and evaluation jobs.
10. Other components: Playwright is used for page scan and E2E execution, and FastAPI exposes asynchronous job APIs and worker orchestration.

### 3. What are the RAG and agent components of your project, exactly?
- RAG components:
  - Corpus: curated Playwright docs in runner/data/playwright-docs/ (markdown from official repo subset).
  - Ingest pipeline: load markdown -> markdown-aware chunking -> embed with OpenAI -> upsert to Qdrant collection.
  - Retrieval API: retrieve_context(query, top_k) returns retrieved chunks (source, text, score) for grounding.
  - Baseline retriever: dense vector similarity search on Qdrant.
  - Advanced retriever: dense + BM25 ensemble retrieval, then contextual compression (EmbeddingsFilter), then Cohere rerank.
  - Evaluation pipeline: synthetic dataset generation + RAGAS scoring for baseline/advanced/compare jobs.
- Agent components:
  - scan_site_context tool: summarizes scan artifacts (pages_found, forms_detected, auth_walls, top_routes).
  - search_playwright_docs tool: fetches relevant chunks from Qdrant-backed Playwright corpus.
  - search_web_tavily tool: fallback-only external search for missing/outdated context.
  - agent node: LLM-with-tools step that decides tool calls and drafts Flow Spec tests.
  - tools node: executes requested tools and appends tool messages to graph state.
  - finalize node: extracts/normalizes output into FlowSpecResponse with tests and citations.
---
## Task 3: Dealing with the Data
### 1. Describe all of your data sources and external APIs, and describe what you’ll use them for.
The data source is a curated subset of official Playwright documentation stored locally in runner/data/playwright-docs/ and indexed into Qdrant.
External APIs:
OpenAI API is used for embeddings, agent generation, and evaluation-time generation and scoring, while Tavily API is used only as fallback web search when internal Playwright-document context is insufficient.
Role in solution:
In the overall solution, Playwright docs are the primary grounded knowledge source for Flow Spec generation and retrieval evaluation, OpenAI provides model inference for generation and evaluation tasks, and Tavily remains a controlled fallback rather than the default retrieval path.
Interaction flow:
1. User provides URL and starts scan.
2. Agent retrieves context from Qdrant-indexed Playwright docs.
3. Agent generates Flow Spec tests from scan context + retrieved docs.
4. Tavily is called only if docs retrieval is weak/insufficient.
5. User runs tests; evaluation jobs reuse the same corpus/retrievers and score with RAGAS.

### 2. Describe the default chunking strategy that you will use.  Why did you make this decision?
Default chunking is markdown-aware chunking with MarkdownTextSplitter, using chunk_size = 1000 and chunk_overlap = 180.
Documents are loaded from runner/data/playwright-docs/**/*.md (excluding README.md), then split by markdown structure so headings and technical sections remain coherent.  
Each chunk gets a stable chunk_id in metadata (derived from source + index + content prefix) to support deduplication, traceability, and citations.
This chunking strategy was chosen because markdown-aware splitting preserves Playwright documentation semantics better than plain character splitting, the 1000/180 configuration provides a practical balance between retrieval precision and context completeness, and chunk overlap reduces boundary loss when definitions or examples continue across adjacent sections.
---
## Task 4: Build End-to-End Prototype
### 1. Build an end-to-end prototype and deploy to local host with a front end (Vercel deployment not required).
The end-to-end prototype includes same-origin URL page scanning with configurable depth and page limits, Flow Spec generation through an agent with RAG context, selective Playwright test execution through async runner jobs, and re-run failed-only behavior. It also includes run history in /runs, a /reports view generated from run outcomes, JSON report export, and an evaluation panel with Playwright-doc ingestion, retrieval testing, and baseline/advanced/compare RAGAS evaluation modes. The default implementation is fully runnable on localhost: the Next.js frontend runs locally and proxies API calls to the local FastAPI runner service, which executes scan/test/eval jobs and retrieves context from Qdrant. For optional cloud deployment after local validation, the frontend/API proxy can be hosted on Vercel, while a separate Python runner service on Render can be hosted independently for long-running workloads.
Vercel link: https://cert-challenge-fronti-ai-qa-copilot.vercel.app/workspace
---
## Task 5: Evals
### 1. Assess your pipeline using the RAGAS framework including key metrics faithfulness, response relevance, context precision, and context recall. Provide a table of your output results.
The synthetic test set is generated from the same Playwright documentation corpus, and the baseline retriever uses dense vector retrieval only.
### Baseline Results
Configuration: sample_size=12, top_k=5, fetch_k=20.

| Metric | Baseline 
|---|---
| faithfulness | 0.8028 
| response_relevance | 0.8237 
| context_precision | 0.7491 
| context_recall | 0.7583 

Note: response_relevance was added to the evaluation pipeline after the demo video was recorded, so this metric is reflected in the written results but not in the video UI.

### 2. What conclusions can you draw about the performance and effectiveness of your pipeline with this information?
Baseline dense retrieval provides a solid and reliable starting point: response relevance is strong (0.8237), while faithfulness (0.8028) is also good for documentation-grounded QA. Context precision (0.7491) and context recall (0.7583) indicate that retrieval quality is adequate but still has room to improve, which justifies testing advanced retrieval strategies.
---
## Task 6: Improving Your Prototype
### 1. Choose an advanced retrieval technique that you believe will improve your application’s ability to retrieve the most appropriate context. Write 1-2 sentences on why you believe it will be useful for your use case.
The advanced technique uses a contextual compression retriever with a BM25 stage followed by Cohere reranking, where dense retrieval captures semantic intent, BM25 improves lexical matching for strict technical terms, and reranking improves the ordering of candidate chunks before final scoring.

### 2. Implement the advanced retrieval technique on your application.
Advanced retrieval is implemented as a multi-stage pipeline that first combines dense Qdrant similarity results with BM25 lexical results through an ensemble retriever, then applies contextual compression with an embeddings-based filter, deduplicates candidates by chunk identity and source, and finally applies Cohere reranking when available to produce the final ranked context set.

### 3. How does the performance compare to your original RAG application? Test the new retrieval pipeline using the RAGAS frameworks to quantify any improvements. Provide results in a table.
Configuration used: sample_size=12, top_k=5, fetch_k=20.
![Performance comparison (sample_size=12, top_k=5, fetch_k=20)](web/public/diagrams/performance-comparison.png)

| Metric | Baseline | Advanced | Delta |
|---|---:|---:|---:|
| faithfulness | 0.8028 | 0.9583 | +0.1555 |
| response_relevance | 0.8237 | 0.8023 | -0.0214 |
| context_precision | 0.7491 | 0.8375 | +0.0884 |
| context_recall | 0.7583 | 0.8241 | +0.0658 |

Short conclusion:  
In this specific run (sample_size=12, top_k=5, fetch_k=20), the advanced retriever outperformed baseline on three of four metrics (faithfulness, context precision, and context recall), with a small drop in response relevance.  
However, this does not yet prove consistent superiority: in earlier runs, advanced retrieval was often close to baseline or worse.  
Therefore, baseline dense retrieval remains the most stable default, while the advanced pipeline is kept for further tuning and repeated validation across configurations.
---
## Task 7: Next Steps
### 1. Do you plan to keep your RAG implementation via Dense Vector Retrieval for Demo Day? Why or why not?
I currently plan to keep Dense Vector Retrieval as the primary strategy for Demo Day because it has been more stable so far. In parallel, I will continue tuning the advanced retriever parameters and running additional evaluations to see whether we can achieve stable, consistent results that reliably outperform the baseline.
---
