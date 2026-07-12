# Checkbox Tree

A dependency-free, instance-based checkbox tree for browser ES modules. It
supports cascading selection, indeterminate parent states, expandable branches,
multiple independent instances, optional local-storage persistence, and compact
shareable URL state backed by an append-only node manifest.

## Install

```sh
npm install @aaronaxvig/checkbox-tree
```

The package is not published yet. During local development, install it by path:

```sh
npm install ../checkbox-tree
```

## Usage

```js
import { CheckboxTree } from "@aaronaxvig/checkbox-tree";
import "@aaronaxvig/checkbox-tree/styles.css";

const tree = new CheckboxTree(document.querySelector("#example-tree"), {
  initiallySelected: true,
  storageKey: "example-tree-state",
  onSelectionChange({ selectedIds, selectedNodes }) {
    console.log(selectedIds, selectedNodes);
  },
});

tree.setData([
  {
    id: "fruit",
    label: "Fruit",
    children: [
      { id: "apple", label: "Apple", metadata: { color: "red" } },
      { id: "pear", label: "Pear", metadata: { color: "green" } },
    ],
  },
]);
```

For applications without a bundler, serve or copy the two files in `src/` and
use relative URLs:

```html
<link rel="stylesheet" href="./checkbox-tree.css">
<script type="module">
  import { CheckboxTree } from "./checkbox-tree.js";
</script>
```

Every node requires unique string `id` and `label` properties. Nodes may also
have `children`, application-owned `metadata`, and `selectable` or `disabled`
flags.

## API

- `new CheckboxTree(container, options)` creates an independent instance.
- `setData(nodes)` validates and renders nodes, then restores saved state.
- `getSelectedIds()` returns selected node IDs.
- `getSelectedNodes()` returns selected source node objects.
- `setSelectedIds(ids, { notify })` replaces the selection.
- `restoreState()` restores selection and expansion state.
- `destroy()` removes listeners, markup, and the root CSS class.
- `serializeStateToFragment(manifest)` returns `#v=1&c=...&x=...` state.
- `restoreStateFromLocation(manifest, location)` safely applies URL state.
- `validateManifest(manifest)` reports unregistered and missing paths.

Options:

- `initiallyCollapsed` defaults to `true`.
- `initiallySelected` defaults to `false`.
- `storageKey` defaults to `null`, which disables persistence.
- `onSelectionChange` receives `{ selectedIds, selectedNodes }`.
- `manifest` optionally supplies a parsed manifest and automatically restores
  state from `window.location.hash` after `setData()`.

## Shareable URL state

Create a JSON manifest whose array positions are permanent slots. Canonical node
paths join ancestor IDs with `>`:

```json
{ "schema": 1, "nodes": ["fruit", "fruit>apple", "fruit>pear", null] }
```

Import `loadManifest`, pass its result as the `manifest` option, and call
`tree.serializeStateToFragment()` when creating a share link. Existing entries
must never be reordered. Append new paths, replace removed paths with `null`, and
edit a path in place for a logical rename or move. Node IDs therefore cannot
contain `>`.

The fragment adaptively encodes checked (`c`) and expanded (`x`) state using the
shortest of a dense bitset, sparse enabled slots, or sparse disabled slots.
Sparse slot numbers are delta-encoded variable-length integers. A coverage value
in the disabled-slot form ensures nodes appended later still default to unchecked
and collapsed. Malformed or unsupported state is ignored.
The helpers `encodeTreeState`, `decodeTreeState`, `applyTreeState`, and
`restoreStateFromLocation` are also exported for custom integrations.
Use `validateManifestEvolution(previous, next)` in a build check to reject
removed slots and tombstone reuse; path changes are reported for deliberate
rename/move review.

Styling is namespaced under `.checkbox-tree`. Override the custom properties
`--checkbox-tree-indent`, `--checkbox-tree-toggle-size`, and
`--checkbox-tree-hover-color` in the consuming application.

## Development

```sh
npm install
npm test
npm run pack:check
```

## Future demo ideas

- Add population metadata to the country, state, and county nodes and display the
  total population represented by the current selection. Define the aggregation
  rule carefully so checked ancestors and their checked descendants are not
  counted twice; one option is to total only the most specific checked nodes.
