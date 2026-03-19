import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = window.DOMParser;

const { parseIssuesFromHtmlTable } = await import('../web/js/process.js');
const { buildIssueMarkdownDocument } = await import('../web/js/markdown.js');

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

// Discover all test fixtures
const fixtures = readdirSync(fixturesDir).filter(file => {
    const stat = readdirSync(join(fixturesDir, file), { withFileTypes: true }).map(d => d.name);
    return stat.includes('input.html') && stat.includes('expected.md');
});

fixtures.forEach(fixtureId => {
    const fixturePath = join(fixturesDir, fixtureId);
    const inputPath = join(fixturePath, 'input.html');
    const expectedPath = join(fixturePath, 'expected.md');
    const metaPath = join(fixturePath, 'meta.json');

    let description = '';
    try {
        const metaJson = readFileSync(metaPath, 'utf-8');
        const meta = JSON.parse(metaJson);
        description = meta.description || '';
    } catch {
        // meta.json is optional
    }

    const testName = description ? `${fixtureId} — ${description}` : fixtureId;

    test(`parses ${testName}`, () => {
        const inputHtml = readFileSync(inputPath, 'utf-8');
        const expectedMarkdown = readFileSync(expectedPath, 'utf-8');

        // Extract metadata from expected markdown frontmatter
        const frontmatterMatch = expectedMarkdown.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) {
            throw new Error(`No frontmatter found in ${expectedPath}`);
        }

        const frontmatterLines = frontmatterMatch[1].split('\n');
        const metadata = {};
        frontmatterLines.forEach(line => {
            const [key, ...valueParts] = line.split(':');
            metadata[key.trim()] = valueParts.join(':').trim();
        });

        const parsedIssues = parseIssuesFromHtmlTable(inputHtml);

        // Extract type from folder name (e.g., "PAA-25.6.2-known" → "Known")
        const typeFromFolder = fixtureId.split('-').pop().toLowerCase();
        const capitalizedType = typeFromFolder.charAt(0).toUpperCase() + typeFromFolder.slice(1);

        const markdown = buildIssueMarkdownDocument({
            type: capitalizedType,
            product: metadata.product,
            version: metadata.version,
            issues: parsedIssues
        });

        assert.equal(markdown.trim(), expectedMarkdown.trim());
    });
});
