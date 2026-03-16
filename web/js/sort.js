export function isVersionKey(key) {
    return /^\d+(\.\d+)*$/.test(key);
}

export function compareVersionDesc(a, b) {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);
    const maxLen = Math.max(aParts.length, bParts.length);

    for (let i = 0; i < maxLen; i++) {
        const aVal = aParts[i] || 0;
        const bVal = bParts[i] || 0;
        if (aVal !== bVal) {
            return bVal - aVal;
        }
    }

    return 0;
}

export function getSortedKeys(obj) {
    return Object.keys(obj).sort((a, b) => {
        const aIsVersion = isVersionKey(a);
        const bIsVersion = isVersionKey(b);

        if (aIsVersion && bIsVersion) {
            return compareVersionDesc(a, b);
        }

        if (aIsVersion && !bIsVersion) {
            return -1;
        }

        if (!aIsVersion && bIsVersion) {
            return 1;
        }

        return a.localeCompare(b);
    });
}
