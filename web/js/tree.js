import { getSortedKeys } from './sort.js';

const STORAGE_KEY = 'tree-state';

let treeContainer = null;
let onSelectionChangeHandler = null;

export function initializeTree(containerId, onSelectionChange) {
    treeContainer = document.getElementById(containerId);
    onSelectionChangeHandler = onSelectionChange;
}

export function renderProductTree(productsData) {
    if (!treeContainer) {
        throw new Error('Tree is not initialized. Call initializeTree first.');
    }

    treeContainer.innerHTML = '';

    getSortedKeys(productsData).forEach(product => {
        const productNode = createTreeNode(product, productsData[product], [product]);
        treeContainer.appendChild(productNode);
    });
}

export function getCheckedPaths() {
    if (!treeContainer) {
        return [];
    }

    const checkedBoxes = treeContainer.querySelectorAll('input[type="checkbox"]:checked');

    return Array.from(checkedBoxes)
        .map(cb => cb.dataset.path)
        .filter(Boolean)
        .map(pathText => {
            try {
                return JSON.parse(pathText);
            } catch (error) {
                console.error('Invalid checkbox path data:', pathText, error);
                return null;
            }
        })
        .filter(pathArray => Array.isArray(pathArray) && pathArray.length > 0);
}

export function getCheckedFileRefs() {
    if (!treeContainer) {
        return {
            addressedFiles: [],
            knownFiles: []
        };
    }

    const addressedFiles = [];
    const knownFiles = [];
    const checkedBoxes = treeContainer.querySelectorAll('input[type="checkbox"]:checked[data-has-files="1"]');

    checkedBoxes.forEach(cb => {
        const pathText = cb.dataset.path;
        if (!pathText) {
            return;
        }

        let path;
        try {
            path = JSON.parse(pathText);
        } catch (error) {
            console.error('Invalid checkbox path data:', pathText, error);
            return;
        }

        if (!Array.isArray(path) || path.length === 0) {
            return;
        }

        const productKey = path[0];

        const addressed = parseJsonArray(cb.dataset.addressed);
        addressed.forEach(fileName => addressedFiles.push({ productKey, fileName }));

        const known = parseJsonArray(cb.dataset.known);
        known.forEach(fileName => knownFiles.push({ productKey, fileName }));
    });

    return {
        addressedFiles,
        knownFiles
    };
}

function createTreeNode(name, value, path) {
    const container = document.createElement('div');
    container.className = 'tree-item';

    const isLeafWithFiles = value && typeof value === 'object' && ('addressed' in value || 'known' in value);
    const hasChildren = value && typeof value === 'object' && !isLeafWithFiles && Object.keys(value).length > 0;

    if (hasChildren) {
        container.classList.add('parent');

        const toggle = document.createElement('span');
        toggle.className = 'tree-toggle';
        toggle.textContent = '▼';
        toggle.style.cursor = 'pointer';

        const label = document.createElement('label');
        const checkbox = createCheckbox(path);
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(name));

        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'tree-children';

        getSortedKeys(value).forEach(childKey => {
            const childNode = createTreeNode(childKey, value[childKey], [...path, childKey]);
            childrenContainer.appendChild(childNode);
        });

        if (shouldStartCollapsed(name, value)) {
            childrenContainer.classList.add('collapsed');
            toggle.textContent = '▶';
        }

        toggle.addEventListener('click', event => {
            event.stopPropagation();
            childrenContainer.classList.toggle('collapsed');
            toggle.textContent = childrenContainer.classList.contains('collapsed') ? '▶' : '▼';
            saveTreeState();
        });

        container.appendChild(toggle);
        container.appendChild(label);
        container.appendChild(childrenContainer);
        return container;
    }

    const label = document.createElement('label');
    if (isLeafWithFiles) {
        const checkbox = createCheckbox(path, value);
        label.appendChild(checkbox);
    }

    label.appendChild(document.createTextNode(name));
    container.appendChild(label);
    return container;
}

function shouldStartCollapsed(name, value) {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const childKeys = Object.keys(value);
    if (childKeys.length === 0) {
        return false;
    }

    const hotfixChildren = childKeys.filter(key => {
        const match = key.match(/^(.*)-h\d+$/i);
        return match && match[1] === name;
    });

    return hotfixChildren.length > 0;
}

function createCheckbox(path, value) {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = path.join('/');
    checkbox.dataset.path = JSON.stringify(path);

    if (value && typeof value === 'object' && ('addressed' in value || 'known' in value)) {
        checkbox.dataset.hasFiles = '1';
        checkbox.dataset.addressed = JSON.stringify(Array.isArray(value.addressed) ? value.addressed : []);
        checkbox.dataset.known = JSON.stringify(Array.isArray(value.known) ? value.known : []);
    }

    checkbox.addEventListener('change', event => {
        handleCheckboxChange(event);
    });

    return checkbox;
}

