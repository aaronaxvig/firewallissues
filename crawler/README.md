# Crawler: Common Crawl Ingestion Pipeline

This folder contains a two-step ingestion pipeline that downloads Palo Alto release-note issue tables from Common Crawl snapshots, then converts those HTML tables into the markdown files consumed by this repository.

The goal is to avoid repeatedly scraping live vendor pages while still keeping issue data current and reproducible.  The HTML tables scraped from Common Crawl are not intended to be checked in to source control.

## What This Crawler Does

The crawler workflow has two stages:

1. Download stage (Python)
- Script: code/crawl_cc.py
- Queries Common Crawl index data for PAN-OS release-note issue pages.
- Fetches archived WARC records from Common Crawl.
- Extracts the issue table HTML from each page.
- Stores one HTML table file per version/type in crawler/data.

2. Process stage (Node.js)
- Script: code/process_issues.mjs
- Reads downloaded HTML table files.
- Reuses the existing parser/markdown generator from web/js.
- Writes markdown issue files to web/data/issues.

After processing, you typically run scripts/update_products_from_issues.py to refresh product index mappings.

## Why 

- Lower load on vendor infrastructure.
- Reproducibility by pinning to a crawl snapshot (for example CC-MAIN-2026-12).
- Repeatable local processing from downloaded artifacts.

## Folder Structure

crawler/
- README.md                       This guide
- code/
  - crawl_cc.py                   Download issue table HTML from CC
  - process_issues.mjs            Convert table HTML into markdown files
  - entry_points.json             Product/branch entry points
  - requirements.txt              Python dependencies for downloader
- data/
  - CC-MAIN-2026-12/
    - PAN-OS/
      - 10.2.1-addressed.html
      - 10.2.1-known.html
      - ...

Notes:
- data/ contents are gitignored.
- Each crawl snapshot is stored in its own top-level folder under data/.

## Prerequisites

Python
- Python 3.10+ recommended.
- Install downloader dependencies:
  pip install -r crawler/code/requirements.txt

Node.js
- Use project dependencies from root package.json.
- If needed:
  npm install

## Entry Points Configuration

File: crawler/code/entry_points.json

This file defines:
- Product key (currently PAN-OS).
- URL slug prefix used for version extraction.
- Branch entry points (release-note root pages).

The downloader uses these entry points for branch-mode discovery.

## Download Script: crawl_cc.py

### What it does internally

Branch mode:
1. Takes a branch entry point URL.
2. Converts it to the release-notes directory prefix.
3. Calls CC index with prefix matching to discover archived URLs.
4. Filters for URLs containing:
- -addressed-issues
- -known-issues
5. Deduplicates by URL and keeps the latest timestamp.
6. Downloads WARC slices via byte-range requests.
7. Extracts HTML and finds the issue table.
8. Writes output as:
- crawler/data/<crawl>/<product>/<version>-<type>.html

Single URL mode:
- Accepts one issue-page URL.
- Tries URL normalization fallbacks (scheme and trailing slash variants).
- Falls back to parent prefix search if exact lookup misses.
- Downloads and saves one file when found.

### Rate limiting and reliability

Built-in request controls include:
- Minimum interval between HTTP requests.
- Retry logic for transient errors (429, 5xx).
- Skip-on-failure behavior so one bad record does not kill the whole branch.

### CLI options

Common options:
- --crawl
  Common Crawl snapshot ID.
  Default: CC-MAIN-2026-12

- --product
  Product key from entry_points.json.
  Default: PAN-OS

- --min-request-interval
  Minimum seconds between outbound CC requests.
  Default: 1.0

Branch-mode options:
- --branch
  Restrict to one branch from entry_points.json, such as 10.2.

- --max-results
  In branch mode, stop after N successful downloads.
  Default: 0 (no limit).
  This is ideal for safe smoke tests.

Single-page option:
- --url
  Download exactly one issue-page URL.
  Useful for targeted debugging.

### Example commands

One-branch smoke test (download 1 successful file):
python crawler/code/crawl_cc.py --branch 10.2 --max-results 1 --min-request-interval 2.0

