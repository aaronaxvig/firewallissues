/**
 * Generates expected-parsed.json for each fixture directory that contains expected.md.
 * Run manually: node scripts/generate-rendered-fixtures.mjs
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
const defaultFixturesDir = join(__dirname, '../test/fixtures');

export function generateRenderedFixtures(fixturesDir = defaultFixturesDir) {
    const fixtures = readdirSync(fixturesDir).filter(name => {
        const contents = readdirSync(join(fixturesDir, name)).map(d => d);
        return contents.includes('expected.md');
    });

    for (const fixtureId of fixtures) {
        const fixturePath = join(fixturesDir, fixtureId);
        const markdownText = readFileSync(join(fixturePath, 'expected.md'), 'utf-8');
        const parsed = parseMarkdownIssues(markdownText);

        const result = parsed.map(issue => ({
            id: issue.id,
            summary: issue.summary,
            resolved: issue.resolved,
            caveat: issue.caveat,
            renderedHtml: markdownSummaryToHtml(issue.summary, issue.resolved, issue.caveat)
        }));

        writeFileSync(
            join(fixturePath, 'expected-parsed.json'),
            JSON.stringify(result, null, 2) + '\n',
            'utf-8'
        );

        console.log(`Written ${fixtureId}/expected-parsed.json (${result.length} issues)`);
    }
    return { fixtures: fixtures.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    generateRenderedFixtures();
}
