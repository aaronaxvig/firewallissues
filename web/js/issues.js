export function clearIssues() {
    document.getElementById('addressed-issues').innerHTML = '';
    document.getElementById('known-issues').innerHTML = '';
}

let socialRefsByIssueId = new Map();
const socialRefsReady = loadSocialRefs();
const issueFileDataCache = new Map();
const issueFilePromiseCache = new Map();

function loadSocialRefs() {
    return fetch('data/social_refs.json')
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to load data/social_refs.json (${response.status})`);
            }
            return response.json();
        })
        .then(data => {
            socialRefsByIssueId = normalizeSocialRefs(data);
        })
        .catch(error => {
            console.warn('Social refs unavailable:', error);
            socialRefsByIssueId = new Map();
        });
}

export function loadIssuesForCheckedPaths({
    issueTypeFilters,
    checkedFileRefs,
    applyIssueSearchFilter
}) {
    const addressedFiles = checkedFileRefs && typeof checkedFileRefs === 'object' && Array.isArray(checkedFileRefs.addressedFiles)
        ? checkedFileRefs.addressedFiles
        : [];
    const knownFiles = checkedFileRefs && typeof checkedFileRefs === 'object' && Array.isArray(checkedFileRefs.knownFiles)
        ? checkedFileRefs.knownFiles
        : [];

    if (addressedFiles.length === 0 && knownFiles.length === 0) {
        clearIssues();
        applyIssueSearchFilter();
        return;
    }

    if (issueTypeFilters.addressed) {
        loadIssuesFromFiles(addressedFiles, 'addressed', 'addressed-issues', applyIssueSearchFilter);
    } else {
        document.getElementById('addressed-issues').innerHTML = '';
    }

    if (issueTypeFilters.known) {
        loadIssuesFromFiles(knownFiles, 'known', 'known-issues', applyIssueSearchFilter);
    } else {
        document.getElementById('known-issues').innerHTML = '';
    }
}

function loadIssuesFromFiles(fileRefs, issueType, elementId, applyIssueSearchFilter) {
    const issuesContainer = document.getElementById(elementId);
    issuesContainer.innerHTML = '';

    if (!fileRefs || fileRefs.length === 0) {
        renderNone(issuesContainer);
        applyIssueSearchFilter();
        return;
    }

    const allIssues = [];
    let loadedCount = 0;

    fileRefs.forEach(fileRef => {
        fetchIssueFile(fileRef.productKey, fileRef.fileName, issueType)
            .then(data => {
                const sourceVersion = getSourceVersionFromFileName(fileRef.fileName);
                normalizeIssuesFromPayload(data).forEach(issue => {
                    allIssues.push({
                        id: issue.id || '',
                        summary: issue.summary || '',
                        sourceVersion
                    });
                });
            })
            .catch(error => {
                console.error(`Error loading ${fileRef.fileName}:`, error);
            })
            .finally(() => {
                loadedCount++;
                if (loadedCount === fileRefs.length) {
                    socialRefsReady.finally(() => {
                        displayIssues(allIssues, issueType, elementId);
                        applyIssueSearchFilter();
                    });
                }
            });
    });
}

function fetchIssueFile(productKey, fileName, issueType) {
    const filePath = `data/issues/${productKey}/${issueType}/${fileName}`;

    if (issueFileDataCache.has(filePath)) {
        return Promise.resolve(issueFileDataCache.get(filePath));
    }

    if (issueFilePromiseCache.has(filePath)) {
        return issueFilePromiseCache.get(filePath);
    }

    const request = fetch(filePath)
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to load ${fileName}`);
            }

            if (/\.md$/i.test(fileName)) {
                return response.text().then(text => parseMarkdownIssues(text));
            }

            return response.json();
        })
        .then(data => {
            issueFileDataCache.set(filePath, data);
            issueFilePromiseCache.delete(filePath);
            return data;
        })
        .catch(error => {
            issueFilePromiseCache.delete(filePath);
            throw error;
        });

    issueFilePromiseCache.set(filePath, request);
    return request;
}

