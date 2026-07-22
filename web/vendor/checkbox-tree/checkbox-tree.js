// Dependency-free checkbox tree widget. State serialization lives in focused sibling modules.
import {
    PATH_DELIMITER,
    assertStateEncoding
} from './state-codec.js';
import {
    restoreStateFromLocation,
    serializeStateToFragment,
    validateManifest
} from './tree-state.js';

export {
    PATH_DELIMITER,
    SERIALIZATION_VERSION,
    base64UrlToBytes,
    bytesToBase64Url,
    decodeAdaptiveBitset,
    encodeAdaptiveBitset,
    getBit,
    loadManifest,
    setBit
} from './state-codec.js';
export {
    applyTreeState,
    decodeTreeState,
    encodeTreeState,
    restoreStateFromLocation,
    serializeStateToFragment,
    validateManifest,
    validateManifestEvolution
} from './tree-state.js';

const DEFAULT_OPTIONS = {
    initiallyCollapsed: true,
    initiallySelected: false,
    storageKey: null,
    onSelectionChange: null,
    manifest: null,
    stateEncoding: 'adaptive'
};

export class CheckboxTree {
    constructor(container, options = {}) {
        if (!(container instanceof Element)) {
            throw new TypeError('CheckboxTree requires a container element.');
        }

        this.container = container;
        this.options = { ...DEFAULT_OPTIONS, ...options };
        assertStateEncoding(this.options.stateEncoding);
        this.nodesById = new Map();
        this.nodesByPath = new Map();
        this.itemsById = new Map();
        this.rootNodes = [];
        this.handleChange = this.handleChange.bind(this);
        this.handleClick = this.handleClick.bind(this);

        this.container.classList.add('checkbox-tree');
        this.container.addEventListener('change', this.handleChange);
        this.container.addEventListener('click', this.handleClick);
    }

    setData(nodes) {
        if (!Array.isArray(nodes)) {
            throw new TypeError('CheckboxTree data must be an array of nodes.');
        }

        this.nodesById.clear();
        this.nodesByPath.clear();
        this.itemsById.clear();
        this.rootNodes = nodes;
        this.indexNodes(nodes);
        this.render();
        this.updateAllParentCheckboxes();
        this.restoreState();
        if (this.options.manifest) this.restoreStateFromLocation();
    }

    getSelectedIds() {
        return this.getSelectedNodes().map(node => node.id);
    }

    getSelectedNodes() {
        return Array.from(this.container.querySelectorAll(
            '.checkbox-tree__checkbox:checked[data-selectable="true"]'
        )).map(checkbox => this.nodesById.get(checkbox.dataset.nodeId)).filter(Boolean);
    }

    setSelectedIds(ids, { notify = false } = {}) {
        const selectedIds = new Set(ids);
        this.container.querySelectorAll('.checkbox-tree__checkbox').forEach(checkbox => {
            checkbox.checked = checkbox.dataset.selectable === 'true' && selectedIds.has(checkbox.dataset.nodeId);
            checkbox.indeterminate = false;
        });
        this.updateAllParentCheckboxes();
        this.saveState();

        if (notify) {
            this.notifySelectionChange();
        }
    }

    destroy() {
        this.container.removeEventListener('change', this.handleChange);
        this.container.removeEventListener('click', this.handleClick);
        this.container.classList.remove('checkbox-tree');
        this.container.replaceChildren();
        this.nodesById.clear();
        this.nodesByPath.clear();
        this.itemsById.clear();
    }

    indexNodes(nodes, parentPath = '') {
        nodes.forEach(node => {
            if (!node || typeof node.id !== 'string' || !node.id || typeof node.label !== 'string') {
                throw new TypeError('Each CheckboxTree node requires non-empty string id and label properties.');
            }
            if (this.nodesById.has(node.id)) {
                throw new Error(`Duplicate CheckboxTree node id: ${node.id}`);
            }

            if (node.id.includes(PATH_DELIMITER)) {
                throw new Error(`CheckboxTree node id cannot contain "${PATH_DELIMITER}": ${node.id}`);
            }

            this.nodesById.set(node.id, node);
            const path = parentPath ? `${parentPath}${PATH_DELIMITER}${node.id}` : node.id;
            this.nodesByPath.set(path, node);
            if (node.children !== undefined) {
                if (!Array.isArray(node.children)) {
                    throw new TypeError(`CheckboxTree node children must be an array: ${node.id}`);
                }
                this.indexNodes(node.children, path);
            }
        });
    }

    render() {
        const fragment = document.createDocumentFragment();
        this.rootNodes.forEach(node => fragment.appendChild(this.createNodeElement(node)));
        this.container.replaceChildren(fragment);
    }

    createNodeElement(node) {
        const item = document.createElement('div');
        item.className = 'checkbox-tree__item';
        item.dataset.nodeId = node.id;
        this.itemsById.set(node.id, item);

        const row = document.createElement('div');
        row.className = 'checkbox-tree__row';
        const hasChildren = Array.isArray(node.children) && node.children.length > 0;

        if (hasChildren) {
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'checkbox-tree__toggle';
            toggle.dataset.action = 'toggle';
            toggle.setAttribute('aria-label', `Expand ${node.label}`);
            toggle.setAttribute('aria-expanded', 'false');
            toggle.textContent = '▶';
            row.appendChild(toggle);
        } else {
            const spacer = document.createElement('span');
            spacer.className = 'checkbox-tree__toggle-spacer';
            spacer.setAttribute('aria-hidden', 'true');
            row.appendChild(spacer);
        }

        const label = document.createElement('label');
        label.className = 'checkbox-tree__label';
        if (node.selectable !== false) {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'checkbox-tree__checkbox';
            checkbox.dataset.nodeId = node.id;
            checkbox.dataset.selectable = 'true';
            checkbox.disabled = node.disabled === true;
            checkbox.checked = this.options.initiallySelected && !checkbox.disabled;
            label.appendChild(checkbox);
        }
        label.appendChild(document.createTextNode(node.label));
        row.appendChild(label);
        item.appendChild(row);

        if (hasChildren) {
            const children = document.createElement('div');
            children.className = 'checkbox-tree__children';
            children.hidden = this.options.initiallyCollapsed;
            node.children.forEach(child => children.appendChild(this.createNodeElement(child)));
            item.appendChild(children);

            if (!this.options.initiallyCollapsed) {
                this.setExpanded(item, true);
            }
        }

        return item;
    }

