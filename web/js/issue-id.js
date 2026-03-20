export const BLANK_ISSUE_ID = 'BLANK-000000';

const ISSUE_ID_CORE_PATTERN = '[A-Z][A-Z0-9]{1,15}-\\d{3,8}';

export const ISSUE_ID_PATTERN = new RegExp(`(${ISSUE_ID_CORE_PATTERN})`, 'i');
export const ISSUE_ID_LIST_PREFIX_PATTERN = new RegExp(
    `^\\s*((?:${ISSUE_ID_CORE_PATTERN})(?:\\s*(?:,|and|&)\\s*(?:${ISSUE_ID_CORE_PATTERN}))*)`,
    'i'
);
export const ISSUE_ID_LINE_PATTERN = new RegExp(`^(${ISSUE_ID_CORE_PATTERN})\\s*[:\\-]?\\s*(.*)$`, 'i');

export function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

export function normalizeIssueId(value) {
    return normalizeWhitespace(value).toUpperCase();
}

export function isBlankIssueMarker(value) {
    return /^[\u2014\u2013\-]+$/.test(String(value || '').trim());
}

export function extractIssueIds(value) {
    const ids = [];
    const seen = new Set();
    const matches = String(value || '').matchAll(new RegExp(ISSUE_ID_PATTERN.source, 'ig'));

    for (const match of matches) {
        const normalizedId = normalizeIssueId(match[1] || '');
        if (!normalizedId || seen.has(normalizedId)) {
            continue;
        }

        seen.add(normalizedId);
        ids.push(normalizedId);
    }

    return ids;
}

export function parseIssueIdCell(value) {
    const text = normalizeWhitespace(value);
    const issueIdListMatch = text.match(ISSUE_ID_LIST_PREFIX_PATTERN);
    const blankId = !issueIdListMatch && isBlankIssueMarker(text);

    if (!issueIdListMatch && !blankId) {
        return null;
    }

    if (blankId) {
        return {
            issueIds: [BLANK_ISSUE_ID],
            metadataText: '',
            isBlankId: true
        };
    }

    const issueIds = extractIssueIds(String(issueIdListMatch[1] || ''));
    const metadataText = normalizeWhitespace(text.slice(issueIdListMatch[0].length)).replace(/^[-:;,.\s]+/, '');

    return {
        issueIds,
        metadataText,
        isBlankId: false
    };
}

export function parseIssueLine(value) {
    const text = String(value || '').trim();
    const match = text.match(ISSUE_ID_LINE_PATTERN);

    if (!match) {
        return {
            id: '',
            summary: text
        };
    }

    return {
        id: normalizeIssueId(match[1] || ''),
        summary: (match[2] || '').trim()
    };
}