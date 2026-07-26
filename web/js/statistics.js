function collapseDescendants(row) {
    const toggle = row.querySelector('.stats-toggle');
    if (!toggle) return;

    toggle.setAttribute('aria-expanded', 'false');
    const group = toggle.getAttribute('aria-controls');
    document.querySelectorAll(`[data-stats-parent="${group}"]`).forEach(child => {
        child.hidden = true;
        collapseDescendants(child);
    });
}

document.addEventListener('click', event => {
    const toggle = event.target.closest('.stats-toggle');
    if (!toggle) return;

    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    const group = toggle.getAttribute('aria-controls');

    document.querySelectorAll(`[data-stats-parent="${group}"]`).forEach(row => {
        row.hidden = expanded;
        if (expanded) collapseDescendants(row);
    });
});
