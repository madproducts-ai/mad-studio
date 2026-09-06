import type { MadNode, NodeId, PropValue, StyleProps } from './document';

/**
 * Pure, immutable tree operations shared by the API planner (to build the
 * document while streaming) and the web canvas (to apply the same events).
 * Every function returns a new root; input nodes are never mutated.
 */

export const findNode = (root: MadNode, id: NodeId): MadNode | null => {
  if (root.id === id) return root;
  for (const child of root.children) {
    const hit = findNode(child, id);
    if (hit) return hit;
  }
  return null;
};

export const findParent = (root: MadNode, id: NodeId): MadNode | null => {
  for (const child of root.children) {
    if (child.id === id) return root;
    const hit = findParent(child, id);
    if (hit) return hit;
  }
  return null;
};

export const pathTo = (root: MadNode, id: NodeId): MadNode[] => {
  if (root.id === id) return [root];
  for (const child of root.children) {
    const sub = pathTo(child, id);
    if (sub.length) return [root, ...sub];
  }
  return [];
};

export const countNodes = (root: MadNode): number =>
  1 + root.children.reduce((sum, child) => sum + countNodes(child), 0);

export const insertNode = (root: MadNode, parentId: NodeId | null, index: number, node: MadNode): MadNode => {
  if (parentId === null) return node;
  if (root.id === parentId) {
    const children = [...root.children];
    children.splice(Math.min(Math.max(index, 0), children.length), 0, node);
    return { ...root, children };
  }
  let changed = false;
  const children = root.children.map((child) => {
    const next = insertNode(child, parentId, index, node);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...root, children } : root;
};

export interface NodePatch {
  props?: Record<string, PropValue>;
  style?: Partial<StyleProps>;
  name?: string;
  locked?: boolean;
}

export const patchNode = (root: MadNode, id: NodeId, patch: NodePatch): MadNode => {
  if (root.id === id) {
    return {
      ...root,
      name: patch.name ?? root.name,
      locked: patch.locked ?? root.locked,
      props: patch.props ? { ...root.props, ...patch.props } : root.props,
      style: patch.style ? { ...root.style, ...patch.style } : root.style,
    };
  }
  let changed = false;
  const children = root.children.map((child) => {
    const next = patchNode(child, id, patch);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...root, children } : root;
};

export const removeNode = (root: MadNode, id: NodeId): MadNode => {
  if (root.children.some((c) => c.id === id)) {
    return { ...root, children: root.children.filter((c) => c.id !== id) };
  }
  let changed = false;
  const children = root.children.map((child) => {
    const next = removeNode(child, id);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...root, children } : root;
};

/** Move a node under a new parent at an index. Rejects moves into its own subtree. */
export const moveNode = (root: MadNode, id: NodeId, newParentId: NodeId, index: number): MadNode => {
  const node = findNode(root, id);
  if (!node) return root;
  if (findNode(node, newParentId)) return root;
  const without = removeNode(root, id);
  return insertNode(without, newParentId, index, node);
};

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Deterministic-when-seeded id generator so API and tests produce stable trees.
 * Uses mulberry32; without a seed it falls back to crypto randomness.
 */
export const createIdFactory = (seed?: number): (() => NodeId) => {
  if (seed === undefined) {
    return () => {
      const bytes = new Uint8Array(10);
      globalThis.crypto.getRandomValues(bytes);
      let out = '';
      for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
      return `n_${out}`;
    };
  }
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => {
    let out = '';
    for (let i = 0; i < 10; i += 1) out += ALPHABET[Math.floor(next() * ALPHABET.length)];
    return `n_${out}`;
  };
};

/** Re-id an entire subtree (used when dropping a preset onto the canvas). */
export const cloneWithFreshIds = (node: MadNode, nextId: () => NodeId): MadNode => ({
  ...node,
  id: nextId(),
  source: 'preset',
  props: { ...node.props },
  style: { ...node.style },
  children: node.children.map((c) => cloneWithFreshIds(c, nextId)),
});
