#!/usr/bin/env python3
"""Download issue table HTML from Common Crawl for PA docs release note pages.

Usage:
    python crawl_cc.py [--crawl CC-MAIN-2026-12] [--product PAN-OS] [--branch 10.2]
"""

import argparse
import gzip
import io
import json
import logging
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from warcio.archiveiterator import ArchiveIterator

CC_INDEX_URL  = "https://index.commoncrawl.org/{crawl}-index"
CC_DATA_URL = "https://data.commoncrawl.org/{filename}"

SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR.parent / "data"
ENTRY_POINTS_FILE = SCRIPT_DIR / "entry_points.json"
DEFAULT_MIN_REQUEST_INTERVAL = 1.0

_MIN_REQUEST_INTERVAL_SECONDS = DEFAULT_MIN_REQUEST_INTERVAL
_LAST_REQUEST_TS = 0.0

ISSUE_TYPE_SLUGS = {
    "addressed": "-addressed-issues",
    "known": "-known-issues",
}


def load_entry_points():
    with open(ENTRY_POINTS_FILE) as f:
        return json.load(f)


def set_request_rate_limit(min_interval_seconds: float) -> None:
    global _MIN_REQUEST_INTERVAL_SECONDS
    _MIN_REQUEST_INTERVAL_SECONDS = max(0.0, float(min_interval_seconds))


def rate_limited_get(url: str, **kwargs):
    global _LAST_REQUEST_TS

    if _MIN_REQUEST_INTERVAL_SECONDS > 0:
        elapsed = time.monotonic() - _LAST_REQUEST_TS
        sleep_for = _MIN_REQUEST_INTERVAL_SECONDS - elapsed
        if sleep_for > 0:
            time.sleep(sleep_for)

    response = requests.get(url, **kwargs)
    _LAST_REQUEST_TS = time.monotonic()
    return response


def query_cc_index(crawl: str, url: str) -> list[dict]:
    """Query the CC index for all records matching *url* exactly. Returns [] if not found."""
    return _query_cc_index(crawl, url, match_type="exact")


def query_cc_index_prefix(crawl: str, prefix_url: str) -> list[dict]:
    """Query the CC index for all records whose URL starts with *prefix_url*.

    Returns a flat list of all matching records (may be large).
    """
    return _query_cc_index(crawl, prefix_url, match_type="prefix")


def _query_cc_index(crawl: str, url: str, match_type: str) -> list[dict]:
    index_url = CC_INDEX_URL.format(crawl=crawl)
    resp = rate_limited_get(
        index_url,
        params={"url": url, "matchType": match_type, "output": "json"},
        timeout=60,
    )
    if resp.status_code == 404:
        return []
    resp.raise_for_status()
    records = []
    for line in resp.text.strip().splitlines():
        line = line.strip()
        if line:
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return records


def pick_latest_record(records: list[dict]) -> dict | None:
    """Return the record with the most recent timestamp."""
    if not records:
        return None
    return max(records, key=lambda r: r.get("timestamp", ""))


def _url_candidates(url: str) -> list[str]:
    stripped = url.rstrip("/")
    with_slash = stripped + "/"
    candidates = [stripped, with_slash]

    if stripped.startswith("https://"):
        alt = "http://" + stripped[len("https://") :]
        candidates.extend([alt, alt + "/"])
    elif stripped.startswith("http://"):
        alt = "https://" + stripped[len("http://") :]
        candidates.extend([alt, alt + "/"])

    seen = set()
    out = []
    for candidate in candidates:
        if candidate not in seen:
            seen.add(candidate)
            out.append(candidate)
    return out


def find_latest_record_for_url(crawl: str, url: str) -> dict | None:
    """Find the latest CC record for a URL, with normalization fallbacks."""
    for candidate in _url_candidates(url):
        record = pick_latest_record(query_cc_index(crawl, candidate))
        if record:
            return record

    # Fallback: search the parent path with prefix match and pick the closest URL.
    parent_prefix = url.rsplit("/", 1)[0] + "/"
    slug = urlparse(url).path.rstrip("/").rsplit("/", 1)[-1]
    pref_records = query_cc_index_prefix(crawl, parent_prefix)
    if not pref_records:
        return None

    candidates = []
    normalized_targets = set(_url_candidates(url))
    for rec in pref_records:
        rec_url = str(rec.get("url", "")).split("?", 1)[0].split("#", 1)[0]
        if rec_url in normalized_targets:
            candidates.append(rec)
            continue
        rec_slug = urlparse(rec_url).path.rstrip("/").rsplit("/", 1)[-1]
        if rec_slug == slug:
            candidates.append(rec)

    return pick_latest_record(candidates)


