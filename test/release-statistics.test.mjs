import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReleaseStatistics, renderStatisticsPage } from '../scripts/generate-release-statistics.mjs';

test('counts unique releases at major and minor levels and hotfixes at patch level', () => {
    const records = [
        { product: 'PAN-OS', issueType: 'known', version: '10.1.2' },
        { product: 'PAN-OS', issueType: 'addressed', version: '10.1.2' },
        { product: 'PAN-OS', issueType: 'addressed', version: '10.1.2-h1' },
        { product: 'PAN-OS', issueType: 'addressed', version: '10.1.2-h3' },
        { product: 'PAN-OS', issueType: 'addressed', version: '10.1.3' },
        { product: 'PAN-OS', issueType: 'known', version: '10.2.1' }
    ];

    const [product] = buildReleaseStatistics(records);
    assert.equal(product.releases, 5);
    assert.equal(product.majors[0].releases, 5);
    assert.equal(product.majors[0].minors[0].version, '10.2');
    assert.equal(product.majors[0].minors[1].releases, 4);
    assert.deepEqual(
        product.majors[0].minors[1].patches.map(({ version, hotfixes }) => ({ version, hotfixes })),
        [
            { version: '10.1.3', hotfixes: 0 },
            { version: '10.1.2', hotfixes: 2 }
        ]
    );
});

test('renders the nested levels into a static HTML page', () => {
    const html = renderStatisticsPage(buildReleaseStatistics([
        { product: 'PAN-OS', issueType: 'addressed', version: '10.1.2-h1' }
    ]));

    assert.match(html, /class="stats-major"/);
    assert.match(html, /class="stats-minor"[^>]+hidden/);
    assert.match(html, /class="stats-patch"[^>]+hidden/);
    assert.match(html, /class="stats-toggle"[^>]+aria-expanded="false"/);
    assert.match(html, /src="js\/statistics\.js"/);
    assert.match(html, />1 hotfix</);
});

test('pluralizes hotfix counts correctly', () => {
    const html = renderStatisticsPage(buildReleaseStatistics([
        { product: 'PAN-OS', issueType: 'addressed', version: '10.1.2-h1' },
        { product: 'PAN-OS', issueType: 'addressed', version: '10.1.2-h2' }
    ]));

    assert.match(html, />2 hotfixes</);
    assert.doesNotMatch(html, /hotfixs/);
});
