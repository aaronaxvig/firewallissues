import { buildIssueMarkdownDocument } from './markdown.js';

document.addEventListener('DOMContentLoaded', () => {
    loadProducts();
    setupEventListeners();
    restoreFormState();
});

let activeDownloadUrl = null;
const PROCESS_FORM_STATE_KEY = 'bugmedley.process.formState.v1';
const ISSUE_ID_PATTERN = /\b((?:[A-Z]{2,6}|WF500)-\d{4,8})\b/i;

function loadProducts() {
    fetch('data/products.json')
        .then(response => response.json())
        .then(data => {
            const productSelect = document.getElementById('productSelect');
            const products = Object.keys(data || {});

            products.forEach(product => {
                const option = document.createElement('option');
                option.value = product;
                option.textContent = product;
                productSelect.appendChild(option);
            });

            applyPersistedProductSelection();
        })
        .catch(error => {
            console.error('Error loading products:', error);
            setParseStatus('Could not load data/products.json', true);
        });
}

function setupEventListeners() {
    document.getElementById('issuesInput').addEventListener('input', generateJSON);
    document.getElementById('productSelect').addEventListener('change', generateJSON);
    document.getElementById('issueTypeSelect').addEventListener('change', generateJSON);
    document.getElementById('versionInput').addEventListener('input', generateJSON);
    document.getElementById('copyMarkdownBtn').addEventListener('click', copyToClipboard);

    document.getElementById('productSelect').addEventListener('change', persistFormState);
    document.getElementById('issueTypeSelect').addEventListener('change', persistFormState);
    document.getElementById('versionInput').addEventListener('input', persistFormState);
}

function generateJSON() {
    const product = document.getElementById('productSelect').value;
    const issueType = document.getElementById('issueTypeSelect').value;
    const version = document.getElementById('versionInput').value.trim();
    const inputText = document.getElementById('issuesInput').value;

    persistFormState();

    if (!product || !issueType || !version || !inputText.trim()) {
        document.getElementById('markdownOutput').value = '';
        resetDownloadLink();
        setParseStatus('');
        return;
    }

    const parsedIssues = parseIssuesInput(inputText);

    if (parsedIssues.length === 0) {
        document.getElementById('markdownOutput').value = '';
        resetDownloadLink();
        setParseStatus('No issues found in pasted input. Make sure it includes Issue ID and Description rows.', true);
        return;
    }

    const issues = parsedIssues.map(issue => ({
        id: issue.id,
        description: issue.description,
        caveat: issue.caveat || ''
    }));

    const markdownText = buildIssueMarkdownDocument({
        type: issueType,
        product,
        version,
        issues
    });

    document.getElementById('markdownOutput').value = markdownText;
    updateDownloadLink(markdownText, version);
    setParseStatus(`Parsed ${issues.length} issues from input.`);
}

function parseIssuesInput(inputText) {
    const fromHtml = parseIssuesFromHtmlTable(inputText);
    if (fromHtml.length > 0) {
        return fromHtml;
    }

    return parseIssuesFromLinePairs(inputText);
}

function parseIssuesFromHtmlTable(htmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    const table = doc.querySelector('table');

    if (!table) {
        return [];
    }

    const rows = table.querySelectorAll(':scope > tr, :scope > tbody > tr, :scope > thead > tr, :scope > tfoot > tr');
    const issues = [];

    rows.forEach(row => {
        const cells = row.querySelectorAll('td, th');
        if (cells.length < 2) {
            return;
        }

        const leftCellText = normalizeWhitespace(cells[0].textContent || '');
        const issueDetails = extractIssueDetails(cells[1]);
        const rightCellText = issueDetails.description;

        if (/^issue\s*id$/i.test(leftCellText) || /^description$/i.test(rightCellText)) {
            return;
        }

        const issueIdMatch = leftCellText.match(ISSUE_ID_PATTERN);
        if (!issueIdMatch) {
            return;
        }

        const id = issueIdMatch[1].toUpperCase();
        const description = rightCellText;

        if (!description) {
            return;
        }

        issues.push({
            id,
            description,
            caveat: issueDetails.caveat
        });
    });

    return issues;
}

function extractIssueDetails(cell) {
    const caveatNode = cell.querySelector('tt');
    const caveat = caveatNode ? normalizeWhitespace(caveatNode.textContent || '') : '';

    if (!caveatNode) {
        return {
            description: extractCellText(cell),
            caveat: ''
        };
    }

    const clone = cell.cloneNode(true);
    const cloneCaveatNode = clone.querySelector('tt');
    if (cloneCaveatNode) {
        cloneCaveatNode.remove();
    }

    let description = extractCellText(clone);
    description = description.replace(/^\(\s*\)\s*/, '').trim();

    return {
        description,
        caveat
    };
}

