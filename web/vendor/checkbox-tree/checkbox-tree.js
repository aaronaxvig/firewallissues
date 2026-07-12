const DEFAULT_OPTIONS = {
    initiallyCollapsed: true,
    initiallySelected: false,
    storageKey: null,
    onSelectionChange: null,
    manifest: null
};

const SERIALIZATION_VERSION = 1;
const PATH_DELIMITER = '>';

export function loadManifest(source) {
    let records;
    let schema = 1;

    if (typeof source === 'string') {
        records = source.split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))
            .map(line => line === '!deleted' ? null : line);
    } else if (source && typeof source === 'object' && Array.isArray(source.nodes)) {
        schema = source.schema;
        records = source.nodes;
    } else if (source && Array.isArray(source.slots)) {
        return normalizeManifest(source.schema, source.slots.map(slot => slot?.deleted ? null : slot?.path));
    } else {
        throw new TypeError('CheckboxTree manifest must be text or an object with a nodes array.');
    }

    return normalizeManifest(schema, records);
}

function normalizeManifest(schema, records) {
    if (schema !== 1) {
        throw new Error(`Unsupported CheckboxTree manifest schema: ${schema}`);
    }

    const pathToSlot = new Map();
    const slots = records.map((record, index) => {
        if (record === null || record === '!deleted') {
            return { path: null, deleted: true };
        }
        if (typeof record !== 'string' || !record || record.trim() !== record) {
            throw new TypeError(`Invalid CheckboxTree manifest entry at slot ${index}.`);
        }
        if (pathToSlot.has(record)) {
            throw new Error(`Duplicate CheckboxTree manifest path: ${record}`);
        }
        pathToSlot.set(record, index);
        return { path: record, deleted: false };
    });

    return { schema: 1, slots, pathToSlot };
}

export function setBit(bytes, bitIndex, value) {
    const byteIndex = Math.floor(bitIndex / 8);
    const mask = 1 << (bitIndex % 8);
    if (value) bytes[byteIndex] |= mask;
    else bytes[byteIndex] &= ~mask;
}

export function getBit(bytes, bitIndex) {
    const byteIndex = Math.floor(bitIndex / 8);
    return byteIndex < bytes.length && (bytes[byteIndex] & (1 << (bitIndex % 8))) !== 0;
}

export function bytesToBase64Url(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(value, maximumLength = Infinity) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) {
        throw new Error('Invalid Base64URL value.');
    }
    if (Number.isFinite(maximumLength) && value.length > Math.ceil(maximumLength * 4 / 3) + 2) {
        throw new Error('Encoded tree state exceeds the manifest size.');
    }
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
    if (binary.length > maximumLength) throw new Error('Encoded tree state exceeds the manifest size.');
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function trimTrailingZeroBytes(bytes) {
    let end = bytes.length;
    while (end && bytes[end - 1] === 0) end--;
    return bytes.slice(0, end);
}

function encodeUnsignedVarint(value) {
    const bytes = [];
    do {
        let byte = value & 0x7f;
        value = Math.floor(value / 128);
        if (value) byte |= 0x80;
        bytes.push(byte);
    } while (value);
    return bytes;
}

function decodeUnsignedVarint(bytes, offset) {
    let value = 0;
    let multiplier = 1;
    for (let index = offset; index < bytes.length && index < offset + 8; index++) {
        const byte = bytes[index];
        value += (byte & 0x7f) * multiplier;
        if ((byte & 0x80) === 0) return { value, offset: index + 1 };
        multiplier *= 128;
        if (!Number.isSafeInteger(value) || !Number.isSafeInteger(multiplier)) break;
    }
    throw new Error('Invalid adaptive tree-state integer.');
}

function encodeSparseIndexes(indexes) {
    const bytes = [];
    let previous = -1;
    for (const index of indexes) {
        bytes.push(...encodeUnsignedVarint(index - previous - 1));
        previous = index;
    }
    return bytes;
}

