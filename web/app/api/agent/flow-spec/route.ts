import { NextResponse } from "next/server";

const RUNNER_BASE_URL = process.env.RUNNER_BASE_URL ?? "http://localhost:8000";
const RUNNER_API_KEY = process.env.RUNNER_API_KEY;

export async function POST(request: Request) {
  const body = await request.json();
  const response = await fetch(`${RUNNER_BASE_URL}/agent/flow-spec`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(RUNNER_API_KEY ? { "x-runner-key": RUNNER_API_KEY } : {}),
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