function parseMarkdownIssues(markdownText) {
    const lines = String(markdownText || '').split(/\r?\n/);
    const issues = [];
    let currentIssue = null;
    let inCaveatBlock = false;
    let caveatLines = [];

    lines.forEach(line => {
        const issueHeaderMatch = line.match(/^##\s+(.+)$/);
        if (issueHeaderMatch) {
            finalizeMarkdownIssue(currentIssue, issues);
            currentIssue = {
                id: issueHeaderMatch[1].trim(),
                descriptionLines: [],
                caveat: ''
            };
            inCaveatBlock = false;
            caveatLines = [];
            return;
        }

        if (!currentIssue) {
            return;
        }

        if (/^```caveat\s*$/i.test(line.trim())) {
            inCaveatBlock = true;
            caveatLines = [];
            return;
        }

        if (inCaveatBlock) {
            if (/^```\s*$/.test(line.trim())) {
                currentIssue.caveat = caveatLines.join(' ').replace(/\s+/g, ' ').trim();
                inCaveatBlock = false;
                caveatLines = [];
                return;
            }

            const caveatLine = line.trim();
            if (caveatLine) {
                caveatLines.push(caveatLine);
            }
            return;
        }

        const trimmed = line.trim();
        if (!trimmed || /^---\s*$/.test(trimmed)) {
            return;
        }

        if (/^(type|product|version|date):\s*/i.test(trimmed)) {
            return;
        }

        currentIssue.descriptionLines.push(trimmed);
    });

    finalizeMarkdownIssue(currentIssue, issues);
    return issues;
}

function finalizeMarkdownIssue(issue, issues) {
    if (!issue || !issue.id) {
        return;
    }

    const description = issue.descriptionLines
        .map(line => line.trimEnd())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    let summary = description;
    if (issue.caveat) {
        summary = summary
            ? `[Caveat: ${issue.caveat}] ${summary}`
            : `[Caveat: ${issue.caveat}]`;
    }

    issues.push({
        id: issue.id,
        summary
    });
}

function normalizeIssuesFromPayload(data) {
    if (Array.isArray(data)) {
        return data.map(item => {
            if (typeof item === 'string') {
                return parseIssueLine(item);
            }

            if (item && typeof item === 'object') {
                if (item.id && (item.description || item.summary)) {
                    return {
                        id: String(item.id).trim(),
                        summary: String(item.summary || item.description).trim()
                    };
                }

                return parseIssueLine(JSON.stringify(item));
            }

            return parseIssueLine(String(item));
        });
    }

    if (data && typeof data === 'object' && Array.isArray(data.issues)) {
        return data.issues.map(issue => {
            if (issue && typeof issue === 'object' && issue.id && issue.description) {
                return {
                    id: String(issue.id).trim(),
                    summary: String(issue.description).trim()
                };
            }
            return parseIssueLine(JSON.stringify(issue));
        });
    }

    if (data && typeof data === 'object') {
        return [parseIssueLine(JSON.stringify(data))];
    }

    return [];
}

function displayIssues(issues, issueType, elementId) {
    const issuesContainer = document.getElementById(elementId);
    issuesContainer.innerHTML = '';

    if (issues.length === 0) {
        renderNone(issuesContainer);
        return;
    }

    if (issueType === 'addressed') {
        renderAddressedTable(issues, issuesContainer);
        return;
    }

    renderKnownList(issues, issuesContainer);
}

function renderAddressedTable(issues, container) {
    const deduped = dedupeAddressedIssues(issues);
    if (deduped.length === 0) {
        renderNone(container);
        return;
    }

    const table = document.createElement('table');
    table.className = 'issues-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['Issue ID', 'Addressed in', 'Summary'].forEach((heading, idx) => {
        const th = document.createElement('th');
        th.textContent = heading;
        if (idx === 0) {
            th.className = 'issue-id-col';
        }
        if (idx === 1) {
            th.className = 'issue-version-col';
        }
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    deduped.forEach(issue => {
        const row = document.createElement('tr');
        row.className = 'issue-search-item';

        const idCell = document.createElement('td');
        idCell.className = 'issue-id-col';
        idCell.textContent = issue.id;

        const addressedInCell = document.createElement('td');
        addressedInCell.className = 'issue-version-col';
        addressedInCell.textContent = issue.addressedIn.join(', ');

        const summaryCell = document.createElement('td');
        renderSummaryCell(summaryCell, issue);

        row.appendChild(idCell);
        row.appendChild(addressedInCell);
        row.appendChild(summaryCell);
        tbody.appendChild(row);
    });
    table.appendChild(tbody);
    container.appendChild(table);
}

