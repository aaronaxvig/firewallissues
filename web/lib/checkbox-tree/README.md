# CheckboxTree

A dependency-free, instance-based checkbox tree for browser ES modules.

## Usage

```html
<link rel="stylesheet" href="./checkbox-tree.css">
<div id="example-tree"></div>
<script type="module">
    import { CheckboxTree } from './checkbox-tree.js';

    const tree = new CheckboxTree(document.querySelector('#example-tree'), {
        storageKey: 'example-tree-state',
        onSelectionChange: ({ selectedIds, selectedNodes }) => {
            console.log(selectedIds, selectedNodes);
        }
    });

    tree.setData([
        {
            id: 'fruit',
            label: 'Fruit',
            children: [
                { id: 'apple', label: 'Apple', metadata: { color: 'red' } },
                { id: 'pear', label: 'Pear', metadata: { color: 'green' } }
            ]
        }
    ]);
```

Every node requires a unique string `id` and a string `label`. Nodes may also have
`children`, application-owned `metadata`, and `selectable` or `disabled` flags.

## API

- `new CheckboxTree(container, options)` creates an independent instance.
- `setData(nodes)` validates and renders a new node array, then restores saved state.
- `getSelectedIds()` returns selected node IDs.
- `getSelectedNodes()` returns the selected source node objects.
- `setSelectedIds(ids, { notify })` replaces the current selection.
- `restoreState()` restores selection and expansion when `storageKey` is configured.
- `destroy()` removes listeners, markup, and the root CSS class.

Options are `initiallyCollapsed` (default `true`), `storageKey` (default `null`),
and `onSelectionChange`. Styling is namespaced under `.checkbox-tree` and its
custom properties can be overridden by a consuming application.
