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
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
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
const MODIFIED_FILE_LABEL = 'Modified file:';

function readHtmlFiles(dirPath) {
    try {
        return readdirSync(dirPath).filter(name => name.endsWith('.html')).sort();
    } catch {
        return [];
    }
}

function getInputEntries(referenceRoot, productName) {
    const productRoot = join(referenceRoot, productName);
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

function createNoChangeReporter(stdout) {
    let noChangeCount = 0;
    let isShowingCounter = false;

    return {
        increment() {
            noChangeCount++;
            const noun = noChangeCount === 1 ? 'file' : 'files';
            stdout.write(`\rNo changes for: ${noChangeCount} ${noun}`);
            isShowingCounter = true;
        },
        flush() {
            if (!isShowingCounter) {
                return;
            }
            stdout.write('\n');
            isShowingCounter = false;
        },
        getCount() {
            return noChangeCount;
        }
    };
}

export function formatFileStatusLine(status, fileLabel) {
    if (status === 'modified') {
        return `${MODIFIED_FILE_LABEL} ${fileLabel}`;
    }
    if (status === 'new') {
        return `${'New file:'.padEnd(MODIFIED_FILE_LABEL.length)} ${fileLabel}`;
    }
    throw new Error(`Unsupported file status: ${status}`);
}

export function processIssues({
    referenceRoot = __dirname,
    outputRoot = OUTPUT_ROOT,
    stdout = process.stdout,
    logger = console,
} = {}) {
    let newCount = 0;
    let modifiedCount = 0;
    let skippedNoIssues = 0;
    let processedProducts = 0;

    const allEntries = getProductNames(referenceRoot).flatMap(product =>
        getInputEntries(referenceRoot, product).map(entry => ({ ...entry, product }))
    );
    const totalEntries = allEntries.length;
    let processedEntries = 0;
    const seenProducts = new Set();
    const noChangeReporter = createNoChangeReporter(stdout);

    for (const entry of allEntries) {
        const product = entry.product;
        if (!seenProducts.has(product)) {
            seenProducts.add(product);
            processedProducts++;
        }

        const { filePath, issueType, version } = entry;

        const capitalizedType = issueType.charAt(0).toUpperCase() + issueType.slice(1);
        const html = readFileSync(filePath, 'utf-8');

        const parsedIssues = parseIssuesFromHtmlTable(html, { type: capitalizedType });
        processedEntries++;
        if (parsedIssues.length === 0) {
            noChangeReporter.flush();
            logger.warn(`[${processedEntries}/${totalEntries}] No issues parsed from ${basename(filePath)} — skipping`);
            skippedNoIssues++;
            continue;
        }

        const markdown = buildIssueMarkdownDocument({
            type: capitalizedType,
            product,
            version,
            issues: parsedIssues,
        });

        const outDir = join(outputRoot, product, issueType);
        mkdirSync(outDir, { recursive: true });

        const outFile = join(outDir, `${version}.md`);
        if (existsSync(outFile) && readFileSync(outFile, 'utf-8') === markdown) {
            noChangeReporter.increment();
            continue;
        }

        noChangeReporter.flush();
        const fileLabel = `${product}-${version}`;
        const isNewFile = !existsSync(outFile);
        writeFileSync(outFile, markdown, 'utf-8');
        if (isNewFile) {
            newCount++;
            logger.log(formatFileStatusLine('new', fileLabel));
        } else {
            modifiedCount++;
            logger.log(formatFileStatusLine('modified', fileLabel));
        }
    }

    if (processedProducts === 0) {
        noChangeReporter.flush();
        logger.error(`No HTML files found under ${referenceRoot}.`);
        return {
            processedProducts,
            newCount,
            modifiedCount,
            noChangeCount: noChangeReporter.getCount(),
            skippedNoIssues,
        };
    }

    const writtenCount = newCount + modifiedCount;
    noChangeReporter.flush();
    logger.log(`Wrote ${writtenCount} markdown file(s) across ${processedProducts} product(s).`);
    if (skippedNoIssues > 0) {
        logger.log(`Skipped ${skippedNoIssues} file(s) with no parsed issues.`);
    }
    if (writtenCount > 0) {
        logger.log('Next step: python scripts/update_products_from_issues.py');
    }

    return {
        processedProducts,
        newCount,
        modifiedCount,
        noChangeCount: noChangeReporter.getCount(),
        skippedNoIssues,
    };
}

function getProductNames(referenceRoot) {
    return readdirSync(referenceRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .filter(name => name !== '.' && name !== '..')
        .sort();
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
    processIssues();
}
