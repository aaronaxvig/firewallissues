#!/usr/bin/env python3
"""Update products.json entries from discovered issue data files."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any


ISSUE_TYPES = {"addressed", "known"}
FILENAME_RE = re.compile(r"^(?P<version>[^_]+)_(?P<date>\d{4}-\d{2}-\d{2})\.[^.]+$")
HOTFIX_RE = re.compile(r"^(?P<base>\d+(?:\.\d+)*)(?:-h(?P<hotfix>\d+))?$")


@dataclass(frozen=True)
class FileIdentity:
    """Unique identity for a product/version issue bucket."""

    product: str
    issue_type: str
    version: str


@dataclass(frozen=True)
class FileRecord:
    """Parsed issue file metadata used for de-duplication and sorting."""

    identity: FileIdentity
    filename: str
    release_date: date


def parse_args() -> argparse.Namespace:
    """Parse command line arguments for input and output paths."""

    parser = argparse.ArgumentParser(
        description="Update products.json from issue files, keeping latest date per version."
    )
    parser.add_argument(
        "--issues-dir",
        default="web/data/issues",
        help="Directory containing product issue files.",
    )
    parser.add_argument(
        "--products-json",
        default="web/data/products.json",
        help="Path to products.json.",
    )
    return parser.parse_args()


def collect_latest_issue_files(issues_dir: Path) -> dict[FileIdentity, FileRecord]:
    """Collect the newest file per product, issue type, and version."""

    latest: dict[FileIdentity, FileRecord] = {}

    for file_path in sorted(p for p in issues_dir.rglob("*") if p.is_file()):
        relative = file_path.relative_to(issues_dir)
        if len(relative.parts) != 3:
            continue

        product, issue_type, filename = relative.parts
        if issue_type not in ISSUE_TYPES:
            continue

        parsed = parse_issue_filename(filename)
        if parsed is None:
            continue

        version, release_date = parsed
        identity = FileIdentity(product=product, issue_type=issue_type, version=version)
        record = FileRecord(identity=identity, filename=filename, release_date=release_date)

        current = latest.get(identity)
        if current is None or (record.release_date, record.filename) > (
            current.release_date,
            current.filename,
        ):
            latest[identity] = record

    return latest


def parse_issue_filename(filename: str) -> tuple[str, date] | None:
    """Parse '<version>_<YYYY-MM-DD>.<ext>' issue filenames."""

    match = FILENAME_RE.match(filename)
    if not match:
        return None

    version = match.group("version")
    try:
        release_date = date.fromisoformat(match.group("date"))
    except ValueError:
        return None

    return version, release_date


def clear_leaf_issue_arrays(node: Any) -> None:
    """Reset addressed/known arrays on every issue leaf in products.json."""

    if isinstance(node, dict):
        if "addressed" in node or "known" in node:
            node["addressed"] = []
            node["known"] = []
            return

        for value in node.values():
            clear_leaf_issue_arrays(value)


def is_issue_leaf(node: Any) -> bool:
    """Return whether a node is a leaf containing issue arrays."""

    return isinstance(node, dict) and ("addressed" in node or "known" in node)


def pick_target_leaf_path(products: dict[str, Any], product: str, version: str) -> list[str] | None:
    """Choose the best matching product tree path for a version."""

    parts = version.split(".")
    if not parts:
        return None

    major = parts[0]
    minor = f"{parts[0]}.{parts[1]}" if len(parts) > 1 else parts[0]

    candidates = [
        [product, major, minor],
        [product, major],
        [product],
    ]

    for path in candidates:
        node = get_path(products, path)
        if is_issue_leaf(node):
            return path

    return None


def get_path(data: Any, path: list[str]) -> Any:
    """Traverse nested dict keys and return the value at path, if present."""

    current = data
    for key in path:
        if not isinstance(current, dict) or key not in current:
            return None
        current = current[key]
    return current


def parse_release_prefix(prefix: str) -> tuple[tuple[int, ...], int]:
    """Extract numeric base version parts and optional hotfix number."""

    match = HOTFIX_RE.match(prefix)
    if not match:
        return tuple(), -1

    base_parts = tuple(int(part) for part in match.group("base").split("."))
    hotfix_group = match.group("hotfix")
    hotfix = int(hotfix_group) if hotfix_group is not None else -1
    return base_parts, hotfix


def filename_sort_key(filename: str) -> tuple[tuple[int, ...], int, int, str]:
    """Build a sort key that orders base versions before hotfixes."""

    prefix = filename.split("_", 1)[0]
    base_parts, hotfix = parse_release_prefix(prefix)
    is_hotfix = 1 if hotfix >= 0 else 0
    return base_parts, is_hotfix, hotfix, filename


def add_file_to_leaf(
    products: dict[str, Any],
    path: list[str],
    issue_type: str,
    filename: str,
) -> None:
    """Insert an issue filename into the target leaf with stable sorting."""

    leaf = get_path(products, path)
    if not isinstance(leaf, dict):
        return

    files = leaf.get(issue_type)
    if not isinstance(files, list):
        files = []

    files.append(filename)
    leaf[issue_type] = sorted(set(files), key=filename_sort_key)


def update_products(issues_dir: Path, products_path: Path) -> None:
    """Rebuild product issue file lists from crawled issue files."""

    if not issues_dir.is_dir():
        raise FileNotFoundError(f"Issues directory not found: {issues_dir}")
    if not products_path.is_file():
        raise FileNotFoundError(f"products.json not found: {products_path}")

    with products_path.open("r", encoding="utf-8") as f:
        products = json.load(f)

    if not isinstance(products, dict):
        raise ValueError("products.json must contain a top-level object")

    clear_leaf_issue_arrays(products)

    latest_files = collect_latest_issue_files(issues_dir)
    for record in sorted(
        latest_files.values(),
        key=lambda r: (r.identity.product, r.identity.issue_type, r.identity.version),
    ):
        path = pick_target_leaf_path(products, record.identity.product, record.identity.version)
        if path is None:
            continue
        add_file_to_leaf(products, path, record.identity.issue_type, record.filename)

    with products_path.open("w", encoding="utf-8") as f:
        json.dump(products, f, indent=2)
        f.write("\n")


def main() -> int:
    """Entrypoint for command-line usage."""

    args = parse_args()
    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent
    issues_dir = (repo_root / args.issues_dir).resolve()
    products_path = (repo_root / args.products_json).resolve()

    update_products(issues_dir=issues_dir, products_path=products_path)
    print(f"Updated {products_path} from {issues_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