function renderKnownList(issues, container) {
    const deduped = dedupeIssues(issues, 'knownIn');
    if (deduped.length === 0) {
        renderNone(container);
        return;
    }

    const table = document.createElement('table');
    table.className = 'issues-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['Issue ID', 'Known in', 'Summary'].forEach((heading, idx) => {
        const th = document.createElement('th');
        th.textContent = heading;
        if (idx === 0) th.className = 'issue-id-col';
        if (idx === 1) th.className = 'issue-version-col';
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    deduped.forEach(issue => {
        const row = document.createElement('tr');
        row.className = 'issue-search-item';

        const idCell = document.createElement('td');
        idCell.className = 'issue-id-col';
        idCell.textContent = issue.id;

        const knownInCell = document.createElement('td');
        knownInCell.className = 'issue-version-col';
        knownInCell.textContent = issue.knownIn.join(', ');

        const summaryCell = document.createElement('td');
        renderSummaryCell(summaryCell, issue);

        row.appendChild(idCell);
        row.appendChild(knownInCell);
        row.appendChild(summaryCell);
        tbody.appendChild(row);
    });
    table.appendChild(tbody);
    container.appendChild(table);
}

function dedupeAddressedIssues(issues) {
    return dedupeIssues(issues, 'addressedIn');
}

function dedupeIssues(issues, versionKey) {
    const map = new Map();

    issues.forEach(issue => {
        const id = (issue.id || '').trim();
        const summary = (issue.summary || '').trim();
        if (!id) return;

        if (!map.has(id)) {
            map.set(id, { id, summary, [versionKey]: [] });
        }

        const entry = map.get(id);
        if (!entry.summary && summary) {
            entry.summary = summary;
        }

        const version = (issue.sourceVersion || '').trim();
        if (version && !entry[versionKey].includes(version)) {
            entry[versionKey].push(version);
        }
    });

    return Array.from(map.values()).sort((a, b) => b.id.localeCompare(a.id));
}

function parseIssueLine(text) {
    const value = String(text || '').trim();
    const match = value.match(/^([A-Z]{2,6}-\d{4,8})\s*[:\-]?\s*(.*)$/i);
    if (match) {
        return {
            id: match[1].toUpperCase(),
            summary: (match[2] || '').trim()
        };
    }

    return {
        id: '',
        summary: value
    };
}

function getSourceVersionFromFileName(fileName) {
    const value = String(fileName || '').trim();
    const underscoreIndex = value.indexOf('_');
    if (underscoreIndex > 0) {
        return value.slice(0, underscoreIndex);
    }

    return value.replace(/\.(json|md)$/i, '');
}

function renderSummaryCell(cell, issue) {
    cell.innerHTML = markdownSummaryToHtml(issue.summary);

    const refs = getSocialRefsForIssue(issue.id);
    if (!refs.length) {
        return;
    }

    const refsContainer = document.createElement('div');
    refsContainer.style.marginTop = '6px';

    refs.forEach((ref, index) => {
        const link = document.createElement('a');
        link.href = ref.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = `(${ref.label})`;

        refsContainer.appendChild(link);
        if (index < refs.length - 1) {
            refsContainer.appendChild(document.createTextNode(' '));
        }
    });

    cell.appendChild(refsContainer);
}

function getSocialRefsForIssue(issueId) {
    const normalizedIssueId = String(issueId || '').trim().toUpperCase();
    if (!normalizedIssueId) {
        return [];
    }

    return socialRefsByIssueId.get(normalizedIssueId) || [];
}

