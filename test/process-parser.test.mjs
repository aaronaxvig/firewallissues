import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = window.DOMParser;

const { parseIssuesFromHtmlTable } = await import('../web/js/process.js');
const { buildIssueMarkdownDocument } = await import('../web/js/markdown.js');
const { formatFileStatusLine, processIssues } = await import('../reference/process_issues.mjs');

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

        // Extract type from folder name (e.g., "PAA-25.6.2-known" → "Known")
        const typeFromFolder = fixtureId.split('-').pop().toLowerCase();
        const capitalizedType = typeFromFolder.charAt(0).toUpperCase() + typeFromFolder.slice(1);
        const parsedIssues = parseIssuesFromHtmlTable(inputHtml, { type: capitalizedType });

        const markdown = buildIssueMarkdownDocument({
            type: capitalizedType,
            product: metadata.product,
            version: metadata.version,
            issues: parsedIssues
        });

        assert.equal(markdown.trim(), expectedMarkdown.trim());
    });
});

test('processIssues reports unchanged, modified, and new files distinctly', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'firewallissues-process-'));
    const referenceRoot = join(tempRoot, 'reference');
    const outputRoot = join(tempRoot, 'web', 'data', 'issues');
    const fixtureRoot = join(fixturesDir, 'PAN-OS-10.2.1-addressed');
    const modifiedFixtureRoot = join(fixturesDir, 'PAN-OS-10.1.11-known');
    const newFixtureRoot = join(fixturesDir, 'PAN-OS-12.1.2-addressed');
    const stdoutChunks = [];
    const logs = [];

    try {
        mkdirSync(join(referenceRoot, 'PAN-OS', 'addressed'), { recursive: true });
        mkdirSync(join(referenceRoot, 'PAN-OS', 'known'), { recursive: true });

        writeFileSync(
            join(referenceRoot, 'PAN-OS', 'addressed', '10.2.1.html'),
            readFileSync(join(fixtureRoot, 'input.html'), 'utf-8')
        );
        writeFileSync(
            join(referenceRoot, 'PAN-OS', 'known', '10.1.11.html'),
            readFileSync(join(modifiedFixtureRoot, 'input.html'), 'utf-8')
        );
        writeFileSync(
            join(referenceRoot, 'PAN-OS', 'addressed', '12.1.2.html'),
            readFileSync(join(newFixtureRoot, 'input.html'), 'utf-8')
        );

        mkdirSync(join(outputRoot, 'PAN-OS', 'addressed'), { recursive: true });
        mkdirSync(join(outputRoot, 'PAN-OS', 'known'), { recursive: true });
        writeFileSync(
            join(outputRoot, 'PAN-OS', 'addressed', '10.2.1.md'),
            readFileSync(join(fixtureRoot, 'expected.md'), 'utf-8')
        );
        writeFileSync(join(outputRoot, 'PAN-OS', 'known', '10.1.11.md'), 'old content');

        const summary = processIssues({
            referenceRoot,
            outputRoot,
            stdout: {
                write(chunk) {
                    stdoutChunks.push(chunk);
                }
            },
            logger: {
                log(message) {
                    logs.push(message);
                },
                warn(message) {
                    logs.push(message);
                },
                error(message) {
                    logs.push(message);
                }
            }
        });

        assert.deepEqual(summary, {
            processedProducts: 1,
            newCount: 1,
            modifiedCount: 1,
            noChangeCount: 1,
            skippedNoIssues: 0,
        });
        assert.equal(stdoutChunks.join(''), '\rNo changes for: 1 file\n');
        assert.ok(logs.includes(formatFileStatusLine('modified', 'PAN-OS-10.1.11')));
        assert.ok(logs.includes(formatFileStatusLine('new', 'PAN-OS-12.1.2')));
        assert.equal(
            readFileSync(join(outputRoot, 'PAN-OS', 'known', '10.1.11.md'), 'utf-8').trim(),
            readFileSync(join(modifiedFixtureRoot, 'expected.md'), 'utf-8').trim()
        );
        assert.equal(
            readFileSync(join(outputRoot, 'PAN-OS', 'addressed', '12.1.2.md'), 'utf-8').trim(),
            readFileSync(join(newFixtureRoot, 'expected.md'), 'utf-8').trim()
        );
    } finally {
        rmSync(tempRoot, { recursive: true, force: true });
    }
});