def fetch_warc_record(filename: str, offset: int, length: int) -> bytes:
    """Fetch a WARC record via HTTP range request and return the raw WARC bytes.

    Retries transient 5xx/429 failures a few times before giving up.
    """
    url = CC_DATA_URL.format(filename=filename)
    headers = {"Range": f"bytes={offset}-{offset + length - 1}"}
    last_error = None
    for attempt in range(1, 5):
        try:
            resp = rate_limited_get(url, headers=headers, timeout=60)
            if resp.status_code in (429, 500, 502, 503, 504):
                raise requests.HTTPError(
                    f"Transient HTTP {resp.status_code}", response=resp
                )
            resp.raise_for_status()
            return resp.content
        except requests.RequestException as exc:
            last_error = exc
            if attempt == 4:
                break
            wait_seconds = attempt * 2
            logging.warning(
                "Retrying WARC fetch (%d/4) after error for %s: %s",
                attempt,
                filename,
                exc,
            )
            time.sleep(wait_seconds)

    raise RuntimeError(f"Failed to fetch WARC record after retries: {filename}") from last_error


def extract_html_from_warc(warc_bytes: bytes) -> str | None:
    """Extract the HTTP response body from a WARC record (handles gzip body encoding)."""
    for record in ArchiveIterator(io.BytesIO(warc_bytes)):
        if record.rec_type == "response":
            body = record.content_stream().read()
            # Handle Content-Encoding: gzip on the HTTP response body
            encoding = ""
            if record.http_headers:
                encoding = record.http_headers.get_header("Content-Encoding", "").lower()
            if "gzip" in encoding:
                try:
                    body = gzip.decompress(body)
                except Exception:
                    pass
            # Determine charset from Content-Type
            charset = "utf-8"
            if record.http_headers:
                ct = record.http_headers.get_header("Content-Type", "")
                m = re.search(r"charset=([^\s;]+)", ct, re.I)
                if m:
                    charset = m.group(1)
            return body.decode(charset, errors="replace")
    return None


def extract_version_from_slug(page_slug: str, slug_prefix: str) -> str | None:
    """
    Extract a dotted version string from a PA docs page slug.

    Examples (slug_prefix='pan-os-'):
        pan-os-10-2-1-addressed-issues  ->  10.2.1
        pan-os-10-2-1-h3-addressed-issues  ->  10.2.1-h3
        pan-os-10-2-known-issues  ->  10.2
    """
    # Strip issue type suffix
    stripped = page_slug
    for suffix in ISSUE_TYPE_SLUGS.values():
        if stripped.endswith(suffix):
            stripped = stripped[: -len(suffix)]
            break

    # Strip product prefix
    if stripped.startswith(slug_prefix):
        stripped = stripped[len(slug_prefix):]
    else:
        return None

    if not stripped:
        return None

    # Convert "10-2-1-h3" -> "10.2.1-h3"
    parts = stripped.split("-")
    numeric_parts = []
    remainder = []
    for part in parts:
        if part.isdigit() and not remainder:
            numeric_parts.append(part)
        else:
            remainder.append(part)

    if not numeric_parts:
        return None

    version = ".".join(numeric_parts)
    if remainder:
        version += "-" + "-".join(remainder)
    return version


def find_issue_table(html: str) -> str | None:
    """
    Find the issue table in an HTML page. Prefers a table whose header row
    contains both 'Issue ID' and 'Description'. Falls back to the first table.
    """
    soup = BeautifulSoup(html, "html.parser")
    for table in soup.find_all("table"):
        header_text = " ".join(
            th.get_text(separator=" ", strip=True) for th in table.find_all("th")
        ).lower()
        if "issue" in header_text and "description" in header_text:
            return str(table)
    table = soup.find("table")
    return str(table) if table else None


def download_version_page(
    record: dict, url: str, issue_type: str, slug_prefix: str, out_dir: Path
) -> bool:
    """
    Download and save the issue table HTML for one version page.
    Returns True on success, False if skipped.
    """
    page_slug = urlparse(url).path.rstrip("/").rsplit("/", 1)[-1]
    version = extract_version_from_slug(page_slug, slug_prefix)
    if not version:
        logging.warning("Could not extract version from URL %s — skipping", url)
        return False

    try:
        warc_bytes = fetch_warc_record(
            record["filename"],
            int(record["offset"]),
            int(record["length"]),
        )
    except Exception as exc:
        logging.warning("Could not fetch WARC for %s — skipping (%s)", url, exc)
        return False
    html = extract_html_from_warc(warc_bytes)
    if not html:
        logging.warning("Could not extract HTML from WARC for %s — skipping", url)
        return False

    table_html = find_issue_table(html)
    if not table_html:
        logging.warning("No issue table found in %s — skipping", url)
        return False

    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{version}-{issue_type}.html"
    out_file.write_text(table_html, encoding="utf-8")
    logging.info("Saved  %s", out_file.relative_to(DATA_DIR.parent))
    return True