function normalizeSocialRefs(data) {
    const map = new Map();
    if (!data || typeof data !== 'object') {
        return map;
    }

    Object.keys(data).forEach(sourceKey => {
        const sourceValue = data[sourceKey];
        const entries = getSourceEntries(sourceValue);
        const label = getSourceDisplayLabel(sourceKey, sourceValue);

        entries.forEach(entry => {
            if (!entry || typeof entry !== 'object') {
                return;
            }

            const id = String(entry.id || '').trim().toUpperCase();
            const url = String(entry.url || '').trim();
            if (!id || !url) {
                return;
            }

            if (!map.has(id)) {
                map.set(id, []);
            }

            map.get(id).push({ label, url });
        });
    });

    return map;
}

function getSourceEntries(sourceValue) {
    if (Array.isArray(sourceValue)) {
        return sourceValue;
    }

    if (sourceValue && typeof sourceValue === 'object' && Array.isArray(sourceValue.entries)) {
        return sourceValue.entries;
    }

    return [];
}

function getSourceDisplayLabel(sourceKey, sourceValue) {
    if (sourceValue && typeof sourceValue === 'object' && !Array.isArray(sourceValue)) {
        const display = String(sourceValue.display || '').trim();
        if (display) {
            return display;
        }
    }

    return sourceLabelFromKey(sourceKey);
}

function sourceLabelFromKey(sourceKey) {
    const key = String(sourceKey || '').trim().toLowerCase();
    if (!key) {
        return 'Link';
    }

    return key
        .split(/[_\-\s]+/)
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function markdownSummaryToHtml(summaryText) {
    const input = String(summaryText || '').trim();
    if (!input) {
        return '';
    }

    const caveatMatch = input.match(/^\[Caveat:\s*([^\]]+)\]\s*/i);
    const caveatText = caveatMatch ? caveatMatch[1].trim() : '';
    const body = caveatMatch ? input.slice(caveatMatch[0].length) : input;

    const htmlParts = [];
    if (caveatText) {
        htmlParts.push(`<div><em>Caveat: ${escapeHtml(caveatText)}</em></div>`);
    }

    htmlParts.push(renderMarkdownBodyToHtml(body));
    return htmlParts.join('');
}

function renderMarkdownBodyToHtml(markdownText) {
    const lines = String(markdownText || '').split(/\r?\n/);
    const htmlParts = [];
    let paragraphLines = [];

    function flushParagraph() {
        if (paragraphLines.length === 0) {
            return;
        }
        const text = paragraphLines.join(' ').replace(/\s+/g, ' ').trim();
        if (text) {
            htmlParts.push(`<p>${escapeHtml(text)}</p>`);
        }
        paragraphLines = [];
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!trimmed) {
            flushParagraph();
            continue;
        }

        const next = i + 1 < lines.length ? lines[i + 1].trim() : '';
        if (isTableRow(trimmed) && isTableSeparator(next)) {
            flushParagraph();

            const headerCells = parseMarkdownTableRow(trimmed);
            const rows = [];
            i += 2;
            while (i < lines.length && isTableRow(lines[i].trim())) {
                rows.push(parseMarkdownTableRow(lines[i].trim()));
                i++;
            }
            i -= 1;

            htmlParts.push(renderHtmlTable(headerCells, rows));
            continue;
        }

        paragraphLines.push(trimmed);
    }

    flushParagraph();
    return htmlParts.join('');
}

function isTableRow(line) {
    return /\|/.test(line);
}

function isTableSeparator(line) {
    return /^\|?\s*:?-{3,}:?(\s*\|\s*:?-{3,}:?)*\s*\|?$/.test(line);
}

function parseMarkdownTableRow(line) {
    const raw = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    return raw.split('|').map(cell => cell.trim());
}

function renderHtmlTable(headerCells, rows) {
    const colCount = headerCells.length;
    const thead = `<thead><tr>${headerCells.map(cell => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead>`;
    const tbodyRows = rows.map(row => {
        const normalized = [...row];
        while (normalized.length < colCount) {
            normalized.push('');
        }
        return `<tr>${normalized.slice(0, colCount).map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`;
    }).join('');

    return `<table class="issues-table">${thead}<tbody>${tbodyRows}</tbody></table>`;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderNone(container) {
    const li = document.createElement('li');
    li.textContent = 'None';
    li.style.fontStyle = 'italic';
    li.style.color = '#999';
    container.appendChild(li);
}
