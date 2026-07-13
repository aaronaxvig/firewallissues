// Adapts pure state codecs to CheckboxTree's rendered node model and URL format.
import {
    PATH_DELIMITER,
    SERIALIZATION_VERSION,
    asManifestSource as asManifest,
    assertStateEncoding,
    base64UrlToBytes,
    bytesToBase64Url,
    decodeAdaptiveBitset,
    decodeDenseBitset,
    encodeAdaptiveBitset,
    encodeDenseBitset,
    maximumEncodedLength
} from './state-codec.js';

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

function collectTreeValues(tree, manifest) {
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

    return { normalized, checkedValues, expandedValues };
}

function nodeState(tree, node) {
    const item = tree.itemForNode(node.id);
    const checkbox = item && tree.directCheckbox(item);
    const toggle = item?.querySelector(':scope > .checkbox-tree__row > .checkbox-tree__toggle');
    return {
        checked: Boolean(checkbox?.checked),
        hasChecked: Boolean(checkbox),
        expanded: toggle?.getAttribute('aria-expanded') === 'true',
        hasExpanded: Boolean(toggle)
    };
}

function encodeTieredState(tree, normalized) {
    const checkedByDepth = new Map();
    const expandedByDepth = new Map();
    const statesByPath = new Map();

    for (const [path, node] of tree.nodesByPath) {
        const slot = normalized.pathToSlot.get(path);
        if (slot === undefined) continue;
        const depth = path.split(PATH_DELIMITER).length;
        const parentPath = path.includes(PATH_DELIMITER)
            ? path.slice(0, path.lastIndexOf(PATH_DELIMITER))
            : null;
        const parent = statesByPath.get(parentPath) ?? {
            checked: false,
            hasChecked: false,
            expanded: false,
            hasExpanded: false
        };
        const current = nodeState(tree, node);
        if (current.hasChecked) {
            checkedByDepth.set(depth, checkedByDepth.get(depth) ?? new Map());
            checkedByDepth.get(depth).set(slot, current.checked !== (parent.hasChecked ? parent.checked : false));
        }
        if (current.hasExpanded) {
            expandedByDepth.set(depth, expandedByDepth.get(depth) ?? new Map());
            expandedByDepth.get(depth).set(slot, current.expanded);
        }
        statesByPath.set(path, current);
    }

    const fields = new Map([['n', String(normalized.slots.length)]]);
    for (const [depth, values] of checkedByDepth) {
        const encoded = bytesToBase64Url(encodeAdaptiveBitset(values, normalized.slots.length));
        if (encoded) fields.set(`c${depth}`, encoded);
    }
    for (const [depth, values] of expandedByDepth) {
        const encoded = bytesToBase64Url(encodeAdaptiveBitset(values, normalized.slots.length));
        if (encoded) fields.set(`x${depth}`, encoded);
    }
    return fields;
}

export function encodeTreeState(tree, manifest, encoding = tree.options?.stateEncoding ?? 'adaptive') {
    assertStateEncoding(encoding);
    const { normalized, checkedValues, expandedValues } = collectTreeValues(tree, manifest);

    if (encoding === 'tiered') {
        return { version: SERIALIZATION_VERSION, encoding, fields: encodeTieredState(tree, normalized) };
    }

    const encode = encoding === 'dense' ? encodeDenseBitset : encodeAdaptiveBitset;
    const checkedValue = bytesToBase64Url(encode(checkedValues, normalized.slots.length));
    const expandedValue = bytesToBase64Url(encode(expandedValues, normalized.slots.length));
    return {
        version: SERIALIZATION_VERSION,
        encoding,
        checked: checkedValue || null,
        expanded: expandedValue || null
    };
}

function decodeField(params, name, normalized, encoding) {
    const maximumLength = encoding === 'dense'
        ? Math.ceil(normalized.slots.length / 8)
        : maximumEncodedLength(normalized.slots.length);
    const bytes = base64UrlToBytes(params.get(name) ?? '', maximumLength);
    const decode = encoding === 'dense' ? decodeDenseBitset : decodeAdaptiveBitset;
    decode(bytes, normalized.slots.length);
    return bytes;
}

