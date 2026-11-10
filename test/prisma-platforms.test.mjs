import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processIssues } from '../reference/process_issues.mjs';
import { updateProductsFromIssues } from '../scripts/update-products-from-issues.mjs';
import { generateReleaseStatistics } from '../scripts/generate-release-statistics.mjs';
import { buildProductTree } from '../web/js/product-tree-model.js';
import { findIssueReleaseNode } from '../web/js/tree.js';

globalThis.fetch = async () => ({ ok: true, json: async () => [] });
const { parseMarkdownIssues, markdownSummaryToHtml } = await import('../web/js/issues.js');
const referenceRoot = fileURLToPath(new URL('../reference/', import.meta.url));
const cases = [
    ['PrismaAgent', 'Prisma Access Agent', 'addressed', '26.4', 18],
    ['PrismaAgent', 'Prisma Access Agent', 'addressed', '26.4.1', 2],
    ['PrismaAgent', 'Prisma Access Agent', 'addressed', '26.4.2', 5],
    ['PrismaAgent', 'Prisma Access Agent', 'known', '26.4', 8],
    ['PrismaAgent-Android', 'Prisma Access Agent-Android', 'addressed', '26.4', 1],
    ['PrismaAgent-Android', 'Prisma Access Agent-Android', 'known', '26.4', 7],
    ['PrismaAgent-iOS', 'Prisma Access Agent-iOS', 'known', '26.4', 5],
    ['PrismaAgent-Linux', 'Prisma Access Agent-Linux', 'known', '26.4', 25]
];

test('Prisma references convert, appear in the tree, render, and populate statistics', async t => {
    const root = await mkdtemp(join(tmpdir(), 'firewallissues-prisma-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const references = join(root, 'reference');
    await mkdir(references);
    for (const folder of new Set(cases.map(item => item[0]))) {
        await cp(join(referenceRoot, folder), join(references, folder), { recursive: true });
    }
    const issuesDir = join(root, 'issues');
    const options = {
        referenceRoot: references, outputRoot: issuesDir,
        stdout: { write() {} }, logger: { log() {}, warn() {}, error() {} }
    };
    const converted = processIssues(options);
    assert.equal(converted.newCount, 8);
    assert.equal(converted.skippedNoIssues, 0);

    const productsPath = join(root, 'products.json');
    const manifestPath = join(root, 'manifest.json');
    await writeFile(productsPath, JSON.stringify({
        'Prisma Access Agent': { 26: { addressed: [], known: [] } }
    }));
    await writeFile(manifestPath, JSON.stringify({ schema: 1, nodes: [] }));
    const updated = await updateProductsFromIssues({ issuesDir, productsPath, manifestPath });
    assert.equal(updated.unmatched.length, 0);
    const products = JSON.parse(await readFile(productsPath, 'utf8'));
    assert.equal(Object.keys(products).length, 4);
    const nodes = [];
    function visit(children) {
        for (const node of children) { nodes.push(node); visit(node.children ?? []); }
    }
    visit(buildProductTree(products));

    const plotDataDir = join(root, 'statistics');
    const statistics = await generateReleaseStatistics({
        issuesDir, outputPath: join(root, 'statistics.html'), plotDataDir
    });
    assert.equal(statistics.products, 4);
    assert.equal(statistics.points, 71);
    const plotProducts = new Map(JSON.parse(await readFile(join(plotDataDir, 'products.json'), 'utf8')));
    for (const [, product, type, version, count] of cases) {
        assert.ok(findIssueReleaseNode(nodes, product, version, type), `${product}/${type}/${version} selectable`);
        const markdown = await readFile(join(issuesDir, product, type, `${version}.md`), 'utf8');
        assert.ok(markdown.includes(`product: ${product}\n`));
        const issues = parseMarkdownIssues(markdown);
        assert.equal(issues.length, count, `${product}/${type}/${version} issue count`);
        for (const issue of issues) {
            assert.match(issue.id, /^PANG-\d+$/);
            assert.ok(markdownSummaryToHtml(issue.summary, issue.resolved, issue.caveat).length > 0);
        }
        const plot = JSON.parse(await readFile(join(plotDataDir, plotProducts.get(product)), 'utf8'));
        const releaseIndex = plot[type].releases.indexOf(version);
        assert.ok(releaseIndex >= 0);
        assert.equal(plot[type].points.filter(point => point[0] === releaseIndex).length, count);
    }
    const second = processIssues(options);
    assert.equal(second.noChangeCount, 8);
    assert.equal(second.modifiedCount, 0);
});
