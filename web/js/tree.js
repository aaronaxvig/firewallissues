import { CheckboxTree, loadManifest } from '../vendor/checkbox-tree/checkbox-tree.js';
import { getSortedKeys } from './sort.js';

const STORAGE_KEY = 'tree-state-v2';
let productTree = null;

export function initializeTree(containerId, onSelectionChange) {
    const container = document.getElementById(containerId);
    if (!container) {
        throw new Error(`Tree container not found: ${containerId}`);
    }

    productTree?.destroy();
    productTree = new CheckboxTree(container, {
        storageKey: STORAGE_KEY,
        initiallyCollapsed: true,
        onSelectionChange: event => {
            onSelectionChange(event);
            pushTreeState();
        }
    });

    container.addEventListener('click', event => {
        if (event.target.closest('.checkbox-tree__toggle')) {
            pushTreeState();
        }
    });
    window.addEventListener('popstate', () => {
        productTree?.restoreStateFromLocation();
        onSelectionChange({
            selectedIds: productTree?.getSelectedIds() ?? [],
            selectedNodes: productTree?.getSelectedNodes() ?? []
        });
    });
}

export async function renderProductTree(productsData) {
    const manifestSource = await fetch('data/product-tree-manifest.json').then(response => response.json());
    requireTree().options.manifest = loadManifest(manifestSource);
    requireTree().setData(toTreeNodes(productsData));
}

export function getCheckedPaths() {
    return productTree ? productTree.getSelectedNodes().map(node => node.metadata.path) : [];
}

export function getCheckedFileRefs() {
    const addressedFiles = [];
    const knownFiles = [];

    productTree?.getSelectedNodes().forEach(node => {
        const { path, addressed = [], known = [] } = node.metadata;
        const productKey = path[0];
        addressed.forEach(fileName => addressedFiles.push({ productKey, fileName }));
        known.forEach(fileName => knownFiles.push({ productKey, fileName }));
    });

    return {
        addressedFiles: dedupeFileRefs(addressedFiles),
        knownFiles: dedupeFileRefs(knownFiles)
    };
}

// State restoration now happens when setData renders the generic tree.
export function restoreTreeState() {}

function requireTree() {
    if (!productTree) {
        throw new Error('Tree is not initialized. Call initializeTree first.');
    }
    return productTree;
}

function pushTreeState() {
    if (!productTree?.options.manifest) {
        return;
    }
    const url = new URL(window.location.href);
    url.hash = productTree.serializeStateToFragment();
    if (url.href !== window.location.href) {
        history.pushState(null, '', url);
    }
}

function toTreeNodes(value, path = []) {
    return getSortedKeys(value)
        .filter(key => key !== 'addressed' && key !== 'known')
        .map(key => {
            const childValue = value[key];
            const childPath = [...path, key];
            const isObject = childValue && typeof childValue === 'object';
            const hasFiles = isObject && ('addressed' in childValue || 'known' in childValue);
            const children = isObject ? toTreeNodes(childValue, childPath) : [];

            return {
                id: JSON.stringify(childPath),
                label: key,
                selectable: hasFiles || children.length > 0,
                metadata: {
                    path: childPath,
                    addressed: hasFiles && Array.isArray(childValue.addressed) ? childValue.addressed : [],
                    known: hasFiles && Array.isArray(childValue.known) ? childValue.known : []
                },
                ...(children.length > 0 ? { children } : {})
            };
        });
}

function dedupeFileRefs(fileRefs) {
    const seen = new Set();
    return fileRefs.filter(({ productKey, fileName }) => {
        if (!productKey || !fileName) {
            return false;
        }
        const key = `${productKey}::${fileName}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}
