import { NextResponse } from "next/server";

const RUNNER_BASE_URL =
  process.env.RUNNER_BASE_URL ??
  (process.env.NODE_ENV === "development" ? "http://localhost:8000" : "");
const RUNNER_API_KEY = process.env.RUNNER_API_KEY;

export async function POST(request: Request) {
  if (!RUNNER_BASE_URL) {
    return NextResponse.json(
      {
        error: {
          code: "RUNNER_CONFIG_MISSING",
          message: "RUNNER_BASE_URL is not set for this environment.",
        },
      },
      { status: 500 },
    );
  }

  try {
    const body = await request.json();
    const response = await fetch(`${RUNNER_BASE_URL}/jobs`, {
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

export async function GET(request: Request) {
  if (!RUNNER_BASE_URL) {
    return NextResponse.json(
      {
        error: {
          code: "RUNNER_CONFIG_MISSING",
          message: "RUNNER_BASE_URL is not set for this environment.",
        },
      },
      { status: 500 },
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const response = await fetch(`${RUNNER_BASE_URL}/jobs?${searchParams.toString()}`, {
      method: "GET",
      headers: {
        ...(RUNNER_API_KEY ? { "x-runner-key": RUNNER_API_KEY } : {}),
      },
      cache: "no-store",
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