function parseJsonArray(value) {
    if (!value) {
        return [];
    }

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error('Invalid checkbox file metadata:', value, error);
        return [];
    }
}

function handleCheckboxChange(event) {
    const checkbox = event.target;
    const container = checkbox.closest('.tree-item');
    const childrenContainer = container.querySelector('.tree-children');

    if (childrenContainer) {
        const childCheckboxes = childrenContainer.querySelectorAll('input[type="checkbox"]');
        childCheckboxes.forEach(cb => {
            cb.checked = checkbox.checked;
            cb.indeterminate = false;
        });
    }

    checkbox.indeterminate = false;
    updateParentCheckboxes(checkbox);

    if (typeof onSelectionChangeHandler === 'function') {
        onSelectionChangeHandler();
    }
    saveTreeState();
}

function updateParentCheckboxes(checkbox) {
    let currentItem = checkbox.closest('.tree-item');
    let parentItem = currentItem.parentElement.closest('.tree-item');

    while (parentItem) {
        const parentLabel = parentItem.querySelector(':scope > label');
        if (!parentLabel) {
            parentItem = parentItem.parentElement.closest('.tree-item');
            continue;
        }

        const parentCheckbox = parentLabel.querySelector('input[type="checkbox"]');
        if (!parentCheckbox) {
            parentItem = parentItem.parentElement.closest('.tree-item');
            continue;
        }

        const children = parentItem.querySelectorAll(':scope > .tree-children > .tree-item > label > input[type="checkbox"]');
        const checkedCount = Array.from(children).filter(cb => cb.checked || cb.indeterminate).length;

        if (checkedCount === 0) {
            parentCheckbox.checked = false;
            parentCheckbox.indeterminate = false;
        } else if (checkedCount === children.length) {
            parentCheckbox.checked = true;
            parentCheckbox.indeterminate = false;
        } else {
            parentCheckbox.checked = false;
            parentCheckbox.indeterminate = true;
        }

        currentItem = parentItem;
        parentItem = currentItem.parentElement.closest('.tree-item');
    }
}

function saveTreeState() {
    if (!treeContainer) {
        return;
    }

    const checkedPaths = Array.from(
        treeContainer.querySelectorAll('input[type="checkbox"]:checked[data-has-files="1"]')
    ).map(cb => cb.dataset.path).filter(Boolean);

    const collapsedPaths = Array.from(
        treeContainer.querySelectorAll('.tree-children.collapsed')
    ).map(children => {
        const cb = children.parentElement.querySelector(':scope > label > input[type="checkbox"]');
        return cb?.dataset.path ?? null;
    }).filter(Boolean);

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ checkedPaths, collapsedPaths }));
    } catch {
        // Storage unavailable or quota exceeded — silently ignore
    }
}

export function restoreTreeState() {
    if (!treeContainer) {
        return;
    }

    let state;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return;
        }
        state = JSON.parse(raw);
    } catch {
        return;
    }

    if (!state || typeof state !== 'object') {
        return;
    }

    if (Array.isArray(state.checkedPaths) && state.checkedPaths.length > 0) {
        const checkedSet = new Set(state.checkedPaths);
        treeContainer.querySelectorAll('input[type="checkbox"][data-has-files="1"]').forEach(cb => {
            cb.checked = checkedSet.has(cb.dataset.path);
        });
        treeContainer.querySelectorAll('input[type="checkbox"][data-has-files="1"]:checked').forEach(cb => {
            updateParentCheckboxes(cb);
        });
    }

    if (Array.isArray(state.collapsedPaths)) {
        const collapsedSet = new Set(state.collapsedPaths);
        treeContainer.querySelectorAll('.tree-children').forEach(childrenDiv => {
            const cb = childrenDiv.parentElement.querySelector(':scope > label > input[type="checkbox"]');
            if (!cb) {
                return;
            }
            const toggle = childrenDiv.parentElement.querySelector(':scope > .tree-toggle');
            const shouldBeCollapsed = collapsedSet.has(cb.dataset.path);
            const isCollapsed = childrenDiv.classList.contains('collapsed');
            if (shouldBeCollapsed !== isCollapsed) {
                childrenDiv.classList.toggle('collapsed');
                if (toggle) {
                    toggle.textContent = shouldBeCollapsed ? '▶' : '▼';
                }
            }
        });
    }
}
