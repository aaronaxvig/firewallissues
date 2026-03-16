import { getSortedKeys } from './sort.js';

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

        toggle.addEventListener('click', event => {
            event.stopPropagation();
            childrenContainer.classList.toggle('collapsed');
            toggle.textContent = childrenContainer.classList.contains('collapsed') ? '▶' : '▼';
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
