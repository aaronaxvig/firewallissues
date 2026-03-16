import { loadIssuesForCheckedPaths } from './js/issues.js';
import { getCheckedFileRefs, initializeTree, renderProductTree, restoreTreeState } from './js/tree.js';
import { applyIssueSearchFilter, getIssueTypeFilters, initializeUI } from './js/ui.js';

document.addEventListener('DOMContentLoaded', () => {
    initializeUI({ onSelectionChange: refreshIssuesForCurrentSelection });
    initializeTree('product-tree', refreshIssuesForCurrentSelection);
    loadProductTree();
});

let productsData = {};

function refreshIssuesForCurrentSelection() {
    loadIssuesForCheckedPaths({
        issueTypeFilters: getIssueTypeFilters(),
        checkedFileRefs: getCheckedFileRefs(),
        applyIssueSearchFilter
    });
}

function loadProductTree() {
    fetch('data/products.json')
        .then(response => response.json())
        .then(data => {
            productsData = expandFilePrefixLevel(data);
            renderProductTree(productsData);
            restoreTreeState();
            refreshIssuesForCurrentSelection();
        })
        .catch(error => console.error('Error loading products:', error));
}

function expandFilePrefixLevel(root) {
    if (!root || typeof root !== 'object') {
        return root;
    }

    return transformNode(root);
}

function transformNode(node) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
        return node;
    }

    const hasIssueArrays = Object.prototype.hasOwnProperty.call(node, 'addressed') ||
        Object.prototype.hasOwnProperty.call(node, 'known');

    if (hasIssueArrays) {
        const addressed = Array.isArray(node.addressed) ? node.addressed : [];
        const known = Array.isArray(node.known) ? node.known : [];
        const allFiles = [...addressed, ...known];

        if (allFiles.length === 0) {
            return {
                addressed: [],
                known: []
            };
        }

        const groupedByPrefix = {};

        addressed.forEach(fileName => {
            const prefix = getFilePrefix(fileName);
            if (!groupedByPrefix[prefix]) {
                groupedByPrefix[prefix] = { addressed: [], known: [] };
            }
            groupedByPrefix[prefix].addressed.push(fileName);
        });

        known.forEach(fileName => {
            const prefix = getFilePrefix(fileName);
            if (!groupedByPrefix[prefix]) {
                groupedByPrefix[prefix] = { addressed: [], known: [] };
            }
            groupedByPrefix[prefix].known.push(fileName);
        });

        return groupHotfixPrefixes(groupedByPrefix);
    }

    const transformed = {};
    Object.keys(node).forEach(key => {
        transformed[key] = transformNode(node[key]);
    });
    return transformed;
}

function groupHotfixPrefixes(groupedByPrefix) {
    const byFamily = {};

    Object.keys(groupedByPrefix).forEach(prefix => {
        const family = getReleaseFamily(prefix);
        if (!byFamily[family]) {
            byFamily[family] = [];
        }
        byFamily[family].push(prefix);
    });

    const result = {};

    Object.keys(byFamily).forEach(family => {
        const members = byFamily[family];
        const hasHotfixes = members.length > 1 || members.some(member => member !== family);

        if (!hasHotfixes && members[0] === family) {
            result[family] = groupedByPrefix[family];
            return;
        }

        const branch = {};
        members.forEach(member => {
            branch[member] = groupedByPrefix[member];
        });
        result[family] = branch;
    });

    return result;
}

function getReleaseFamily(prefix) {
    return String(prefix || '').replace(/-h\d+$/i, '');
}

function getFilePrefix(fileName) {
    const baseName = String(fileName || '');
    const underscoreIndex = baseName.indexOf('_');
    if (underscoreIndex <= 0) {
        return baseName.replace(/\.json$/i, '') || 'unknown';
    }
    return baseName.slice(0, underscoreIndex);
}