    handleClick(event) {
        const toggle = event.target.closest('.checkbox-tree__toggle[data-action="toggle"]');
        if (!toggle || !this.container.contains(toggle)) {
            return;
        }

        const item = toggle.closest('.checkbox-tree__item');
        this.setExpanded(item, toggle.getAttribute('aria-expanded') !== 'true');
        this.saveState();
    }

    handleChange(event) {
        const checkbox = event.target.closest('.checkbox-tree__checkbox');
        if (!checkbox || !this.container.contains(checkbox)) {
            return;
        }

        const item = checkbox.closest('.checkbox-tree__item');
        const children = this.directChildrenContainer(item);
        if (children) {
            children.querySelectorAll('.checkbox-tree__checkbox:not(:disabled)').forEach(child => {
                child.checked = checkbox.checked;
                child.indeterminate = false;
            });
        }

        checkbox.indeterminate = false;
        this.updateAncestorCheckboxes(item);
        this.saveState();
        this.notifySelectionChange();
    }

    notifySelectionChange() {
        if (typeof this.options.onSelectionChange === 'function') {
            this.options.onSelectionChange({
                selectedIds: this.getSelectedIds(),
                selectedNodes: this.getSelectedNodes()
            });
        }
    }

    setExpanded(item, expanded) {
        if (!item) return;
        const toggle = item.querySelector(':scope > .checkbox-tree__row > .checkbox-tree__toggle');
        const children = this.directChildrenContainer(item);
        if (!toggle || !children) {
            return;
        }

        children.hidden = !expanded;
        toggle.setAttribute('aria-expanded', String(expanded));
        const label = this.nodesById.get(item.dataset.nodeId)?.label ?? 'branch';
        toggle.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} ${label}`);
    }

    directChildrenContainer(item) {
        return item.querySelector(':scope > .checkbox-tree__children');
    }

    directCheckbox(item) {
        return item.querySelector(':scope > .checkbox-tree__row .checkbox-tree__checkbox');
    }

    itemForNode(id) {
        return this.itemsById.get(id) ?? null;
    }

    updateAncestorCheckboxes(item) {
        let parentItem = item.parentElement?.closest('.checkbox-tree__item');
        while (parentItem && this.container.contains(parentItem)) {
            this.updateParentCheckbox(parentItem);
            parentItem = parentItem.parentElement?.closest('.checkbox-tree__item');
        }
    }

    updateAllParentCheckboxes() {
        const parents = Array.from(this.container.querySelectorAll('.checkbox-tree__item'))
            .filter(item => this.directChildrenContainer(item));
        parents.reverse().forEach(item => this.updateParentCheckbox(item));
    }

    updateParentCheckbox(item) {
        const checkbox = this.directCheckbox(item);
        const children = this.directChildrenContainer(item);
        if (!checkbox || !children) {
            return;
        }

        const childCheckboxes = Array.from(children.querySelectorAll(
            ':scope > .checkbox-tree__item > .checkbox-tree__row .checkbox-tree__checkbox'
        )).filter(child => !child.disabled);
        const hasSelection = childCheckboxes.some(child => child.checked || child.indeterminate);
        const allSelected = childCheckboxes.length > 0 && childCheckboxes.every(child => child.checked);
        checkbox.checked = allSelected;
        checkbox.indeterminate = hasSelection && !allSelected;
    }

    saveState() {
        if (!this.options.storageKey) {
            return;
        }

        const collapsedIds = Array.from(this.container.querySelectorAll('.checkbox-tree__children[hidden]'))
            .map(children => children.parentElement.dataset.nodeId);
        try {
            localStorage.setItem(this.options.storageKey, JSON.stringify({
                version: 1,
                selectedIds: this.getSelectedIds(),
                collapsedIds
            }));
        } catch {
            // Persistence is optional; storage may be disabled or full.
        }
    }

    restoreState() {
        if (!this.options.storageKey) {
            return;
        }

        let state;
        try {
            state = JSON.parse(localStorage.getItem(this.options.storageKey));
        } catch {
            return;
        }
        if (!state || typeof state !== 'object') {
            return;
        }

        if (Array.isArray(state.selectedIds)) {
            this.setSelectedIds(state.selectedIds);
        }
        if (Array.isArray(state.collapsedIds)) {
            const collapsedIds = new Set(state.collapsedIds);
            this.container.querySelectorAll('.checkbox-tree__item').forEach(item => {
                if (this.directChildrenContainer(item)) {
                    this.setExpanded(item, !collapsedIds.has(item.dataset.nodeId));
                }
            });
        }
    }

    validateManifest(manifest = this.options.manifest) {
        return validateManifest(manifest, this);
    }

    serializeStateToFragment(manifest = this.options.manifest) {
        return serializeStateToFragment(this, manifest);
    }

    restoreStateFromLocation(manifest = this.options.manifest, location = window.location) {
        return restoreStateFromLocation(this, manifest, location);
    }
}
