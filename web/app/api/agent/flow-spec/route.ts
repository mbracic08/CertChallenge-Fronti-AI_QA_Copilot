import { NextResponse } from "next/server";

const RUNNER_BASE_URL = process.env.RUNNER_BASE_URL ?? "http://localhost:8000";
const RUNNER_API_KEY = process.env.RUNNER_API_KEY;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const response = await fetch(`${RUNNER_BASE_URL}/agent/flow-spec`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(RUNNER_API_KEY ? { "x-runner-key": RUNNER_API_KEY } : {}),
      },
      body: JSON.stringify(body),
    });

    const raw = await response.text();
    let data: unknown = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = {
        error: {
          code: "RUNNER_RESPONSE_PARSE_FAILED",
          message: raw || "Runner returned a non-JSON response.",
        },
      };
    }

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "RUNNER_UNREACHABLE",
          message: `Failed to reach runner at ${RUNNER_BASE_URL}.`,
          detail: error instanceof Error ? error.message : String(error),
        },
      },
      { status: 502 },
    );
  }
}
