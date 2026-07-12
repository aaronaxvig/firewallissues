import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Element = dom.window.Element;
globalThis.localStorage = dom.window.localStorage;

const { CheckboxTree } = await import('../web/lib/checkbox-tree/checkbox-tree.js');

function createTree(options = {}) {
    const container = document.createElement('div');
    document.body.replaceChildren(container);
    const tree = new CheckboxTree(container, options);
    tree.setData([
        {
            id: 'parent',
            label: 'Parent',
            metadata: { kind: 'parent' },
            children: [
                { id: 'first', label: 'First', metadata: { kind: 'leaf' } },
                { id: 'second', label: 'Second', metadata: { kind: 'leaf' } }
            ]
        }
    ]);
    return { container, tree };
}

function checkbox(container, id) {
    return container.querySelector(`.checkbox-tree__checkbox[data-node-id="${id}"]`);
}

test('selecting a parent selects all descendants and emits selected nodes', () => {
    let change;
    const { container, tree } = createTree({ onSelectionChange: event => { change = event; } });

    const parent = checkbox(container, 'parent');
    parent.checked = true;
    parent.dispatchEvent(new window.Event('change', { bubbles: true }));

    assert.deepEqual(tree.getSelectedIds(), ['parent', 'first', 'second']);
    assert.deepEqual(change.selectedIds, ['parent', 'first', 'second']);
    assert.equal(change.selectedNodes[1].metadata.kind, 'leaf');
});

test('partial child selection makes the parent indeterminate', () => {
    const { container, tree } = createTree();
    const first = checkbox(container, 'first');
    first.checked = true;
    first.dispatchEvent(new window.Event('change', { bubbles: true }));

    const parent = checkbox(container, 'parent');
    assert.equal(parent.checked, false);
    assert.equal(parent.indeterminate, true);
    assert.deepEqual(tree.getSelectedIds(), ['first']);
});

test('persists selection and collapsed branches per configured key', () => {
    localStorage.clear();
    const first = createTree({ storageKey: 'example-tree' });
    checkbox(first.container, 'first').click();

    const toggle = first.container.querySelector('.checkbox-tree__toggle');
    toggle.click();
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');

    const second = createTree({ storageKey: 'example-tree' });
    assert.deepEqual(second.tree.getSelectedIds(), ['first']);
    assert.equal(second.container.querySelector('.checkbox-tree__toggle').getAttribute('aria-expanded'), 'true');
});

test('supports independent instances and removes listeners on destroy', () => {
    const firstContainer = document.createElement('div');
    const secondContainer = document.createElement('div');
    document.body.replaceChildren(firstContainer, secondContainer);
    const first = new CheckboxTree(firstContainer);
    const second = new CheckboxTree(secondContainer);
    const data = [{ id: 'node', label: 'Node' }];
    first.setData(data);
    second.setData(data);

    checkbox(firstContainer, 'node').click();
    assert.deepEqual(first.getSelectedIds(), ['node']);
    assert.deepEqual(second.getSelectedIds(), []);

    first.destroy();
    assert.equal(firstContainer.childElementCount, 0);
    assert.equal(firstContainer.classList.contains('checkbox-tree'), false);
});

test('rejects duplicate node ids', () => {
    const container = document.createElement('div');
    const tree = new CheckboxTree(container);
    assert.throws(
        () => tree.setData([{ id: 'same', label: 'One' }, { id: 'same', label: 'Two' }]),
        /Duplicate CheckboxTree node id/
    );
});
