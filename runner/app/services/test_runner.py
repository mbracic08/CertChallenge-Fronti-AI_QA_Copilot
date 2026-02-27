from __future__ import annotations

import asyncio
import re
import time
from typing import Callable
from urllib.parse import urljoin

import httpx

from app.models.schemas import FlowSpecTest

try:
    from playwright.async_api import Browser, async_playwright
except Exception:  # noqa: BLE001
    Browser = None  # type: ignore[assignment]
    async_playwright = None

ROUTE_PATTERN = re.compile(r"(/[\w\-./%]+)")


def _extract_route(test: FlowSpecTest) -> str:
    haystack = " ".join([test.title, *test.steps])
    match = ROUTE_PATTERN.search(haystack)
    if not match:
        return "/"
    route = match.group(1).strip()
    return route if route.startswith("/") else "/"


def _humanize_failure_message(category: str, route: str, technical_message: str) -> str:
    route_label = route if route else "/"
    lowered = technical_message.lower()

    if category == "http_error":
        return (
            f"Page check failed on route '{route_label}' because the server returned an error response. "
            "Verify that the page is publicly reachable and does not require unavailable session state."
        )

    if category == "timeout":
        if 'locator("body")' in lowered and "hidden" in lowered:
            return (
                f"Page content on route '{route_label}' did not become visible in time. "
                "The page likely stayed in a loading/hidden state. Check redirects, cookie/banner overlays, "
                "or client-side rendering delays."
            )
        return (
            f"Test step on route '{route_label}' timed out before the page became ready. "
            "Consider increasing wait conditions or validating that this route fully renders without blocking UI states."
        )

    if category == "navigation_error":
        return (
            f"Navigation to route '{route_label}' failed. "
            "Check route availability, DNS/network access, and whether the URL needs authentication."
        )

    return (
        f"Test execution failed on route '{route_label}' due to an unexpected runtime error. "
        "Review technical details for the exact Playwright exception."
    )


async def _run_test_with_playwright(browser: Browser, url: str, test: FlowSpecTest) -> dict:
    route = _extract_route(test)
    started = time.perf_counter()
    context = await browser.new_context(ignore_https_errors=True)
    page = await context.new_page()

    try:
        base_response = await page.goto(url, wait_until="domcontentloaded", timeout=15000)
        if base_response and base_response.status >= 400:
            technical = f"Base page returned HTTP {base_response.status}."
            return {
                "id": test.id,
                "title": test.title,
                "status": "failed",
                "route": "/",
                "duration_ms": int((time.perf_counter() - started) * 1000),
                "error": _humanize_failure_message("http_error", "/", technical),
                "technical_error": technical,
                "failure_category": "http_error",
            }

        if route != "/":
            target_url = urljoin(url, route)
            target_response = await page.goto(target_url, wait_until="domcontentloaded", timeout=15000)
            if target_response and target_response.status >= 400:
                technical = f"Route returned HTTP {target_response.status}."
                return {
                    "id": test.id,
                    "title": test.title,
                    "status": "failed",
                    "route": route,
                    "duration_ms": int((time.perf_counter() - started) * 1000),
                    "error": _humanize_failure_message("http_error", route, technical),
                    "technical_error": technical,
                    "failure_category": "http_error",
                }

        await page.locator("body").wait_for(state="visible", timeout=5000)
        return {
            "id": test.id,
            "title": test.title,
            "status": "passed",
            "route": route,
            "duration_ms": int((time.perf_counter() - started) * 1000),
            "error": None,
            "failure_category": None,
        }
    except Exception as exc:  # noqa: BLE001
        message = str(exc)
        lowered = message.lower()
        if "timeout" in lowered or "timed out" in lowered:
            category = "timeout"
        elif "navigation" in lowered:
            category = "navigation_error"
        else:
            category = "runtime_error"
        return {
            "id": test.id,
            "title": test.title,
            "status": "failed",
            "route": route,
            "duration_ms": int((time.perf_counter() - started) * 1000),
            "error": _humanize_failure_message(category, route, message),
            "technical_error": message,
            "failure_category": category,
        }
    finally:
        await context.close()


async def _run_test_with_http(url: str, test: FlowSpecTest) -> dict:
    route = _extract_route(test)
    started = time.perf_counter()
    target_url = urljoin(url, route)

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            response = await client.get(target_url)
        if response.status_code >= 400:
            technical = f"HTTP {response.status_code}"
            return {
                "id": test.id,
                "title": test.title,
                "status": "failed",
                "route": route,
                "duration_ms": int((time.perf_counter() - started) * 1000),
                "error": _humanize_failure_message("http_error", route, technical),
                "technical_error": technical,
                "failure_category": "http_error",
            }
        return {
            "id": test.id,
            "title": test.title,
            "status": "passed",
            "route": route,
            "duration_ms": int((time.perf_counter() - started) * 1000),
            "error": None,
            "failure_category": None,
        }
    except Exception as exc:  # noqa: BLE001
        message = str(exc)
        lowered = message.lower()
        if "timeout" in lowered or "timed out" in lowered:
            category = "timeout"
        elif "connect" in lowered or "dns" in lowered:
            category = "navigation_error"
        else:
            category = "runtime_error"
        return {
            "id": test.id,
            "title": test.title,
            "status": "failed",
            "route": route,
            "duration_ms": int((time.perf_counter() - started) * 1000),
            "error": _humanize_failure_message(category, route, message),
            "technical_error": message,
            "failure_category": category,
        }


async def run_flow_spec_tests(
    url: str,
    tests: list[FlowSpecTest],
    batch_size: int = 4,
    on_progress: Callable[[int], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
) -> dict:
    started = time.perf_counter()
    results: list[dict] = []
    canceled = False

    if async_playwright is None:
        for index, test in enumerate(tests):
            if should_stop and should_stop():
                canceled = True
                break
            results.append(await _run_test_with_http(url, test))
            if on_progress:
                on_progress(min(95, int(((index + 1) / len(tests)) * 100)))
    else:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            try:
                for offset in range(0, len(tests), batch_size):
                    if should_stop and should_stop():
                        canceled = True
                        break
                    batch = tests[offset : offset + batch_size]
                    batch_results = await asyncio.gather(
                        *[_run_test_with_playwright(browser, url, test) for test in batch]
                    )
                    results.extend(batch_results)
                    if on_progress:
                        on_progress(min(95, int((len(results) / len(tests)) * 100)))
            finally:
                await browser.close()

    passed = sum(1 for item in results if item["status"] == "passed")
    failed = len(results) - passed
    duration_ms = int((time.perf_counter() - started) * 1000)

    return {
        "url": url,
        "total": len(results),
        "passed": passed,
        "failed": failed,
        "duration_ms": duration_ms,
        "batch_size": batch_size,
        "canceled": canceled,
        "tests": results,
    }