function extractCellText(cell) {
    const clone = cell.cloneNode(true);
    const nestedTables = Array.from(clone.querySelectorAll('table'));
    const markdownTables = nestedTables
        .map(table => convertHtmlTableToMarkdown(table))
        .filter(Boolean);

    nestedTables.forEach(table => table.remove());

    const blockLikeNodes = clone.querySelectorAll('div, p, li, pre, code');
    let mainText = '';

    if (blockLikeNodes.length > 0) {
        const parts = [];
        blockLikeNodes.forEach(node => {
            const text = normalizeWhitespace(node.textContent || '');
            if (text) {
                parts.push(text);
            }
        });

        if (parts.length > 0) {
            mainText = parts.join('\n\n');
        }
    }

    if (!mainText) {
        const withLineBreaks = (clone.innerHTML || '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, ' ');

        mainText = normalizeWhitespace(withLineBreaks).replace(/\s*\n\s*/g, '\n').trim();
    }

    if (markdownTables.length === 0) {
        return mainText;
    }

    if (!mainText) {
        return markdownTables.join('\n\n');
    }

    return [mainText, ...markdownTables].join('\n\n');
}

function convertHtmlTableToMarkdown(table) {
    const rows = Array.from(table.querySelectorAll('tr'))
        .map(row => Array.from(row.querySelectorAll('th, td')))
        .filter(cells => cells.length > 0);

    if (rows.length === 0) {
        return '';
    }

    const headerCells = rows[0].map(cell => sanitizeTableCellText(cell.textContent || ''));
    const columnCount = headerCells.length;

    const lines = [];
    lines.push(`| ${headerCells.join(' | ')} |`);
    lines.push(`| ${Array(columnCount).fill('---').join(' | ')} |`);

    rows.slice(1).forEach(cells => {
        const values = cells.map(cell => sanitizeTableCellText(cell.textContent || ''));
        while (values.length < columnCount) {
            values.push('');
        }

        lines.push(`| ${values.slice(0, columnCount).join(' | ')} |`);
    });

    return lines.join('\n');
}

function sanitizeTableCellText(text) {
    return normalizeWhitespace(text).replace(/\|/g, '\\|');
}

function parseIssuesFromLinePairs(rawText) {
    const lines = rawText
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    const issues = [];

    for (let i = 0; i < lines.length; i += 2) {
        if (i + 1 >= lines.length) {
            continue;
        }

        const issueIdMatch = lines[i].match(ISSUE_ID_PATTERN);
        if (!issueIdMatch) {
            continue;
        }

        issues.push({
            id: issueIdMatch[1].toUpperCase(),
            description: lines[i + 1]
        });
    }

    return issues;
}

function normalizeWhitespace(value) {
    return value.replace(/\s+/g, ' ').trim();
}

function setParseStatus(message, isError = false) {
    const status = document.getElementById('parseStatus');
    status.textContent = message;
    status.style.color = isError ? '#b00020' : '#333';
}

function copyToClipboard(event) {
    const markdownOutput = document.getElementById('markdownOutput');
    if (!markdownOutput.value) {
        setParseStatus('Nothing to copy yet.', true);
        return;
    }

    navigator.clipboard.writeText(markdownOutput.value)
        .then(() => {
            const button = event && event.target ? event.target : null;
            if (!button) {
                setParseStatus('Copied to clipboard.');
                return;
            }

            const originalText = button.textContent;
            button.textContent = 'Copied!';
            setTimeout(() => {
                button.textContent = originalText;
            }, 1200);
        })
        .catch(() => {
            setParseStatus('Clipboard copy failed. Copy manually from preview.', true);
        });
}

function persistFormState() {
    const formState = {
        product: document.getElementById('productSelect').value || '',
        issueType: document.getElementById('issueTypeSelect').value || '',
        version: document.getElementById('versionInput').value || ''
    };

    try {
        localStorage.setItem(PROCESS_FORM_STATE_KEY, JSON.stringify(formState));
    } catch (error) {
        console.warn('Could not persist process form state:', error);
    }
}

function restoreFormState() {
    try {
        const raw = localStorage.getItem(PROCESS_FORM_STATE_KEY);
        if (!raw) {
            return;
        }

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            return;
        }

        const productSelect = document.getElementById('productSelect');
        const issueTypeSelect = document.getElementById('issueTypeSelect');
        const versionInput = document.getElementById('versionInput');

        if (typeof parsed.issueType === 'string') {
            issueTypeSelect.value = parsed.issueType;
        }

        if (typeof parsed.version === 'string') {
            versionInput.value = parsed.version;
        }

        if (typeof parsed.product === 'string' && productSelect.options.length > 1) {
            const optionExists = Array.from(productSelect.options).some(option => option.value === parsed.product);
            if (optionExists) {
                productSelect.value = parsed.product;
            }
        }
    } catch (error) {
        console.warn('Could not restore process form state:', error);
    }
}

function applyPersistedProductSelection() {
    try {
        const raw = localStorage.getItem(PROCESS_FORM_STATE_KEY);
        if (!raw) {
            return;
        }

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.product !== 'string') {
            return;
        }

        const productSelect = document.getElementById('productSelect');
        const optionExists = Array.from(productSelect.options).some(option => option.value === parsed.product);
        if (optionExists) {
            productSelect.value = parsed.product;
        }
    } catch (error) {
        console.warn('Could not apply persisted product selection:', error);
    }
}

function updateDownloadLink(markdownText, version) {
    const link = document.getElementById('downloadMarkdownLink');
    resetDownloadLink();

    const blob = new Blob([markdownText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    activeDownloadUrl = url;

    const dateStamp = new Date().toISOString().slice(0, 10);
    const safeVersion = String(version || 'version').replace(/[^a-zA-Z0-9.-]/g, '-');

    link.href = url;
    link.download = `${safeVersion}_${dateStamp}.md`;
    link.style.pointerEvents = 'auto';
    link.style.opacity = '1';
}

function resetDownloadLink() {
    const link = document.getElementById('downloadMarkdownLink');

    if (activeDownloadUrl) {
        URL.revokeObjectURL(activeDownloadUrl);
        activeDownloadUrl = null;
    }

    link.href = '#';
    link.style.pointerEvents = 'none';
    link.style.opacity = '0.6';
}
