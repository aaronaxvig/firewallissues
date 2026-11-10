import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { buildProductTree, enumerateTreePaths } from '../web/js/product-tree-model.js';
import { rebuildProducts, updateProductsFromIssues } from '../scripts/update-products-from-issues.mjs';

test('registers new platforms and release trains while preserving product grouping', () => {
    const products = {
        'Prisma Access Agent': { 26: { addressed: [], known: [] } },
        'PAN-OS': { 12: { '12.1': { addressed: [], known: [] } } }
    };
    const records = [
        ['Prisma Access Agent-Linux', '26.4'],
        ['Prisma Access Agent', '27.1'],
        ['PAN-OS', '12.2.2'],
        ['PAN-OS', '13.1.0']
    ].map(([product, version]) => ({ product, version, issueType: 'known', filename: `${version}.md` }));
    assert.deepEqual(rebuildProducts(products, records).unmatched, []);
    assert.deepEqual(products['Prisma Access Agent-Linux'].known, ['26.4.md']);
    assert.deepEqual(products['Prisma Access Agent'][27].known, ['27.1.md']);
    assert.deepEqual(products['PAN-OS'][12]['12.2'].known, ['12.2.2.md']);
    assert.deepEqual(products['PAN-OS'][13]['13.1'].known, ['13.1.0.md']);
});

test('product updater rebuilds products and append-only manifest idempotently', async t => {
    const root = await mkdtemp(join(tmpdir(), 'firewallissues-update-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const issuesDir = join(root, 'issues');
    const productsPath = join(root, 'products.json');
    const manifestPath = join(root, 'manifest.json');
    await mkdir(join(issuesDir, 'Product', 'addressed'), { recursive: true });
    await mkdir(join(issuesDir, 'Product', 'known'), { recursive: true });
    await writeFile(join(issuesDir, 'Product', 'addressed', '1.2.3-h2.md'), 'addressed');
    await writeFile(join(issuesDir, 'Product', 'addressed', '1.2.3.md'), 'addressed');
    await writeFile(join(issuesDir, 'Product', 'known', '1.2.4.md'), 'known');

    const initialProducts = {
        Product: {
            1: {
                '1.2': {
                    addressed: ['obsolete.md'],
                    known: []
                }
            }
        }
    };
    const rootPath = JSON.stringify(['Product']);
    await writeFile(productsPath, `${JSON.stringify(initialProducts, null, 2)}\n`);
    await writeFile(manifestPath, `${JSON.stringify({ schema: 1, nodes: [rootPath, 'legacy-path', null] }, null, 2)}\n`);

    const first = await updateProductsFromIssues({ issuesDir, productsPath, manifestPath });
    assert.equal(first.records, 3);
    assert.equal(first.unmatched.length, 0);
    assert.ok(first.appended.length > 0);
    assert.deepEqual(first.missing, ['legacy-path']);

    const products = JSON.parse(await readFile(productsPath, 'utf8'));
    assert.deepEqual(products.Product[1]['1.2'].addressed, ['1.2.3.md', '1.2.3-h2.md']);
    assert.deepEqual(products.Product[1]['1.2'].known, ['1.2.4.md']);

    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.deepEqual(manifest.nodes.slice(0, 3), [rootPath, 'legacy-path', null]);
    const renderedPaths = enumerateTreePaths(buildProductTree(products));
    assert.ok(renderedPaths.every(path => manifest.nodes.includes(path)));

    const second = await updateProductsFromIssues({ issuesDir, productsPath, manifestPath });
    assert.deepEqual(second.appended, []);
    assert.deepEqual(JSON.parse(await readFile(manifestPath, 'utf8')), manifest);
});

test('product updater refuses to rewrite when no issue files are found', async t => {
    const root = await mkdtemp(join(tmpdir(), 'firewallissues-empty-update-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const issuesDir = join(root, 'issues');
    const productsPath = join(root, 'products.json');
    const manifestPath = join(root, 'manifest.json');
    await mkdir(issuesDir);
    await writeFile(productsPath, '{}\n');
    await writeFile(manifestPath, '{"schema":1,"nodes":[]}\n');

    await assert.rejects(
        updateProductsFromIssues({ issuesDir, productsPath, manifestPath }),
        /No '<version>\.md' issue files found/
    );
    assert.equal(await readFile(productsPath, 'utf8'), '{}\n');
});
