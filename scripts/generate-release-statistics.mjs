#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectIssueFiles } from './update-products-from-issues.mjs';
import { extractIssueIds } from '../web/js/issue-id.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_RE = /^(?<major>\d+)(?:\.(?<minor>\d+))?(?:\.(?<patch>\d+))?(?<rest>.*)$/;
const HOTFIX_RE = /-h\d+(?:\D|$)/i;
const ISSUE_HEADING_RE = /^##\s+(.+?)\s*$/gm;

function compareNumbers(left, right) {
    return Number(left) - Number(right);
}

function productDataFilename(product) {
    const slug = product.replace(/[^a-z0-9.-]+/gi, '-').replace(/^-+|-+$/g, '');
    return `${slug || 'product'}.json`;
}

function compareVersions(left, right) {
    const leftParts = left.match(/\d+/g)?.map(Number) ?? [];
    const rightParts = right.match(/\d+/g)?.map(Number) ?? [];
    const length = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < length; index++) {
        const difference = (leftParts[index] ?? -1) - (rightParts[index] ?? -1);
        if (difference) return difference;
    }
    return left.localeCompare(right);
}

export function extractAddressedIssueIds(markdown) {
    const ids = [];
    for (const match of String(markdown).matchAll(ISSUE_HEADING_RE)) {
        ids.push(...extractIssueIds(match[1]));
    }
    return Array.from(new Set(ids));
}

export function buildIssuePlotProduct(product, releases) {
    const versions = Array.from(releases.keys()).sort(compareVersions);
    const points = [];
    versions.forEach((version, releaseIndex) => {
        for (const id of releases.get(version)) {
            const issueNumber = Number(id.match(/-(\d+)$/)?.[1]);
            if (Number.isSafeInteger(issueNumber)) points.push([releaseIndex, issueNumber, id]);
        }
    });
    return { product, releases: versions, points };
}

export async function buildIssuePlotData(records, issuesDir) {
    const products = new Map();
    const addressed = records.filter(record => record.issueType === 'addressed');
    await Promise.all(addressed.map(async record => {
        const markdown = await readFile(join(issuesDir, record.product, 'addressed', record.filename), 'utf8');
        const ids = extractAddressedIssueIds(markdown);
        const releases = products.get(record.product) ?? new Map();
        releases.set(record.version, ids);
        products.set(record.product, releases);
    }));
    return Array.from(products, ([product, releases]) => buildIssuePlotProduct(product, releases))
        .filter(item => item.points.length > 0)
        .sort((a, b) => a.product.localeCompare(b.product));
}

