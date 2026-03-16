import { loadIssuesForCheckedPaths } from './js/issues.js';
import { getCheckedFileRefs, initializeTree, renderProductTree } from './js/tree.js';
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

        const grouped = {};

        addressed.forEach(fileName => {
            const prefix = getFilePrefix(fileName);
            if (!grouped[prefix]) {
                grouped[prefix] = { addressed: [], known: [] };
            }
            grouped[prefix].addressed.push(fileName);
        });

        known.forEach(fileName => {
            const prefix = getFilePrefix(fileName);
            if (!grouped[prefix]) {
                grouped[prefix] = { addressed: [], known: [] };
            }
            grouped[prefix].known.push(fileName);
        });

        return grouped;
    }

    const transformed = {};
    Object.keys(node).forEach(key => {
        transformed[key] = transformNode(node[key]);
    });
    return transformed;
}

function getFilePrefix(fileName) {
    const baseName = String(fileName || '');
    const underscoreIndex = baseName.indexOf('_');
    if (underscoreIndex <= 0) {
        return baseName.replace(/\.json$/i, '') || 'unknown';
    }
    return baseName.slice(0, underscoreIndex);
}
