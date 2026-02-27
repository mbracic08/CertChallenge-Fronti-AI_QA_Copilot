import { NextResponse } from "next/server";

const RUNNER_BASE_URL = process.env.RUNNER_BASE_URL ?? "http://localhost:8000";
const RUNNER_API_KEY = process.env.RUNNER_API_KEY;

export async function POST(request: Request) {
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "true";
  const response = await fetch(`${RUNNER_BASE_URL}/rag/ingest?force=${force ? "true" : "false"}`, {
    method: "POST",
    headers: {
      ...(RUNNER_API_KEY ? { "x-runner-key": RUNNER_API_KEY } : {}),
    },
  });

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