function decodeSparseIndexes(bytes, offset, limit) {
    const indexes = new Set();
    let previous = -1;
    while (offset < bytes.length) {
        const decoded = decodeUnsignedVarint(bytes, offset);
        const index = previous + decoded.value + 1;
        if (index >= limit) throw new Error('Sparse tree state contains an out-of-range slot.');
        indexes.add(index);
        previous = index;
        offset = decoded.offset;
    }
    return indexes;
}

export function encodeAdaptiveBitset(values, slotCount) {
    const enabled = [];
    const disabled = [];
    const denseBytes = new Uint8Array(Math.ceil(slotCount / 8));
    for (const [slot, value] of values) {
        (value ? enabled : disabled).push(slot);
        setBit(denseBytes, slot, value);
    }
    enabled.sort((left, right) => left - right);
    disabled.sort((left, right) => left - right);
    if (enabled.length === 0) return new Uint8Array();

    const candidates = [
        Uint8Array.from([0, ...trimTrailingZeroBytes(denseBytes)]),
        Uint8Array.from([1, ...encodeSparseIndexes(enabled)]),
        Uint8Array.from([2, ...encodeUnsignedVarint(slotCount), ...encodeSparseIndexes(disabled)])
    ];
    return candidates.reduce((shortest, candidate) =>
        candidate.length < shortest.length ? candidate : shortest
    );
}

export function decodeAdaptiveBitset(bytes, slotCount) {
    if (bytes.length === 0) return () => false;
    const mode = bytes[0];
    if (mode === 0) {
        const dense = bytes.slice(1);
        if (dense.length > Math.ceil(slotCount / 8)) {
            throw new Error('Dense tree state exceeds the manifest size.');
        }
        return slot => getBit(dense, slot);
    }
    if (mode === 1) {
        const enabled = decodeSparseIndexes(bytes, 1, slotCount);
        return slot => enabled.has(slot);
    }
    if (mode === 2) {
        const coverage = decodeUnsignedVarint(bytes, 1);
        if (coverage.value > slotCount) throw new Error('Tree-state coverage exceeds the manifest size.');
        const disabled = decodeSparseIndexes(bytes, coverage.offset, coverage.value);
        return slot => slot < coverage.value && !disabled.has(slot);
    }
    throw new Error('Unknown adaptive tree-state mode.');
}

function asManifest(manifest) {
    return manifest?.pathToSlot instanceof Map ? manifest : loadManifest(manifest);
}

export function validateManifest(manifest, tree) {
    const normalized = asManifest(manifest);
    const treePaths = new Set(tree.nodesByPath.keys());
    return {
        valid: Array.from(treePaths).every(path => normalized.pathToSlot.has(path)),
        unregisteredPaths: Array.from(treePaths).filter(path => !normalized.pathToSlot.has(path)),
        missingPaths: normalized.slots
            .filter(slot => !slot.deleted && !treePaths.has(slot.path))
            .map(slot => slot.path)
    };
}

export function validateManifestEvolution(previous, next) {
    const oldManifest = asManifest(previous);
    const newManifest = asManifest(next);
    const errors = [];

    if (newManifest.slots.length < oldManifest.slots.length) {
        errors.push('Manifest slots cannot be removed; use tombstones.');
    }
    oldManifest.slots.forEach((oldSlot, index) => {
        const newSlot = newManifest.slots[index];
        if (!newSlot) return;
        if (oldSlot.deleted && !newSlot.deleted) {
            errors.push(`Tombstoned slot ${index} cannot be reused.`);
        }
        if (!oldSlot.deleted && !newSlot.deleted && oldSlot.path !== newSlot.path) {
            errors.push(`Slot ${index} changed path; confirm this is a logical rename or move.`);
        }
    });

    return { valid: errors.length === 0, errors };
}

