#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectIssueFiles } from './update-products-from-issues.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_RE = /^(?<major>\d+)(?:\.(?<minor>\d+))?(?:\.(?<patch>\d+))?(?<rest>.*)$/;
const HOTFIX_RE = /-h\d+(?:\D|$)/i;

function compareNumbers(left, right) {
    return Number(left) - Number(right);
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
        <p class="statistics-intro">Unique releases represented in the issue data. Major and minor rows include all releases beneath them; patch rows count hotfix releases.</p>
${statistics.map(renderProduct).join('\n')}
    </main>
    <script type="module" src="js/statistics.js"></script>
</body>
</html>
`;
}

export async function generateReleaseStatistics({ issuesDir, outputPath }) {
    const records = await collectIssueFiles(issuesDir);
    const statistics = buildReleaseStatistics(records);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, renderStatisticsPage(statistics), 'utf8');
    return { products: statistics.length, releases: statistics.reduce((sum, item) => sum + item.releases, 0) };
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
