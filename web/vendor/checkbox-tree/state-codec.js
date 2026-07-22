// Manifest parsing and binary codecs. This module has no DOM dependencies.
export const SERIALIZATION_VERSION = 1;
export const PATH_DELIMITER = '>';
const STATE_ENCODINGS = new Set(['adaptive', 'dense', 'tiered']);

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


export function encodeDenseBitset(values, slotCount) {
    const bytes = new Uint8Array(Math.ceil(slotCount / 8));
    for (const [slot, value] of values) setBit(bytes, slot, value);
    return trimTrailingZeroBytes(bytes);
}

export function decodeDenseBitset(bytes, slotCount) {
    if (bytes.length > Math.ceil(slotCount / 8)) {
        throw new Error('Dense tree state exceeds the manifest size.');
    }
    return slot => getBit(bytes, slot);
}

export function maximumEncodedLength(slotCount) {
    return Math.max(Math.ceil(slotCount / 8) + 1, slotCount * 2 + 10);
}

export function assertStateEncoding(encoding) {
    if (!STATE_ENCODINGS.has(encoding)) {
        throw new Error(`Unsupported CheckboxTree state encoding: ${encoding}`);
    }
}

export function asManifestSource(manifest) {
    return manifest?.pathToSlot instanceof Map ? manifest : loadManifest(manifest);
}