export function encodeTreeState(tree, manifest) {
    const normalized = asManifest(manifest);
    const checkedValues = new Map();
    const expandedValues = new Map();

    for (const [path, node] of tree.nodesByPath) {
        const slot = normalized.pathToSlot.get(path);
        if (slot === undefined) continue;
        const item = tree.itemForNode(node.id);
        const checkbox = item && tree.directCheckbox(item);
        const toggle = item?.querySelector(':scope > .checkbox-tree__row > .checkbox-tree__toggle');
        checkedValues.set(slot, Boolean(checkbox?.checked));
        expandedValues.set(slot, toggle?.getAttribute('aria-expanded') === 'true');
    }

    const checkedValue = bytesToBase64Url(encodeAdaptiveBitset(checkedValues, normalized.slots.length));
    const expandedValue = bytesToBase64Url(encodeAdaptiveBitset(expandedValues, normalized.slots.length));
    return { version: SERIALIZATION_VERSION, checked: checkedValue || null, expanded: expandedValue || null };
}

export function decodeTreeState(fragment, manifest) {
    const normalized = asManifest(manifest);
    const value = fragment.startsWith('#') ? fragment.slice(1) : fragment;
    const params = new URLSearchParams(value);
    if (params.get('v') !== String(SERIALIZATION_VERSION)) {
        return { applied: false, version: params.get('v'), warnings: ['Missing or unsupported serialization version.'] };
    }
    const maximumLength = Math.max(
        Math.ceil(normalized.slots.length / 8) + 1,
        normalized.slots.length * 2 + 10
    );
    try {
        const checked = base64UrlToBytes(params.get('c') ?? '', maximumLength);
        const expanded = base64UrlToBytes(params.get('x') ?? '', maximumLength);
        decodeAdaptiveBitset(checked, normalized.slots.length);
        decodeAdaptiveBitset(expanded, normalized.slots.length);
        return {
            applied: true,
            version: SERIALIZATION_VERSION,
            checked,
            expanded,
            warnings: []
        };
    } catch (error) {
        return { applied: false, version: SERIALIZATION_VERSION, warnings: [error.message] };
    }
}

export function applyTreeState(tree, manifest, state) {
    if (!state?.applied) return false;
    const normalized = asManifest(manifest);
    let isChecked;
    let isExpanded;
    try {
        isChecked = decodeAdaptiveBitset(state.checked, normalized.slots.length);
        isExpanded = decodeAdaptiveBitset(state.expanded, normalized.slots.length);
    } catch {
        return false;
    }
    for (const [path, node] of tree.nodesByPath) {
        const slot = normalized.pathToSlot.get(path);
        if (slot === undefined) continue;
        const item = tree.itemForNode(node.id);
        const checkbox = item && tree.directCheckbox(item);
        if (checkbox && !checkbox.disabled) checkbox.checked = isChecked(slot);
        tree.setExpanded(item, isExpanded(slot));
    }
    tree.updateAllParentCheckboxes();
    return true;
}

export function serializeStateToFragment(tree, manifest) {
    const state = encodeTreeState(tree, manifest);
    const params = new URLSearchParams({ v: String(state.version) });
    if (state.checked) params.set('c', state.checked);
    if (state.expanded) params.set('x', state.expanded);
    return `#${params}`;
}

export function restoreStateFromLocation(tree, manifest, location = window.location) {
    const state = decodeTreeState(location.hash ?? '', manifest);
    if (state.applied) applyTreeState(tree, manifest, state);
    return state;
}

export class CheckboxTree {
    constructor(container, options = {}) {
        if (!(container instanceof Element)) {
            throw new TypeError('CheckboxTree requires a container element.');
        }

        this.container = container;
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.nodesById = new Map();
        this.nodesByPath = new Map();
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
        return Array.from(this.container.querySelectorAll('.checkbox-tree__item'))
            .find(item => item.dataset.nodeId === id) ?? null;
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
