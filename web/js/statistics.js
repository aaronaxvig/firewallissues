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

const productSelect = document.getElementById('issue-plot-product');
const trainSelect = document.getElementById('issue-plot-train');
const canvas = document.getElementById('issue-plot-canvas');
const tooltip = document.getElementById('issue-plot-tooltip');
const summary = document.getElementById('issue-plot-summary');
const context = canvas?.getContext('2d');
const productCache = new Map();
let currentProduct = null;
let renderedPoints = [];
let hoveredPoint = null;
const initialParams = new URLSearchParams(window.location.search);
const initialProduct = initialParams.get('product') || 'PAN-OS';
const initialTrain = initialParams.get('train') || '11.1';
let restoreInitialSelection = true;

function releaseTrain(version) {
    return version.match(/^\d+\.\d+/)?.[0] ?? version;
}

function fillSelect(select, options) {
    select.replaceChildren(...options.map(value => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        return option;
    }));
}

function updatePlotQuery() {
    if (!currentProduct || !trainSelect.value) return;
    const url = new URL(window.location.href);
    url.searchParams.set('product', currentProduct.product);
    url.searchParams.set('train', trainSelect.value);
    history.replaceState(null, '', url);
}

async function loadProduct(filename) {
    if (!productCache.has(filename)) {
        productCache.set(filename, fetch(`data/statistics/${filename}`).then(response => {
            if (!response.ok) throw new Error(`Unable to load graph data (${response.status})`);
            return response.json();
        }));
    }
    return productCache.get(filename);
}

function plotColors() {
    const styles = getComputedStyle(document.documentElement);
    return {
        text: styles.getPropertyValue('--text-muted').trim() || '#59636e',
        grid: styles.getPropertyValue('--border').trim() || '#d0d7de',
        point: styles.getPropertyValue('--link').trim() || '#0969da',
        hover: styles.getPropertyValue('--focus').trim() || '#bf8700'
    };
}

function formatIssueNumber(value) {
    return Number(value).toLocaleString('en-US');
}

