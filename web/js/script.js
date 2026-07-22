import { loadIssuesForCheckedPaths } from './issues.js';
import { getCheckedFileRefs, initializeTree, renderProductTree, restoreTreeState } from './tree.js';
import { applyIssueSearchFilter, getIssueTypeFilters, initializeUI } from './ui.js';
import { expandFilePrefixLevel } from './product-tree-model.js';

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
        .then(async data => {
            productsData = expandFilePrefixLevel(data);
            await renderProductTree(productsData);
            restoreTreeState();
            refreshIssuesForCurrentSelection();
        })
        .catch(error => console.error('Error loading products:', error));
}
