import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildIssuePlotProduct,
    buildReleaseStatistics,
    extractAddressedIssueIds,
    renderStatisticsPage
} from '../scripts/generate-release-statistics.mjs';

test('extracts unique Issue-IDs only from Markdown issue headings', () => {
    const markdown = `## PAN-123456

Mentions PAN-999999 in the description.

## GPC-001234

## PAN-123456
`;
    assert.deepEqual(extractAddressedIssueIds(markdown), ['PAN-123456', 'GPC-001234']);
});

test('builds compact plot points in semantic release order', () => {
    const plot = buildIssuePlotProduct('PAN-OS', new Map([
        ['10.2.10-h1', ['PAN-130000']],
        ['10.2.9', ['PAN-100000', 'WF500-120000']]
    ]));
    assert.deepEqual(plot.releases, ['10.2.9', '10.2.10-h1']);
    assert.deepEqual(plot.points, [
        [0, 100000, 'PAN-100000'],
        [0, 120000, 'WF500-120000'],
        [1, 130000, 'PAN-130000']
    ]);
});

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

test('renders the graph without displaying the legacy release tables', () => {
    const html = renderStatisticsPage(buildReleaseStatistics([
        { product: 'PAN-OS', issueType: 'addressed', version: '10.1.2-h1' }
    ]));

    assert.match(html, /src="js\/statistics\.js"/);
    assert.match(html, /id="issue-plot-canvas"/);
    assert.doesNotMatch(html, /class="stats-product"/);
});
