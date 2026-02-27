import { NextResponse } from "next/server";

const RUNNER_BASE_URL = process.env.RUNNER_BASE_URL ?? "http://localhost:8000";
const RUNNER_API_KEY = process.env.RUNNER_API_KEY;

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  const response = await fetch(`${RUNNER_BASE_URL}/jobs/${id}/cancel`, {
    method: "POST",
    headers: {
      ...(RUNNER_API_KEY ? { "x-runner-key": RUNNER_API_KEY } : {}),
    },
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
}

