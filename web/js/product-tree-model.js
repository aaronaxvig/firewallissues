import { getSortedKeys } from './sort.js';

export function expandFilePrefixLevel(root) {
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
    const transformedChildren = Object.fromEntries(
        childKeys.map(key => [key, transformNode(node[key])])
    );

    if (!hasIssueArrays) {
        return transformedChildren;
    }

    const addressed = Array.isArray(node.addressed) ? node.addressed : [];
    const known = Array.isArray(node.known) ? node.known : [];
    if (addressed.length + known.length === 0) {
        return childKeys.length > 0 ? transformedChildren : { addressed: [], known: [] };
    }

    const groupedByPrefix = {};
    for (const [issueType, files] of [['addressed', addressed], ['known', known]]) {
        for (const fileName of files) {
            const prefix = getFilePrefix(fileName);
            groupedByPrefix[prefix] ??= { addressed: [], known: [] };
            groupedByPrefix[prefix][issueType].push(fileName);
        }
    }

    const transformedIssueFiles = groupHotfixPrefixes(groupedByPrefix);
    return childKeys.length === 0
        ? transformedIssueFiles
        : mergeTreeNodes(transformedChildren, transformedIssueFiles);
}

function groupHotfixPrefixes(groupedByPrefix) {
    const byFamily = {};
    for (const prefix of Object.keys(groupedByPrefix)) {
        const family = getReleaseFamily(prefix);
        byFamily[family] ??= [];
        byFamily[family].push(prefix);
    }

    const result = {};
    for (const [family, members] of Object.entries(byFamily)) {
        const hasHotfixes = members.length > 1 || members.some(member => member !== family);
        if (!hasHotfixes && members[0] === family) {
            result[family] = groupedByPrefix[family];
        } else {
            result[family] = Object.fromEntries(
                members.map(member => [member, groupedByPrefix[member]])
            );
        }
    }
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
    if (!isObjectNode(left)) return right;
    if (!isObjectNode(right)) return left;
    const merged = { ...left };

    for (const [key, rightValue] of Object.entries(right)) {
        const leftValue = merged[key];
        if (key === 'addressed' || key === 'known') {
            const leftFiles = Array.isArray(leftValue) ? leftValue : [];
            const rightFiles = Array.isArray(rightValue) ? rightValue : [];
            merged[key] = Array.from(new Set([...leftFiles, ...rightFiles]));
        } else if (isObjectNode(leftValue) && isObjectNode(rightValue)) {
            merged[key] = mergeTreeNodes(leftValue, rightValue);
        } else {
            merged[key] = rightValue;
        }
    }
    return merged;
}

function isObjectNode(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function toTreeNodes(value, path = []) {
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

export function enumerateTreePaths(nodes) {
    const paths = [];
    function visit(children, parentPath = '') {
        for (const node of children) {
            const path = parentPath ? `${parentPath}>${node.id}` : node.id;
            paths.push(path);
            visit(node.children ?? [], path);
        }
    }
    visit(nodes);
    return paths;
}

export function buildProductTree(products) {
    return toTreeNodes(expandFilePrefixLevel(products));
}