export function buildReleaseStatistics(records) {
    const products = new Map();

    for (const { product, version } of records) {
        const match = VERSION_RE.exec(version);
        if (!match?.groups.minor) continue;

        const productVersions = products.get(product) ?? new Set();
        productVersions.add(version);
        products.set(product, productVersions);
    }

    return Array.from(products, ([product, versions]) => {
        const majors = new Map();

        for (const version of versions) {
            const { major, minor, patch } = VERSION_RE.exec(version).groups;
            const majorNode = majors.get(major) ?? { version: major, releases: 0, minors: new Map() };
            const minorVersion = `${major}.${minor}`;
            const minorNode = majorNode.minors.get(minor) ?? {
                version: minorVersion,
                releases: 0,
                patches: new Map()
            };

            majorNode.releases += 1;
            minorNode.releases += 1;

            if (patch !== undefined) {
                const patchVersion = `${minorVersion}.${patch}`;
                const patchNode = minorNode.patches.get(patch) ?? {
                    version: patchVersion,
                    hotfixes: 0
                };
                if (HOTFIX_RE.test(version)) patchNode.hotfixes += 1;
                minorNode.patches.set(patch, patchNode);
            }

            majorNode.minors.set(minor, minorNode);
            majors.set(major, majorNode);
        }

        return {
            product,
            releases: versions.size,
            majors: Array.from(majors.values())
                .sort((a, b) => compareNumbers(b.version, a.version))
                .map(major => ({
                    ...major,
                    minors: Array.from(major.minors.values())
                        .sort((a, b) => compareNumbers(b.version.split('.')[1], a.version.split('.')[1]))
                        .map(minor => ({
                            ...minor,
                            patches: Array.from(minor.patches.values())
                                .sort((a, b) => compareNumbers(
                                    b.version.split('.')[2],
                                    a.version.split('.')[2]
                                ))
                        }))
                }))
        };
    }).sort((a, b) => a.product.localeCompare(b.product));
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function plural(count, singular, pluralForm = `${singular}s`) {
    return `${count.toLocaleString('en-US')} ${count === 1 ? singular : pluralForm}`;
}

function renderProduct({ product, releases, majors }, productIndex) {
    const rows = majors.flatMap((major, majorIndex) => {
        const majorId = `p${productIndex}-major-${majorIndex}`;
        return [
        `<tr class="stats-major"><th scope="row"><button class="stats-toggle" type="button" aria-expanded="false" aria-controls="${majorId}"><span class="version-label">${major.version}</span></button></th><td>${plural(major.releases, 'release')}</td></tr>`,
        ...major.minors.flatMap((minor, minorIndex) => {
            const minorId = `${majorId}-minor-${minorIndex}`;
            return [
            `<tr class="stats-minor" id="${majorId}-${minorIndex}" data-stats-parent="${majorId}" hidden><th scope="row"><button class="stats-toggle" type="button" aria-expanded="false" aria-controls="${minorId}"><span class="version-label">${minor.version}</span></button></th><td>${plural(minor.releases, 'release')}</td></tr>`,
            ...minor.patches.map(patch =>
                `<tr class="stats-patch" data-stats-parent="${minorId}" hidden><th scope="row"><span class="version-label">${patch.version}</span></th><td>${plural(patch.hotfixes, 'hotfix', 'hotfixes')}</td></tr>`
            )
        ];
        })
    ];
    }).join('\n');

    return `        <section class="stats-product">
            <h2>${escapeHtml(product)} <span class="stats-product-total">${plural(releases, 'release')}</span></h2>
            <div class="stats-table-wrap">
                <table class="stats-table">
                    <thead><tr><th scope="col">Version</th><th scope="col">Count</th></tr></thead>
                    <tbody>
${rows}
                    </tbody>
                </table>
            </div>
        </section>`;
}

export function renderStatisticsPage(statistics) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Release statistics - Firewall issues tool</title>
    <link rel="icon" href="favicon.ico" sizes="any">
    <link rel="icon" type="image/svg+xml" href="icons/favicon.svg">
    <link rel="apple-touch-icon" href="apple-touch-icon.png">
    <link rel="apple-touch-icon-precomposed" href="apple-touch-icon-precomposed.png">
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <header>
        <h1>Release statistics</h1>
        <nav class="top-links" aria-label="Primary">
            <a href="index.html">Issues</a>
            <a href="statistics.html" aria-current="page">Statistics</a>
            <a href="process.html">Add data</a>
            <a href="https://github.com/aaronaxvig/firewallissues" target="_blank" rel="noopener noreferrer">Source code</a>
        </nav>
    </header>
    <main class="statistics-container">
        <p class="statistics-intro">Explore addressed Issue-IDs by product and release.</p>
        <section class="issue-plot" aria-labelledby="issue-plot-heading">
            <div class="issue-plot-heading">
                <div>
                    <h2 id="issue-plot-heading">Addressed issues by release</h2>
                    <p>Each dot is an Issue-ID. Hover for details or select a dot to find that issue.</p>
                </div>
                <div class="issue-plot-controls">
                    <label>Product
                        <select id="issue-plot-product"></select>
                    </label>
                    <label>Release train
                        <select id="issue-plot-train"></select>
                    </label>
                </div>
            </div>
            <div class="issue-plot-frame">
                <canvas id="issue-plot-canvas" role="img" aria-label="Scatter plot of addressed Issue-IDs by release"></canvas>
                <div id="issue-plot-tooltip" class="issue-plot-tooltip" role="status" hidden></div>
            </div>
            <p id="issue-plot-summary" class="issue-plot-summary" aria-live="polite"></p>
        </section>
    </main>
    <script type="module" src="js/statistics.js"></script>
</body>
</html>
`;
}

export async function generateReleaseStatistics({ issuesDir, outputPath, plotDataDir = join(dirname(outputPath), 'data/statistics') }) {
    const records = await collectIssueFiles(issuesDir);
    const statistics = buildReleaseStatistics(records);
    const plotData = await buildIssuePlotData(records, issuesDir);
    await mkdir(dirname(outputPath), { recursive: true });
    await mkdir(plotDataDir, { recursive: true });
    const plotProducts = [];
    for (const item of plotData) {
        const filename = productDataFilename(item.product);
        await writeFile(join(plotDataDir, filename), JSON.stringify(item), 'utf8');
        plotProducts.push([item.product, filename]);
    }
    await writeFile(join(plotDataDir, 'products.json'), JSON.stringify(plotProducts), 'utf8');
    await writeFile(outputPath, renderStatisticsPage(statistics), 'utf8');
    return {
        products: statistics.length,
        releases: statistics.reduce((sum, item) => sum + item.releases, 0),
        points: plotData.reduce((sum, item) => sum + item.points.length, 0)
    };
}

export async function runGenerateStatisticsCli() {
    const result = await generateReleaseStatistics({
        issuesDir: join(REPO_ROOT, 'web/data/issues'),
        outputPath: join(REPO_ROOT, 'web/statistics.html')
    });
    console.log(`Generated release statistics for ${result.products} product(s) and ${result.releases} release(s).`);
    return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    await runGenerateStatisticsCli();
}
