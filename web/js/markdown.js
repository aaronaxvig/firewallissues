export function buildIssueMarkdownDocument(payload) {
    const lines = [];
    lines.push('---');
    lines.push(`type: ${payload.type}`);
    lines.push(`product: ${payload.product}`);
    lines.push(`version: ${payload.version}`);
    lines.push('---');
    lines.push('');

    if (!payload.issues || payload.issues.length === 0) {
        lines.push('_No issues_');
        lines.push('');
        return lines.join('\n');
    }

    payload.issues.forEach(issue => {
        lines.push(`## ${issue.id}`);
        lines.push('');

        if (issue.resolved) {
            lines.push('```resolved');
            lines.push(issue.resolved);
            lines.push('```');
            lines.push('');
        }

        if (issue.caveat) {
            lines.push('```caveat');
            lines.push(issue.caveat);
            lines.push('```');
            lines.push('');
        }

        getIssueDescriptionParagraphs(issue.description).forEach(paragraph => {
            lines.push(paragraph);
            lines.push('');
        });

        if (Array.isArray(issue.platforms) && issue.platforms.length > 0) {
            lines.push(`Platforms: ${issue.platforms.join(', ')}`);
            lines.push('');
        }
    });

    return lines.join('\n');
}

export function stripMarkdownFrontmatter(markdownText) {
    const input = String(markdownText || '').replace(/^\uFEFF/, '');
    const lines = input.split(/\r?\n/);

    if (lines[0] !== '---') {
        return input;
    }

    for (let i = 1; i < lines.length; i++) {
        if (lines[i] === '---') {
            return lines.slice(i + 1).join('\n').replace(/^\n+/, '');
        }
    }

    return input;
}

function getIssueDescriptionParagraphs(description) {
    const paragraphs = String(description || '')
        .split(/\n{2,}/)
        .map(text => text.trim())
        .filter(Boolean);

    return paragraphs.length > 0 ? paragraphs : [''];
}