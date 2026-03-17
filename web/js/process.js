import { buildIssueMarkdownDocument } from './markdown.js';

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        if (!document.getElementById('issuesInput')) {
            return;
        }

        loadProducts();
        setupEventListeners();
        restoreFormState();
    });
}

let activeDownloadUrl = null;
const PROCESS_FORM_STATE_KEY = 'bugmedley.process.formState.v1';
const ISSUE_ID_PATTERN = /\b((?:[A-Z]{2,6}|WF500)-\d{4,8})\b/i;
const BLOCK_CONTAINER_TAGS = new Set(['ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'P', 'PRE', 'SECTION']);
const RESOLVED_LINE_PATTERN = /^(?:resolved|fixed)\s+in\b/i;
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

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

    const parsedIssues = parseIssuesFromHtmlTable(inputText);

    if (parsedIssues.length === 0) {
        document.getElementById('markdownOutput').value = '';
        resetDownloadLink();
        setParseStatus('No issues found in pasted input. Make sure it includes Issue ID and Description rows.', true);
        return;
    }

    const issues = parsedIssues.map(issue => ({
        id: issue.id,
        description: issue.description,
        resolved: issue.resolved || '',
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

export function parseIssuesFromHtmlTable(htmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    const table = doc.querySelector('table');

    if (!table) {
        return [];
    }

    const rows = Array.from(table.querySelectorAll('tr'));
    const issues = [];

    rows.forEach(row => {
        const cells = Array.from(row.children).filter(cell => {
            const tag = (cell.tagName || '').toUpperCase();
            return tag === 'TD' || tag === 'TH';
        });

        if (cells.length < 2) {
            return;
        }

        const leftCellText = extractCellText(cells[0]);
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
        const leftCellTrailingText = normalizeWhitespace(
            leftCellText.replace(issueIdMatch[0], '').replace(/^[-:;,.\s]+/, '')
        );
        
        // Strip markdown formatting to check if this is resolved text
        const plainTrailingText = stripMarkdownFormatting(leftCellTrailingText);
        const resolved = RESOLVED_LINE_PATTERN.test(plainTrailingText) ? plainTrailingText : '';
        const description = rightCellText;

        if (!description) {
            return;
        }

        issues.push({
            id,
            description,
            resolved,
            caveat: resolved ? '' : leftCellTrailingText
        });
    });

    return issues;
}

function stripMarkdownFormatting(text) {
    return String(text || '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/`(.*?)`/g, '$1')
        .replace(/~~(.*?)~~/g, '$1');
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
    return collectMarkdownBlocks(clone)
        .join('\n\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function collectMarkdownBlocks(root, nestedListDepth = 0) {
    const blocks = [];
    let paragraphBuffer = '';

    const flushParagraph = () => {
        const text = normalizeInlineMarkdown(paragraphBuffer);
        if (text) {
            blocks.push(text);
        }
        paragraphBuffer = '';
    };

    Array.from(root.childNodes).forEach(node => {
        if (node.nodeType === TEXT_NODE) {
            paragraphBuffer = appendInlineText(paragraphBuffer, node.textContent || '');
            return;
        }

        if (node.nodeType !== ELEMENT_NODE) {
            return;
        }

        const tagName = node.tagName.toUpperCase();

        if (tagName === 'TABLE') {
            flushParagraph();
            const tableMarkdown = convertHtmlTableToMarkdown(node);
            if (tableMarkdown) {
                blocks.push(tableMarkdown);
            }
            return;
        }

        if (tagName === 'UL' || tagName === 'OL') {
            flushParagraph();
            const listMarkdown = convertHtmlListToMarkdown(node, nestedListDepth);
            if (listMarkdown) {
                blocks.push(listMarkdown);
            }
            return;
        }

        if (BLOCK_CONTAINER_TAGS.has(tagName)) {
            flushParagraph();
            blocks.push(...collectMarkdownBlocks(node, nestedListDepth));
            return;
        }

        paragraphBuffer = appendInlineText(paragraphBuffer, convertInlineNodeToMarkdown(node));
    });

    flushParagraph();
    return blocks;
}

function convertInlineNodeToMarkdown(node) {
    if (!node || node.nodeType !== ELEMENT_NODE) {
        return '';
    }

    const className = String(node.getAttribute('class') || '');

    if (/\bmenucascade\b/i.test(className)) {
        const parts = extractMenuCascadeParts(node);
        if (parts.length > 0) {
            return parts.map(part => `**${part}**`).join(' > ');
        }
    }

    if (/\buicontrol\b/i.test(className)) {
        const content = normalizeInlineMarkdown(renderInlineChildren(node));
        return content ? `**${content}**` : '';
    }

    if (/\buserinput\b/i.test(className)) {
        const content = normalizeInlineMarkdown(renderInlineChildren(node));
        return content ? `\`${content}\`` : '';
    }

    const tagName = (node.tagName || '').toUpperCase();

    if (tagName === 'BR') {
        return '\u0000';
    }

    if (tagName === 'STRONG' || tagName === 'B') {
        const content = normalizeInlineMarkdown(renderInlineChildren(node));
        return content ? `**${content}**` : '';
    }

    if (tagName === 'EM' || tagName === 'I') {
        const content = normalizeInlineMarkdown(renderInlineChildren(node));
        return content ? `*${content}*` : '';
    }

    return renderInlineChildren(node);
}

function renderInlineChildren(node) {
    let output = '';

    Array.from(node.childNodes).forEach(child => {
        if (child.nodeType === TEXT_NODE) {
            output = appendInlineText(output, child.textContent || '');
            return;
        }

        if (child.nodeType !== ELEMENT_NODE) {
            return;
        }

        output = appendInlineText(output, convertInlineNodeToMarkdown(child));
    });

    return output;
}

function extractMenuCascadeParts(node) {
    const controls = Array.from(node.querySelectorAll('.uicontrol'));
    if (controls.length === 0) {
        const fallback = normalizeInlineMarkdown(renderInlineChildren(node));
        return fallback ? [fallback] : [];
    }

    return controls
        .map(control => normalizeInlineMarkdown(renderInlineChildren(control)))
        .filter(Boolean);
}

function convertHtmlListToMarkdown(list, depth = 0) {
    const items = Array.from(list.children).filter(child => child.tagName && child.tagName.toUpperCase() === 'LI');
    if (items.length === 0) {
        return '';
    }

    const isOrdered = list.tagName.toUpperCase() === 'OL';
    return items
        .map((item, index) => convertListItemToMarkdown(item, isOrdered ? `${index + 1}.` : '-', depth))
        .filter(Boolean)
        .join('\n');
}

function convertListItemToMarkdown(item, marker, depth) {
    const blocks = collectMarkdownBlocks(item, depth + 1);
    const indent = '  '.repeat(depth);
    const continuationIndent = `${indent}  `;

    if (blocks.length === 0) {
        return `${indent}${marker}`;
    }

    const [firstBlock, ...remainingBlocks] = blocks;
    const firstLines = String(firstBlock || '').split('\n');
    let output = `${indent}${marker} ${firstLines[0] || ''}`;

    if (firstLines.length > 1) {
        output += `\n${firstLines.slice(1).map(line => line ? `${continuationIndent}${line}` : continuationIndent.trimEnd()).join('\n')}`;
    }

    remainingBlocks.forEach(block => {
        if (!block) {
            return;
        }

        if (isIndentedListBlock(block, depth + 1)) {
            output += `\n${block}`;
            return;
        }

        output += `\n${block.split('\n').map(line => line ? `${continuationIndent}${line}` : '').join('\n')}`;
    });

    return output.trimEnd();
}

function isIndentedListBlock(block, depth) {
    const indent = '  '.repeat(depth);
    const lines = String(block || '').split('\n').filter(Boolean);
    return lines.length > 0 && lines.every(line => line.startsWith(indent) && /^\s*(?:-|\d+\.)\s/.test(line));
}

function normalizeInlineMarkdown(value) {
    return String(value || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[\t\f\v\r ]+/g, ' ')
        .replace(/\s*\n+\s*/g, ' ')
        .replace(/\u0000/g, '\n')
        .replace(/ *\n+ */g, '\n')
        .trim();
}

function appendInlineText(existing, fragment) {
    const current = String(existing || '');
    const next = String(fragment || '');

    if (!next) {
        return current;
    }

    if (!current) {
        return next;
    }

    if (/[A-Za-z0-9)\]]$/.test(current) && /^[A-Za-z0-9([\]]/.test(next)) {
        return `${current} ${next}`;
    }

    return `${current}${next}`;
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