export function decodeTreeState(fragment, manifest, encoding = 'adaptive') {
    assertStateEncoding(encoding);
    const normalized = asManifest(manifest);
    const value = fragment.startsWith('#') ? fragment.slice(1) : fragment;
    const params = new URLSearchParams(value);
    if (params.get('v') !== String(SERIALIZATION_VERSION)) {
        return { applied: false, version: params.get('v'), encoding, warnings: ['Missing or unsupported serialization version.'] };
    }
    try {
        if (encoding === 'tiered') {
            if (params.has('c') || params.has('x')) {
                throw new Error('Tiered tree state contains non-tiered fields.');
            }
            const maximumDepth = normalized.slots.reduce((depth, slot) =>
                slot.deleted ? depth : Math.max(depth, slot.path.split(PATH_DELIMITER).length)
            , 0);
            for (const key of params.keys()) {
                const match = /^([cx])(\d+)$/.exec(key);
                if (match && (Number(match[2]) < 1 || Number(match[2]) > maximumDepth)) {
                    throw new Error(`Tree state contains an invalid tier: ${key}`);
                }
            }
            const coverage = Number(params.get('n'));
            if (!Number.isSafeInteger(coverage) || coverage < 0 || coverage > normalized.slots.length) {
                throw new Error('Tiered tree state has invalid manifest coverage.');
            }
            const checkedTiers = new Map();
            const expandedTiers = new Map();
            for (let depth = 1; depth <= maximumDepth; depth++) {
                checkedTiers.set(depth, decodeField(params, `c${depth}`, normalized, 'adaptive'));
                expandedTiers.set(depth, decodeField(params, `x${depth}`, normalized, 'adaptive'));
            }
            return {
                applied: true,
                version: SERIALIZATION_VERSION,
                encoding,
                coverage,
                checkedTiers,
                expandedTiers,
                warnings: []
            };
        }

        for (const key of params.keys()) {
            if (key === 'n' || /^[cx]\d+$/.test(key)) {
                throw new Error('Tree state contains tiered fields for a non-tiered encoding.');
            }
        }

        const checked = decodeField(params, 'c', normalized, encoding);
        const expanded = decodeField(params, 'x', normalized, encoding);
        return {
            applied: true,
            version: SERIALIZATION_VERSION,
            encoding,
            checked,
            expanded,
            warnings: []
        };
    } catch (error) {
        return { applied: false, version: SERIALIZATION_VERSION, encoding, warnings: [error.message] };
    }
}

export function applyTreeState(tree, manifest, state) {
    if (!state?.applied) return false;
    const normalized = asManifest(manifest);
    if (state.encoding === 'tiered') return applyTieredTreeState(tree, normalized, state);
    let isChecked;
    let isExpanded;
    try {
        const decode = state.encoding === 'dense' ? decodeDenseBitset : decodeAdaptiveBitset;
        isChecked = decode(state.checked, normalized.slots.length);
        isExpanded = decode(state.expanded, normalized.slots.length);
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

function applyTieredTreeState(tree, normalized, state) {
    const resolvedByPath = new Map();
    const checkedDecoders = new Map();
    const expandedDecoders = new Map();
    try {
        for (const [depth, bytes] of state.checkedTiers) {
            checkedDecoders.set(depth, decodeAdaptiveBitset(bytes, normalized.slots.length));
        }
        for (const [depth, bytes] of state.expandedTiers) {
            expandedDecoders.set(depth, decodeAdaptiveBitset(bytes, normalized.slots.length));
        }
    } catch {
        return false;
    }

    for (const [path, node] of tree.nodesByPath) {
        const slot = normalized.pathToSlot.get(path);
        if (slot === undefined) continue;
        const depth = path.split(PATH_DELIMITER).length;
        const parentPath = path.includes(PATH_DELIMITER)
            ? path.slice(0, path.lastIndexOf(PATH_DELIMITER))
            : null;
        const parent = resolvedByPath.get(parentPath) ?? {
            checked: false,
            hasChecked: false,
            expanded: false,
            hasExpanded: false
        };
        const item = tree.itemForNode(node.id);
        const checkbox = item && tree.directCheckbox(item);
        const toggle = item?.querySelector(':scope > .checkbox-tree__row > .checkbox-tree__toggle');
        const isCovered = slot < state.coverage;
        const checked = checkbox && isCovered
            ? (parent.hasChecked ? parent.checked : false) !== checkedDecoders.get(depth)(slot)
            : false;
        const expanded = Boolean(toggle && isCovered && expandedDecoders.get(depth)(slot));
        if (checkbox && !checkbox.disabled) checkbox.checked = checked;
        tree.setExpanded(item, expanded);
        resolvedByPath.set(path, {
            checked,
            hasChecked: Boolean(checkbox),
            expanded,
            hasExpanded: Boolean(toggle)
        });
    }
    tree.updateAllParentCheckboxes();
    return true;
}

export function serializeStateToFragment(tree, manifest, encoding = tree.options?.stateEncoding ?? 'adaptive') {
    const state = encodeTreeState(tree, manifest, encoding);
    const params = new URLSearchParams({ v: String(state.version) });
    if (state.encoding === 'tiered') {
        for (const [name, value] of state.fields) params.set(name, value);
    } else {
        if (state.checked) params.set('c', state.checked);
        if (state.expanded) params.set('x', state.expanded);
    }
    return `#${params}`;
}

export function restoreStateFromLocation(
    tree,
    manifest,
    location = window.location,
    encoding = tree.options?.stateEncoding ?? 'adaptive'
) {
    const state = decodeTreeState(location.hash ?? '', manifest, encoding);
    if (state.applied) applyTreeState(tree, manifest, state);
    return state;
}
