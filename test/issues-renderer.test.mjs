import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = window.DOMParser;

globalThis.fetch = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve([]),
    text: () => Promise.resolve('')
});

const { parseMarkdownIssues, markdownSummaryToHtml } = await import('../web/js/issues.js');

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

const fixtures = readdirSync(fixturesDir).filter(name => {
    const contents = readdirSync(join(fixturesDir, name), { withFileTypes: true }).map(d => d.name);
    return contents.includes('expected.md') && contents.includes('expected-parsed.json');
});

fixtures.forEach(fixtureId => {
    const fixturePath = join(fixturesDir, fixtureId);

    test(`parses and renders ${fixtureId}`, () => {
        const markdownText = readFileSync(join(fixturePath, 'expected.md'), 'utf-8');
        const expectedParsed = JSON.parse(readFileSync(join(fixturePath, 'expected-parsed.json'), 'utf-8'));

        const parsed = parseMarkdownIssues(markdownText);

        assert.equal(parsed.length, expectedParsed.length, 'issue count');

        parsed.forEach((issue, i) => {
            const expected = expectedParsed[i];
            assert.equal(issue.id, expected.id, `issue[${i}] id`);
            assert.equal(issue.summary, expected.summary, `issue[${i}] summary`);
            assert.equal(issue.resolved, expected.resolved, `issue[${i}] resolved`);
            assert.equal(issue.caveat, expected.caveat, `issue[${i}] caveat`);

            const renderedHtml = markdownSummaryToHtml(issue.summary, issue.resolved, issue.caveat);
            assert.equal(renderedHtml, expected.renderedHtml, `issue[${i}] renderedHtml`);
        });
    });
});
