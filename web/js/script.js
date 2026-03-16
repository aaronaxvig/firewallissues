import { loadIssuesForCheckedPaths } from './issues.js';
import { getCheckedFileRefs, initializeTree, renderProductTree, restoreTreeState } from './tree.js';
import { applyIssueSearchFilter, getIssueTypeFilters, initializeUI } from './ui.js';

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
    const childKeys = Object.keys(node).filter(key => key !== 'addressed' && key !== 'known');

    const transformedChildren = {};
    childKeys.forEach(key => {
        transformedChildren[key] = transformNode(node[key]);
    });

    if (!hasIssueArrays) {
        return transformedChildren;
    }

    const addressed = Array.isArray(node.addressed) ? node.addressed : [];
    const known = Array.isArray(node.known) ? node.known : [];
    const allFiles = [...addressed, ...known];

    if (allFiles.length === 0) {
        if (childKeys.length > 0) {
            return transformedChildren;
        }

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

    const transformedIssueFiles = groupHotfixPrefixes(groupedByPrefix);
    if (childKeys.length === 0) {
        return transformedIssueFiles;
    }

    return mergeTreeNodes(transformedChildren, transformedIssueFiles);
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

function mergeTreeNodes(left, right) {
    if (!isObjectNode(left)) {
        return right;
    }
    if (!isObjectNode(right)) {
        return left;
    }

    const merged = { ...left };

    Object.keys(right).forEach(key => {
        const leftValue = merged[key];
        const rightValue = right[key];

        if (key === 'addressed' || key === 'known') {
            const leftFiles = Array.isArray(leftValue) ? leftValue : [];
            const rightFiles = Array.isArray(rightValue) ? rightValue : [];
            merged[key] = Array.from(new Set([...leftFiles, ...rightFiles]));
            return;
        }

        if (isObjectNode(leftValue) && isObjectNode(rightValue)) {
            merged[key] = mergeTreeNodes(leftValue, rightValue);
            return;
        }

        merged[key] = rightValue;
    });

    return merged;
}

function isObjectNode(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
