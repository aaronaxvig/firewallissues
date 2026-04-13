#!/usr/bin/env node
/**
 * Convert downloaded issue table HTML files into web/data/issues/ markdown files.
 *
 * Usage:
 *   node reference/process_issues.mjs
 *
 * After this script, run:
 *   python scripts/update_products_from_issues.py
 */

import { JSDOM } from 'jsdom';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// Set up DOMParser global before importing modules that rely on it.
const { window } = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = window.DOMParser;

const { parseIssuesFromHtmlTable } = await import(
    new URL('../web/js/process.js', import.meta.url).href
);
const { buildIssueMarkdownDocument } = await import(
    new URL('../web/js/markdown.js', import.meta.url).href
);

const OUTPUT_ROOT = join(REPO_ROOT, 'web', 'data', 'issues');

function readHtmlFiles(dirPath) {
    try {
        return readdirSync(dirPath).filter(name => name.endsWith('.html')).sort();
    } catch {
        return [];
    }
}

function getProductNames() {
    return readdirSync(__dirname, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .filter(name => name !== '.' && name !== '..')
        .sort();
}

function getInputEntries(productName) {
    const productRoot = join(__dirname, productName);
    const entries = [];
    for (const issueType of ['addressed', 'known']) {
        const issueTypeDir = join(productRoot, issueType);
        const files = readHtmlFiles(issueTypeDir);
        for (const file of files) {
            const version = basename(file, '.html');
            entries.push({
                filePath: join(issueTypeDir, file),
                version,
                issueType,
            });
        }
    }
    return entries.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

let writtenCount = 0;
let skippedNoIssues = 0;
let processedProducts = 0;

for (const product of getProductNames()) {
    const entries = getInputEntries(product);
    if (entries.length === 0) {
        continue;
    }

    processedProducts++;

    for (const entry of entries) {
        const { filePath, issueType, version } = entry;

        const capitalizedType = issueType.charAt(0).toUpperCase() + issueType.slice(1);
        const html = readFileSync(filePath, 'utf-8');

        const parsedIssues = parseIssuesFromHtmlTable(html, { type: capitalizedType });
        if (parsedIssues.length === 0) {
            console.warn(`No issues parsed from ${basename(filePath)} — skipping`);
            skippedNoIssues++;
            continue;
        }

        const markdown = buildIssueMarkdownDocument({
            type: capitalizedType,
            product,
            version,
            issues: parsedIssues,
        });

        const outDir = join(OUTPUT_ROOT, product, issueType);
        mkdirSync(outDir, { recursive: true });

        const outFile = join(outDir, `${version}.md`);
        writeFileSync(outFile, markdown, 'utf-8');
        writtenCount++;
    }
}

if (processedProducts === 0) {
    console.error(`No HTML files found under ${__dirname}.`);
    process.exit(0);
}

console.log(`Wrote ${writtenCount} markdown file(s) across ${processedProducts} product(s).`);
if (skippedNoIssues > 0) {
    console.log(`Skipped ${skippedNoIssues} file(s) with no parsed issues.`);
}
if (writtenCount > 0) {
    console.log('Next step: python scripts/update_products_from_issues.py');
}