def process_branch(
    crawl: str,
    product: str,
    product_cfg: dict,
    branch_cfg: dict,
    max_results: int = 0,
) -> None:
    branch = branch_cfg["branch"]
    main_page = branch_cfg["main_page"]
    slug_prefix = product_cfg.get("slug_prefix", "")
    out_dir = DATA_DIR / crawl / product

    # Derive the release-notes directory URL for a prefix query.
    # e.g. ".../pan-os/10-2/pan-os-release-notes/features-introduced-in-pan-os"
    #   -> ".../pan-os/10-2/pan-os-release-notes/"
    notes_dir = main_page.rsplit("/", 1)[0] + "/"

    logging.info("=== Branch %s ===", branch)
    logging.info("Querying CC index (prefix) for %s", notes_dir)

    all_records = query_cc_index_prefix(crawl, notes_dir)
    if not all_records:
        logging.warning("No CC records found under %s — skipping branch", notes_dir)
        return

    # Deduplicate: keep the latest record per URL.
    latest_by_url: dict[str, dict] = {}
    for rec in all_records:
        url = rec.get("url", "")
        if url not in latest_by_url or rec.get("timestamp", "") > latest_by_url[url].get("timestamp", ""):
            latest_by_url[url] = rec

    # Filter for issue pages.
    issue_urls: dict[str, str] = {}
    for url in latest_by_url:
        for issue_type, slug in ISSUE_TYPE_SLUGS.items():
            if slug in url:
                issue_urls[url] = issue_type
                break

    if not issue_urls:
        logging.warning("No issue page URLs found under %s", notes_dir)
        return

    selected_issue_items = sorted(issue_urls.items())
    if max_results > 0:
        logging.info(
            "Found %d issue page URLs (will stop after %d successful downloads)",
            len(issue_urls),
            max_results,
        )
    else:
        logging.info("Found %d issue page URLs", len(issue_urls))

    successful_downloads = 0
    for url, issue_type in selected_issue_items:
        if max_results > 0 and successful_downloads >= max_results:
            break
        try:
            saved = download_version_page(latest_by_url[url], url, issue_type, slug_prefix, out_dir)
            if saved:
                successful_downloads += 1
        except Exception as exc:
            logging.warning("Unexpected error while processing %s — skipping (%s)", url, exc)


def process_single_url(crawl: str, product: str, product_cfg: dict, url: str) -> None:
    slug_prefix = product_cfg.get("slug_prefix", "")
    out_dir = DATA_DIR / crawl / product

    issue_type = None
    for candidate_type, slug in ISSUE_TYPE_SLUGS.items():
        if slug in url:
            issue_type = candidate_type
            break

    if not issue_type:
        logging.error(
            "URL does not look like a known/addressed issue page: %s",
            url,
        )
        return

    record = find_latest_record_for_url(crawl, url)
    if not record:
        logging.warning("No CC record for %s (including normalized fallbacks)", url)
        return

    download_version_page(record, url, issue_type, slug_prefix, out_dir)


def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")

    parser = argparse.ArgumentParser(
        description="Download PA docs issue tables from Common Crawl."
    )
    parser.add_argument("--crawl", default="CC-MAIN-2026-12", help="Common Crawl index ID")
    parser.add_argument(
        "--product",
        default="PAN-OS",
        help="Product name (must match a key in entry_points.json)",
    )
    parser.add_argument("--branch", help="Process only this branch (e.g. 10.2)")
    parser.add_argument(
        "--url",
        help="Process exactly one issue page URL (must include -addressed-issues or -known-issues)",
    )
    parser.add_argument(
        "--min-request-interval",
        type=float,
        default=DEFAULT_MIN_REQUEST_INTERVAL,
        help="Minimum seconds between HTTP requests to Common Crawl (default: 1.0)",
    )
    parser.add_argument(
        "--max-results",
        type=int,
        default=0,
        help="When using entry-point branch mode, download only the first N discovered issue pages (0 = no limit)",
    )
    args = parser.parse_args()

    set_request_rate_limit(args.min_request_interval)
    logging.info("Using request rate limit: %.2f seconds/request", args.min_request_interval)

    entry_points = load_entry_points()
    if args.product not in entry_points:
        sys.exit(f"Product {args.product!r} not found in entry_points.json")

    product_cfg = entry_points[args.product]

    if args.url:
        process_single_url(args.crawl, args.product, product_cfg, args.url)
        return

    branches = product_cfg["branches"]

    if args.branch:
        branches = [b for b in branches if b["branch"] == args.branch]
        if not branches:
            sys.exit(f"Branch {args.branch!r} not found for product {args.product!r}")

    for branch_cfg in branches:
        process_branch(
            args.crawl,
            args.product,
            product_cfg,
            branch_cfg,
            max_results=max(0, args.max_results),
        )


if __name__ == "__main__":
    main()