One-branch small run:
python crawler/code/crawl_cc.py --branch 10.2 --max-results 5 --min-request-interval 1.5

One specific page:
python crawler/code/crawl_cc.py --url https://docs.paloaltonetworks.com/pan-os/10-2/pan-os-release-notes/pan-os-10-2-1-known-and-addressed-issues/pan-os-10-2-1-addressed-issues --min-request-interval 2.0

Full configured product run:
python crawler/code/crawl_cc.py --min-request-interval 1.5

## Processing Script: process_issues.mjs

Script path:
- crawler/code/process_issues.mjs

### What it does internally

1. Reads HTML files in:
- crawler/data/<crawl>/<product>/

2. Expects file naming:
- <version>-addressed.html
- <version>-known.html

3. Parses each table using existing project parser logic from web/js/process.js.

4. Builds markdown using web/js/markdown.js.

5. Writes output to:
- web/data/issues/<product>/addressed/<version>_<date>.md
- web/data/issues/<product>/known/<version>_<date>.md

6. Adds source metadata in frontmatter:
- source: common-crawl
- crawl: <crawl id>

7. Date behavior:
- Default output date is inferred from crawl ID (CC-MAIN-YYYY-WW -> ISO week start date).
- You can override with --date.

### CLI options

- --crawl
  Crawl snapshot folder to read from.
  Default: CC-MAIN-2026-12

- --product
  Product folder under crawler/data/<crawl>/.
  Default: PAN-OS

- --date
  Optional override for filename date suffix.
  If omitted, date is derived from crawl ID when possible.

### Example commands

Process files from one crawl snapshot:
node crawler/code/process_issues.mjs --crawl CC-MAIN-2026-12 --product PAN-OS

Process with explicit date override:
node crawler/code/process_issues.mjs --crawl CC-MAIN-2026-12 --product PAN-OS --date 2026-03-20

## Typical End-to-End Workflow

1. Install dependencies:
- pip install -r crawler/code/requirements.txt
- npm install

2. Download a small sample safely:
- python crawler/code/crawl_cc.py --branch 10.2 --max-results 1 --min-request-interval 2.0

3. Process downloaded HTML to markdown:
- node crawler/code/process_issues.mjs --crawl CC-MAIN-2026-12 --product PAN-OS

4. Update products mapping:
- python scripts/update_products_from_issues.py

5. Run tests:
- npm test

## Recommended Testing Strategy

Use these modes while iterating:
- Fast syntax check:
  python -m py_compile crawler/code/crawl_cc.py

- Safe download smoke test:
  python crawler/code/crawl_cc.py --branch 10.2 --max-results 1 --min-request-interval 2.0

- Processing smoke test:
  node crawler/code/process_issues.mjs --crawl CC-MAIN-2026-12 --product PAN-OS

- Verify generated frontmatter quickly:
  grep -R "^source:\|^crawl:" web/data/issues/PAN-OS | head

## Troubleshooting

No issue links found in branch mode
- Cause: release-note navigation is often JS-rendered and not available in archived HTML.
- Current behavior: branch mode uses CC prefix discovery directly, so this should be rare.

No CC record for a specific URL
- Cause: URL canonicalization differences (slash/scheme/path form).
- Current behavior: single URL mode tries normalized variants and fallback prefix matching.

Transient 503 or 429 errors from CC
- Increase --min-request-interval.
- Keep retries enabled (default behavior).
- Rerun; script skips failed pages and continues.

No table found on a discovered page
- Some legacy pages may be non-standard or combined pages.
- Current behavior: page is skipped with a warning.

Wrong date suffix in generated markdown
- By default, date is inferred from crawl ID.
- Pass --date if you intentionally want a different date.

## Design Notes

- The download stage stores raw extracted table artifacts, not final markdown.
- The process stage intentionally reuses existing parser logic to avoid drift from manual workflow.
- Source provenance is kept in markdown frontmatter using source and crawl keys.
- Each Common Crawl snapshot is isolated in its own data subfolder to support repeatability and comparison.
