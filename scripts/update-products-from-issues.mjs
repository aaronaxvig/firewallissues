#!/usr/bin/env node
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildProductTree, enumerateTreePaths } from '../web/js/product-tree-model.js';

const ISSUE_TYPES = new Set(['addressed', 'known']);
const VERSION_FILENAME_RE = /^(?<version>[^.]+(?:\.[^.]+)*)\.md$/;
const HOTFIX_RE = /^(?<base>\d+(?:\.\d+)*)(?:-h(?<hotfix>\d+))?$/;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function walkFiles(root) {
    const files = [];
    async function visit(directory) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) await visit(path);
            else if (entry.isFile()) files.push(path);
        }
    }
    await visit(root);
    return files.sort();
}

export async function collectIssueFiles(issuesDir) {
    const records = [];
    for (const filePath of await walkFiles(issuesDir)) {
        const parts = relative(issuesDir, filePath).split(/[\\/]/);
        if (parts.length !== 3) continue;
        const [product, issueType, filename] = parts;
        if (!ISSUE_TYPES.has(issueType)) continue;
        const match = VERSION_FILENAME_RE.exec(filename);
        if (!match) continue;
        records.push({ product, issueType, version: match.groups.version, filename });
    }
    return records;
}

function clearLeafIssueArrays(node) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    if ('addressed' in node || 'known' in node) {
        node.addressed = [];
        node.known = [];
        return;
    }
    Object.values(node).forEach(clearLeafIssueArrays);
}

function getPath(data, path) {
    let current = data;
    for (const key of path) {
        if (!current || typeof current !== 'object' || !(key in current)) return null;
        current = current[key];
    }
    return current;
}

function isIssueLeaf(node) {
    return Boolean(node) && typeof node === 'object' && ('addressed' in node || 'known' in node);
}

function pickTargetLeafPath(products, product, version) {
    const parts = version.split('.');
    const major = parts[0];
    const minor = parts.length > 1 ? `${parts[0]}.${parts[1]}` : major;
    for (const path of [[product, major, minor], [product, major], [product]]) {
        if (isIssueLeaf(getPath(products, path))) return path;
    }
    return null;
}

function parseReleasePrefix(prefix) {
    const match = HOTFIX_RE.exec(prefix);
    if (!match) return { base: [], hotfix: -1 };
    return {
        base: match.groups.base.split('.').map(Number),
        hotfix: match.groups.hotfix === undefined ? -1 : Number(match.groups.hotfix)
    };
}

function compareNumberArrays(left, right) {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index++) {
        const difference = (left[index] ?? -1) - (right[index] ?? -1);
        if (difference) return difference;
    }
    return 0;
}

function compareIssueFilenames(left, right) {
    const leftPrefix = left.replace(/\.[^.]+$/, '');
    const rightPrefix = right.replace(/\.[^.]+$/, '');
    const leftVersion = parseReleasePrefix(leftPrefix);
    const rightVersion = parseReleasePrefix(rightPrefix);
    return compareNumberArrays(leftVersion.base, rightVersion.base) ||
        Number(leftVersion.hotfix >= 0) - Number(rightVersion.hotfix >= 0) ||
        leftVersion.hotfix - rightVersion.hotfix ||
        left.localeCompare(right);
}

export function rebuildProducts(products, records) {
    clearLeafIssueArrays(products);
    const unmatched = [];
    records.sort((left, right) =>
        left.product.localeCompare(right.product) ||
        left.issueType.localeCompare(right.issueType) ||
        left.version.localeCompare(right.version)
    );

    for (const record of records) {
        const path = pickTargetLeafPath(products, record.product, record.version);
        if (!path) {
            unmatched.push(record);
            continue;
        }
        const leaf = getPath(products, path);
        const files = Array.isArray(leaf[record.issueType]) ? leaf[record.issueType] : [];
        leaf[record.issueType] = Array.from(new Set([...files, record.filename])).sort(compareIssueFilenames);
    }
    return { products, unmatched };
}

export function updateManifest(manifest, currentPaths) {
    if (!manifest || manifest.schema !== 1 || !Array.isArray(manifest.nodes)) {
        throw new Error('Product-tree manifest must use schema 1 with a nodes array.');
    }
    const active = new Set();
    manifest.nodes.forEach((path, slot) => {
        if (path === null) return;
        if (typeof path !== 'string' || !path) throw new Error(`Invalid manifest entry at slot ${slot}.`);
        if (active.has(path)) throw new Error(`Duplicate manifest path: ${path}`);
        active.add(path);
    });

    const current = new Set(currentPaths);
    const appended = currentPaths.filter(path => !active.has(path));
    manifest.nodes.push(...appended);
    const missing = Array.from(active).filter(path => !current.has(path));
    return { manifest, appended, missing };
}

export async function updateProductsFromIssues({ issuesDir, productsPath, manifestPath }) {
    const [productsText, manifestText, records] = await Promise.all([
        readFile(productsPath, 'utf8'),
        readFile(manifestPath, 'utf8'),
        collectIssueFiles(issuesDir)
    ]);
    if (records.length === 0) {
        throw new Error("No '<version>.md' issue files found; refusing to rewrite products.json");
    }
    const products = JSON.parse(productsText);
    if (!products || typeof products !== 'object' || Array.isArray(products)) {
        throw new Error('products.json must contain a top-level object.');
    }

    const rebuilt = rebuildProducts(products, records);
    const paths = enumerateTreePaths(buildProductTree(rebuilt.products));
    const manifestUpdate = updateManifest(JSON.parse(manifestText), paths);
    await writeFile(productsPath, `${JSON.stringify(rebuilt.products, null, 2)}\n`, 'utf8');
    if (manifestUpdate.appended.length > 0) {
        await writeFile(manifestPath, `${JSON.stringify(manifestUpdate.manifest, null, 2)}\n`, 'utf8');
    }
    return {
        records: records.length,
        unmatched: rebuilt.unmatched,
        appended: manifestUpdate.appended,
        missing: manifestUpdate.missing
    };
}

function parseArgs(argv) {
    const options = {
        issuesDir: join(REPO_ROOT, 'web/data/issues'),
        productsPath: join(REPO_ROOT, 'web/data/products.json'),
        manifestPath: join(REPO_ROOT, 'web/data/product-tree-manifest.json')
    };
    const flags = new Map([
        ['--issues-dir', 'issuesDir'],
        ['--products-json', 'productsPath'],
        ['--manifest-json', 'manifestPath']
    ]);
    for (let index = 0; index < argv.length; index += 2) {
        const property = flags.get(argv[index]);
        if (!property || argv[index + 1] === undefined) throw new Error(`Invalid argument: ${argv[index] ?? ''}`);
        options[property] = resolve(argv[index + 1]);
    }
    return options;
}

export async function runUpdateProductsCli(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    const result = await updateProductsFromIssues(options);
    console.log(`Updated ${options.productsPath} from ${result.records} issue files.`);
    console.log(`Appended ${result.appended.length} manifest path(s).`);
    if (result.missing.length) console.warn(`${result.missing.length} manifest path(s) are no longer rendered; slots were preserved.`);
    if (result.unmatched.length) console.warn(`${result.unmatched.length} issue file(s) did not match a products.json leaf.`);
    return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    await runUpdateProductsCli();
}
