#!/usr/bin/env node
/**
 * Convert downloaded issue table HTML files into web/data/issues/ markdown files.
 *
 * Usage:
 *   node process_issues.mjs [--crawl CC-MAIN-2026-12] [--product PAN-OS] [--date YYYY-MM-DD]
 *
 * After this script, run:
 *   python scripts/update_products_from_issues.py
 */

import { JSDOM } from 'jsdom';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const { values: args } = parseArgs({
    options: {
        crawl:   { type: 'string', default: 'CC-MAIN-2026-12' },
        product: { type: 'string', default: 'PAN-OS' },
        date:    { type: 'string' },
    },
    strict: false,
});

function isoWeekStartDate(year, week) {
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4Day = jan4.getUTCDay() || 7;
    const week1Monday = new Date(jan4);
    week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));

    const target = new Date(week1Monday);
    target.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
    return target.toISOString().slice(0, 10);
}

function dateFromCrawlId(crawlId) {
    const match = /^CC-MAIN-(\d{4})-(\d{2})$/i.exec(String(crawlId || '').trim());
    if (!match) {
        return null;
    }
    const year = Number(match[1]);
    const week = Number(match[2]);
    if (!Number.isInteger(year) || !Number.isInteger(week) || week < 1 || week > 53) {
        return null;
    }
    return isoWeekStartDate(year, week);
}

const inferredDate = dateFromCrawlId(args.crawl);
const outputDate = args.date || inferredDate || new Date().toISOString().slice(0, 10);

// Set up DOMParser global before importing modules that rely on it.
const { window } = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = window.DOMParser;

const { parseIssuesFromHtmlTable } = await import(
    new URL('../../web/js/process.js', import.meta.url).href
);
const { buildIssueMarkdownDocument } = await import(
    new URL('../../web/js/markdown.js', import.meta.url).href
);

const REPO_ROOT = join(__dirname, '..', '..');
const dataDir = join(__dirname, '..', 'data', args.crawl, args.product);

let files;
try {
    files = readdirSync(dataDir).filter(f => f.endsWith('.html'));
} catch {
    console.error(`No data directory found: ${dataDir}`);
    console.error('Run crawl_cc.py first to download issue tables.');
    process.exit(1);
}

if (files.length === 0) {
    console.log(`No HTML files found in ${dataDir}`);
    process.exit(0);
}

let writtenCount = 0;

for (const file of files.sort()) {
    // Filename format: {version}-{type}.html
    // where type is 'addressed' or 'known'.
    // Version may itself contain hyphens (e.g. '10.2.1-h3'), so split on
    // the *last* hyphen-prefixed token that is a known issue type.
    const baseName = file.replace(/\.html$/, '');
    const lastDash = baseName.lastIndexOf('-');
    if (lastDash === -1) {
        console.warn(`Skipping unexpected filename: ${file}`);
        continue;
    }
    const version   = baseName.slice(0, lastDash);
    const issueType = baseName.slice(lastDash + 1);

    if (issueType !== 'addressed' && issueType !== 'known') {
        console.warn(`Skipping unexpected issue type in filename: ${file}`);
        continue;
    }

    const capitalizedType = issueType.charAt(0).toUpperCase() + issueType.slice(1);
    const html = readFileSync(join(dataDir, file), 'utf-8');

    const parsedIssues = parseIssuesFromHtmlTable(html, { type: capitalizedType });
    if (parsedIssues.length === 0) {
        console.warn(`No issues parsed from ${file} — skipping`);
        continue;
    }

    const markdown = buildIssueMarkdownDocument({
        type: capitalizedType,
        product: args.product,
        version,
        issues: parsedIssues,
        metadata: {
            source: 'common-crawl',
            crawl: args.crawl,
        },
    });

    const outDir = join(REPO_ROOT, 'web', 'data', 'issues', args.product, issueType);
    mkdirSync(outDir, { recursive: true });
    const outFile = join(outDir, `${version}_${outputDate}.md`);
    writeFileSync(outFile, markdown, 'utf-8');
    writtenCount++;
}

console.log(`Wrote ${writtenCount} markdown file(s) to web/data/issues/${args.product}/`);
if (writtenCount > 0) {
    console.log('Next step: python scripts/update_products_from_issues.py');
}
