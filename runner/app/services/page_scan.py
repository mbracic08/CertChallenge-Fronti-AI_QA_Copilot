from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Callable
from urllib.parse import urldefrag, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

try:
    from playwright.async_api import async_playwright
except Exception:  # noqa: BLE001
    async_playwright = None

EXCLUDED_EXTENSIONS = (
    ".css",
    ".js",
    ".json",
    ".xml",
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".svg",
    ".webp",
    ".ico",
    ".pdf",
    ".zip",
)
EXCLUDED_PATH_MARKERS = ("/logout", "/api/")


@dataclass(slots=True)
class PageSnapshot:
    url: str
    title: str
    forms_count: int
    links_count: int


def _normalize_url(url: str) -> str:
    clean, _ = urldefrag(url.strip())
    parsed = urlparse(clean)
    path = parsed.path or "/"
    if path != "/" and path.endswith("/"):
        path = path[:-1]
    return f"{parsed.scheme}://{parsed.netloc}{path}"


def _is_same_origin(base: str, candidate: str) -> bool:
    base_parsed = urlparse(base)
    cand_parsed = urlparse(candidate)
    return (
        base_parsed.scheme == cand_parsed.scheme
        and base_parsed.netloc.lower() == cand_parsed.netloc.lower()
    )


def _is_excluded(url: str) -> bool:
    lowered = url.lower()
    return lowered.endswith(EXCLUDED_EXTENSIONS) or any(marker in lowered for marker in EXCLUDED_PATH_MARKERS)


async def scan_pages(
    url: str,
    max_pages: int = 30,
    max_depth: int = 2,
    on_progress: Callable[[int], None] | None = None,
) -> dict:
    if async_playwright is not None:
        try:
            return await _scan_with_playwright(url, max_pages, max_depth, on_progress)
        except Exception:  # noqa: BLE001
            # Fall back to static HTML crawl if browser is unavailable.
            pass

    return await _scan_with_http(url, max_pages, max_depth, on_progress)


async def _scan_with_playwright(
    url: str,
    max_pages: int,
    max_depth: int,
    on_progress: Callable[[int], None] | None = None,
) -> dict:
    normalized_url = _normalize_url(url)
    queue: deque[tuple[str, int]] = deque([(normalized_url, 0)])
    visited: set[str] = set()
    pages: list[PageSnapshot] = []
    top_routes: list[str] = []
    auth_walls = False

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        context = await browser.new_context(ignore_https_errors=True)
        page = await context.new_page()

        try:
            while queue and len(visited) < max_pages:
                current_url, depth = queue.popleft()
                if current_url in visited or depth > max_depth or _is_excluded(current_url):
                    continue

                try:
                    await page.goto(current_url, wait_until="domcontentloaded", timeout=15000)
                    await page.wait_for_timeout(1200)
                except Exception:  # noqa: BLE001
                    continue

                visited.add(current_url)

                title = (await page.title()) or "Untitled"
                forms_count = await page.locator("form").count()
                password_inputs = await page.locator("input[type='password']").count()
                hrefs_raw = await page.eval_on_selector_all(
                    "a[href]",
                    "elements => elements.map(e => e.getAttribute('href')).filter(Boolean)",
                )
                hrefs = [str(item) for item in hrefs_raw]
                links_count = len(hrefs)

                pages.append(
                    PageSnapshot(
                        url=current_url,
                        title=title,
                        forms_count=forms_count,
                        links_count=links_count,
                    )
                )

                if "/login" in current_url or "/signin" in current_url or password_inputs > 0:
                    auth_walls = True

                parsed_path = urlparse(current_url).path or "/"
                if parsed_path not in top_routes and len(top_routes) < 12:
                    top_routes.append(parsed_path)

                if on_progress:
                    progress = min(90, int((len(visited) / max_pages) * 100))
                    on_progress(progress)

                if depth == max_depth:
                    continue

                for href in hrefs:
                    try:
                        next_url = _normalize_url(urljoin(current_url, href))
                    except Exception:  # noqa: BLE001
                        continue
                    if _is_same_origin(normalized_url, next_url) and next_url not in visited:
                        queue.append((next_url, depth + 1))
        finally:
            await context.close()
            await browser.close()

    total_forms = sum(page.forms_count for page in pages)
    return {
        "url": normalized_url,
        "pages_found": len(pages),
        "forms_detected": total_forms,
        "auth_walls": auth_walls,
        "top_routes": top_routes,
        "pages": [
            {
                "url": page.url,
                "title": page.title,
                "forms_count": page.forms_count,
                "links_count": page.links_count,
            }
            for page in pages
        ],
    }


async def _scan_with_http(
    url: str,
    max_pages: int,
    max_depth: int,
    on_progress: Callable[[int], None] | None = None,
) -> dict:
    normalized_url = _normalize_url(url)
    queue: deque[tuple[str, int]] = deque([(normalized_url, 0)])
    visited: set[str] = set()
    pages: list[PageSnapshot] = []
    top_routes: list[str] = []
    auth_walls = False

    async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
        while queue and len(visited) < max_pages:
            current_url, depth = queue.popleft()
            if current_url in visited or depth > max_depth or _is_excluded(current_url):
                continue

            try:
                response = await client.get(current_url)
            except Exception:  # noqa: BLE001
                continue

            content_type = response.headers.get("content-type", "")
            if "text/html" not in content_type:
                continue

            visited.add(current_url)
            soup = BeautifulSoup(response.text, "html.parser")
            title_tag = soup.find("title")
            title = title_tag.get_text(strip=True) if title_tag else "Untitled"
            forms_count = len(soup.find_all("form"))
            links = soup.find_all("a", href=True)
            links_count = len(links)

            pages.append(
                PageSnapshot(
                    url=current_url,
                    title=title,
                    forms_count=forms_count,
                    links_count=links_count,
                )
            )

            if "/login" in current_url or "/signin" in current_url:
                auth_walls = True

            parsed_path = urlparse(current_url).path or "/"
            if parsed_path not in top_routes and len(top_routes) < 12:
                top_routes.append(parsed_path)

            if on_progress:
                progress = min(90, int((len(visited) / max_pages) * 100))
                on_progress(progress)

            if depth == max_depth:
                continue

            for anchor in links:
                try:
                    next_url = _normalize_url(urljoin(current_url, anchor["href"]))
                except Exception:  # noqa: BLE001
                    continue
                if _is_same_origin(normalized_url, next_url) and next_url not in visited:
                    queue.append((next_url, depth + 1))

    total_forms = sum(page.forms_count for page in pages)
    return {
        "url": normalized_url,
        "pages_found": len(pages),
        "forms_detected": total_forms,
        "auth_walls": auth_walls,
        "top_routes": top_routes,
        "pages": [
            {
                "url": page.url,
                "title": page.title,
                "forms_count": page.forms_count,
                "links_count": page.links_count,
            }
            for page in pages
        ],
    }
