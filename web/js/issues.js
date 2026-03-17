import { stripMarkdownFrontmatter } from './markdown.js';
import { marked, Renderer } from '../vendor/marked.esm.js';

const summaryMarkdownRenderer = new Renderer();
summaryMarkdownRenderer.html = token => {
    return escapeHtml(typeof token === 'string' ? token : (token.raw || token.text || ''));
};

export function clearIssues() {
    document.getElementById('addressed-issues').innerHTML = '';
    document.getElementById('known-issues').innerHTML = '';
}

let socialRefsByIssueId = new Map();
const ISSUE_ID_LINE_PATTERN = /^((?:[A-Z]{2,6}|WF500)-\d{4,8})\s*[:\-]?\s*(.*)$/i;
const socialRefsReady = loadSocialRefs();
const issueFileDataCache = new Map();
const issueFilePromiseCache = new Map();

function loadSocialRefs() {
    return fetch('data/external_refs.json')
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to load data/external_refs.json (${response.status})`);
            }
            return response.json();
        })
        .then(data => {
            socialRefsByIssueId = normalizeSocialRefs(data);
        })
        .catch(error => {
            console.warn('External refs unavailable:', error);
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
                        resolved: issue.resolved || '',
                        caveat: issue.caveat || '',
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
    const input = String(stripMarkdownFrontmatter(markdownText) || '');
    if (!input.trim()) {
        return [];
    }

    try {
        const tokens = marked.lexer(input, {
            gfm: true
        });

        const issues = [];
        let currentIssueId = '';
        let currentIssueBodyParts = [];
        let currentIssueResolvedBlocks = [];
        let currentIssueCaveatBlocks = [];

        const finalizeIssue = () => {
            if (!currentIssueId) {
                return;
            }

            const summaryBody = currentIssueBodyParts
                .join('')
                .replace(/\n{3,}/g, '\n\n')
                .trim();

            const summary = summaryBody;
            const resolved = currentIssueResolvedBlocks.join('\n\n').trim();
            const caveat = currentIssueCaveatBlocks.join('\n\n').trim();

            issues.push({
                id: currentIssueId,
                summary,
                resolved,
                caveat
            });
        };

        tokens.forEach(token => {
            if (token.type === 'heading' && token.depth === 2) {
                finalizeIssue();
                currentIssueId = String(token.text || '').trim();
                currentIssueBodyParts = [];
                currentIssueResolvedBlocks = [];
                currentIssueCaveatBlocks = [];
                return;
            }

            if (!currentIssueId) {
                return;
            }

            if (token.type === 'code' && String(token.lang || '').trim().toLowerCase() === 'resolved') {
                const resolvedText = String(token.text || '').trim();
                if (resolvedText) {
                    currentIssueResolvedBlocks.push(resolvedText);
                }
                return;
            }

            if (token.type === 'code' && String(token.lang || '').trim().toLowerCase() === 'caveat') {
                const caveatText = String(token.text || '').trim();
                if (caveatText) {
                    currentIssueCaveatBlocks.push(caveatText);
                }
                return;
            }

            if (token.type === 'space' || token.type === 'hr') {
                return;
            }

            if (typeof token.raw === 'string' && token.raw) {
                currentIssueBodyParts.push(token.raw);
                return;
            }

            if (typeof token.text === 'string' && token.text.trim()) {
                currentIssueBodyParts.push(`${token.text.trim()}\n\n`);
            }
        });

        finalizeIssue();
        return issues;
    } catch (error) {
        console.error('Marked token parser failed.', error);
        return [];
    }
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
                        summary: String(item.summary || item.description).trim(),
                        resolved: String(item.resolved || '').trim(),
                        caveat: String(item.caveat || '').trim()
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
                    summary: String(issue.description).trim(),
                    resolved: String(issue.resolved || '').trim(),
                    caveat: String(issue.caveat || '').trim()
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
        const resolved = (issue.resolved || '').trim();
        const caveat = (issue.caveat || '').trim();
        if (!id) return;

        if (!map.has(id)) {
            map.set(id, { id, summary, resolved, caveat, [versionKey]: [] });
        }

        const entry = map.get(id);
        if (!entry.summary && summary) {
            entry.summary = summary;
        }
        if (!entry.resolved && resolved) {
            entry.resolved = resolved;
        }
        if (!entry.caveat && caveat) {
            entry.caveat = caveat;
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
    const match = value.match(ISSUE_ID_LINE_PATTERN);
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
    cell.innerHTML = markdownSummaryToHtml(issue.summary, issue.resolved, issue.caveat);

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
    if (!Array.isArray(data)) {
        return map;
    }

    data.forEach(entry => {
        if (!entry || typeof entry !== 'object') {
            return;
        }

        const id = String(entry.id || '').trim().toUpperCase();
        const url = String(entry.url || '').trim();
        const label = String(entry.display || '').trim() || 'Link';
        if (!id || !url) {
            return;
        }

        if (!map.has(id)) {
            map.set(id, []);
        }

        map.get(id).push({ label, url });
    });

    return map;
}

function markdownSummaryToHtml(summaryText, resolvedText, caveatText) {
    const input = String(summaryText || '').trim();
    const resolved = String(resolvedText || '').trim();
    const caveat = String(caveatText || '').trim();

    if (!input && !resolved && !caveat) {
        return '';
    }

    const htmlParts = [];
    if (resolved) {
        htmlParts.push(`<div><strong>Resolved:</strong> ${escapeHtml(resolved)}</div>`);
    }
    if (caveat) {
        htmlParts.push(`<div><em>Caveat: ${escapeHtml(caveat)}</em></div>`);
    }

    if (input) {
        htmlParts.push(renderMarkdownBodyToHtml(input));
    }
    return htmlParts.join('');
}

function renderMarkdownBodyToHtml(markdownText) {
    const input = String(markdownText || '').trim();
    if (!input) {
        return '';
    }

    const html = marked.parse(input, {
        gfm: true,
        async: false,
        renderer: summaryMarkdownRenderer
    });
    return addIssueTableClasses(typeof html === 'string' ? html : '');
}

function addIssueTableClasses(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    doc.querySelectorAll('table').forEach(table => {
        table.classList.add('issues-table');
    });
    return doc.body.innerHTML;
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
