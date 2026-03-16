const TYPE_FILTER_KEY = 'bugmedley.ui.typeFilters.v1';

let issueSearchTerms = [];
let issueTypeFilters = loadTypeFilters();

function loadTypeFilters() {
    try {
        const saved = localStorage.getItem(TYPE_FILTER_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (typeof parsed.addressed === 'boolean' && typeof parsed.known === 'boolean') {
                return parsed;
            }
        }
    } catch (_) {}
    return { addressed: true, known: true };
}

function saveTypeFilters() {
    try {
        localStorage.setItem(TYPE_FILTER_KEY, JSON.stringify(issueTypeFilters));
    } catch (_) {}
}

export function initializeUI({ onSelectionChange }) {
    initializeIssueSearch();
    initializeIssueTypeFilters(onSelectionChange);
    updateIssueSectionVisibility();
    updateIssueCounts();
}

export function getIssueTypeFilters() {
    return issueTypeFilters;
}

export function applyIssueSearchFilter() {
    const issueItems = document.querySelectorAll('.issue-search-item');

    issueItems.forEach(item => {
        const itemText = item.textContent.toLowerCase();
        const matches = issueSearchTerms.length === 0 || issueSearchTerms.every(term => itemText.includes(term));
        if (item.tagName === 'TR') {
            item.style.display = matches ? 'table-row' : 'none';
        } else {
            item.style.display = matches ? '' : 'none';
        }
    });

    updateIssueCounts();
}

function initializeIssueSearch() {
    const searchInput = document.getElementById('issue-search');
    searchInput.addEventListener('input', () => {
        issueSearchTerms = searchInput.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
        applyIssueSearchFilter();
    });
}

function initializeIssueTypeFilters(onSelectionChange) {
    const addressedFilter = document.getElementById('filter-addressed');
    const knownFilter = document.getElementById('filter-known');

    // Restore checkbox state from persisted filters
    addressedFilter.checked = issueTypeFilters.addressed;
    knownFilter.checked = issueTypeFilters.known;

    addressedFilter.addEventListener('change', () => {
        if (!addressedFilter.checked && !knownFilter.checked) {
            addressedFilter.checked = true;
        }

        issueTypeFilters = {
            addressed: addressedFilter.checked,
            known: knownFilter.checked
        };

        saveTypeFilters();
        updateIssueSectionVisibility();
        if (typeof onSelectionChange === 'function') {
            onSelectionChange();
        }
    });

    knownFilter.addEventListener('change', () => {
        if (!knownFilter.checked && !addressedFilter.checked) {
            knownFilter.checked = true;
        }

        issueTypeFilters = {
            addressed: addressedFilter.checked,
            known: knownFilter.checked
        };

        saveTypeFilters();
        updateIssueSectionVisibility();
        if (typeof onSelectionChange === 'function') {
            onSelectionChange();
        }
    });
}

function updateIssueSectionVisibility() {
    const addressedSection = document.getElementById('addressed-section');
    const knownSection = document.getElementById('known-section');

    addressedSection.style.display = issueTypeFilters.addressed ? 'block' : 'none';
    knownSection.style.display = issueTypeFilters.known ? 'block' : 'none';
}

function updateIssueCounts() {
    const addressedCount = countVisibleIssueItems('addressed-issues');
    const knownCount = countVisibleIssueItems('known-issues');

    const addressedCountEl = document.getElementById('addressed-count');
    const knownCountEl = document.getElementById('known-count');

    if (addressedCountEl) {
        addressedCountEl.textContent = `(${addressedCount})`;
    }

    if (knownCountEl) {
        knownCountEl.textContent = `(${knownCount})`;
    }
}

function countVisibleIssueItems(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
        return 0;
    }

    const items = container.querySelectorAll('.issue-search-item');
    return Array.from(items).filter(item => item.style.display !== 'none').length;
}