function drawPlot() {
    if (!context || !currentProduct) return;
    const selectedTrain = trainSelect.value;
    const releaseIndexes = currentProduct.releases
        .map((version, index) => ({ version, index }))
        .filter(item => releaseTrain(item.version) === selectedTrain);
    const indexPositions = new Map(releaseIndexes.map((item, position) => [item.index, position]));
    const points = currentProduct.points.filter(point => indexPositions.has(point[0]));

    const bounds = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(bounds.width * ratio));
    canvas.height = Math.max(1, Math.round(bounds.height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const width = bounds.width;
    const height = bounds.height;
    const margin = { top: 22, right: 18, bottom: 92, left: 76 };
    const plotWidth = Math.max(1, width - margin.left - margin.right);
    const plotHeight = Math.max(1, height - margin.top - margin.bottom);
    const colors = plotColors();
    const values = points.map(point => point[1]);
    if (values.length === 0) {
        context.clearRect(0, 0, bounds.width, bounds.height);
        context.fillStyle = colors.text;
        context.font = '14px system-ui, sans-serif';
        context.textAlign = 'center';
        context.fillText('No addressed Issue-IDs in this release train.', bounds.width / 2, bounds.height / 2);
        renderedPoints = [];
        summary.textContent = `0 addressed issues across ${releaseIndexes.length.toLocaleString('en-US')} releases.`;
        return;
    }
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const range = Math.max(1, maximum - minimum);
    const yMin = Math.max(0, minimum - range * 0.04);
    const yMax = maximum + range * 0.04;
    const xFor = position => margin.left + (
        releaseIndexes.length === 1 ? plotWidth / 2 : position * plotWidth / (releaseIndexes.length - 1)
    );
    const yFor = value => margin.top + (yMax - value) / (yMax - yMin) * plotHeight;

    context.clearRect(0, 0, width, height);
    context.font = '12px system-ui, sans-serif';
    context.fillStyle = colors.text;
    context.strokeStyle = colors.grid;
    context.lineWidth = 1;

    for (let tick = 0; tick <= 5; tick++) {
        const y = margin.top + tick * plotHeight / 5;
        const value = yMax - tick * (yMax - yMin) / 5;
        context.beginPath();
        context.moveTo(margin.left, y);
        context.lineTo(width - margin.right, y);
        context.stroke();
        context.textAlign = 'right';
        context.textBaseline = 'middle';
        context.fillText(formatIssueNumber(Math.round(value)), margin.left - 9, y);
    }

    context.save();
    context.translate(16, margin.top + plotHeight / 2);
    context.rotate(-Math.PI / 2);
    context.textAlign = 'center';
    context.fillText('Issue-ID number', 0, 0);
    context.restore();

    releaseIndexes.forEach((item, position) => {
        const x = xFor(position);
        context.save();
        context.translate(x, height - margin.bottom + 10);
        context.rotate(-Math.PI / 3);
        context.textAlign = 'right';
        context.textBaseline = 'middle';
        context.fillText(item.version, 0, 0);
        context.restore();
    });

    const overlaps = new Map();
    renderedPoints = points.map(point => {
        const position = indexPositions.get(point[0]);
        const overlapKey = `${point[0]}:${point[1]}`;
        const overlap = overlaps.get(overlapKey) ?? 0;
        overlaps.set(overlapKey, overlap + 1);
        return {
            x: xFor(position) + (overlap % 3 - 1) * 4,
            y: yFor(point[1]) - Math.floor(overlap / 3) * 4,
            id: point[2],
            issueNumber: point[1],
            release: currentProduct.releases[point[0]]
        };
    });

    renderedPoints.forEach(point => {
        context.beginPath();
        const hovered = point.issueNumber === hoveredPoint?.issueNumber;
        context.arc(point.x, point.y, hovered ? 5 : 3, 0, Math.PI * 2);
        context.fillStyle = hovered ? colors.hover : colors.point;
        context.globalAlpha = hovered ? 1 : 0.72;
        context.fill();
    });
    context.globalAlpha = 1;
    summary.textContent = `${points.length.toLocaleString('en-US')} addressed issue${points.length === 1 ? '' : 's'} across ${releaseIndexes.length.toLocaleString('en-US')} release${releaseIndexes.length === 1 ? '' : 's'}.`;
}

function pointNear(event) {
    const bounds = canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    return renderedPoints.reduce((nearest, point) => {
        const distance = Math.hypot(point.x - x, point.y - y);
        return distance <= 9 && (!nearest || distance < nearest.distance) ? { point, distance } : nearest;
    }, null)?.point ?? null;
}

canvas?.addEventListener('pointermove', event => {
    const point = pointNear(event);
    if (point === hoveredPoint) return;
    hoveredPoint = point;
    canvas.style.cursor = point ? 'pointer' : 'default';
    if (point) {
        tooltip.textContent = `${point.id} · ${point.release}`;
        tooltip.hidden = false;
        const frame = canvas.parentElement.getBoundingClientRect();
        tooltip.style.left = `${Math.min(event.clientX - frame.left + 12, frame.width - tooltip.offsetWidth - 8)}px`;
        tooltip.style.top = `${Math.max(8, event.clientY - frame.top - tooltip.offsetHeight - 10)}px`;
    } else {
        tooltip.hidden = true;
    }
    drawPlot();
});

canvas?.addEventListener('pointerleave', () => {
    hoveredPoint = null;
    tooltip.hidden = true;
    drawPlot();
});

canvas?.addEventListener('click', event => {
    const point = pointNear(event);
    if (point) {
        const params = new URLSearchParams({
            issue: point.id,
            product: currentProduct.product,
            release: point.release
        });
        window.location.href = `index.html?${params}`;
    }
});

trainSelect?.addEventListener('change', () => {
    hoveredPoint = null;
    tooltip.hidden = true;
    updatePlotQuery();
    drawPlot();
});

productSelect?.addEventListener('change', async () => {
    try {
        currentProduct = await loadProduct(productSelect.value);
        fillSelect(trainSelect, Array.from(new Set(currentProduct.releases.map(releaseTrain))).reverse());
        if (restoreInitialSelection && initialProduct === currentProduct.product && initialTrain &&
            Array.from(trainSelect.options).some(option => option.value === initialTrain)) {
            trainSelect.value = initialTrain;
        }
        restoreInitialSelection = false;
        updatePlotQuery();
        drawPlot();
    } catch (error) {
        summary.textContent = error.message;
    }
});

if (canvas) {
    new ResizeObserver(drawPlot).observe(canvas);
    fetch('data/statistics/products.json')
        .then(response => {
            if (!response.ok) throw new Error(`Unable to load graph products (${response.status})`);
            return response.json();
        })
        .then(products => {
            productSelect.replaceChildren(...products.map(([product, filename]) => {
                const option = document.createElement('option');
                option.value = filename;
                option.textContent = product;
                return option;
            }));
            const requestedProduct = products.find(([product]) => product === initialProduct);
            if (requestedProduct) productSelect.value = requestedProduct[1];
            productSelect.dispatchEvent(new Event('change'));
        })
        .catch(error => {
            summary.textContent = error.message;
        });
}
