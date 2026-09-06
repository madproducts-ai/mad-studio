import { Injectable, signal } from '@angular/core';
import type { NodeId } from '@mad/schema';

export interface DropPayload {
  kind: 'preset' | 'node';
  id: string;
}

export const DRAG_MIME = 'application/x-mad-drag';

/**
 * Per-canvas render state shared between every NodeView in a tree. Provided at
 * the canvas boundary so the landing demo and the studio each own one.
 */
@Injectable()
export class RenderContext {
  readonly interactive = signal(false);
  readonly selectedId = signal<NodeId | null>(null);
  readonly hoveredId = signal<NodeId | null>(null);
  readonly dropTargetId = signal<NodeId | null>(null);
  readonly dropIndex = signal(0);
  /** Ids that were just added by a stream; they play the entrance animation once. */
  readonly enteringIds = signal<ReadonlySet<NodeId>>(new Set());

  onSelect: (id: NodeId) => void = () => undefined;
  onDrop: (parentId: NodeId, index: number, payload: DropPayload) => void = () => undefined;

  select(id: NodeId): void {
    this.selectedId.set(id);
    this.onSelect(id);
  }

  hover(id: NodeId | null): void {
    this.hoveredId.set(id);
  }

  dragOver(id: NodeId | null, index: number): void {
    this.dropTargetId.set(id);
    this.dropIndex.set(index);
  }

  drop(parentId: NodeId, index: number, transfer: DataTransfer | null): void {
    this.dropTargetId.set(null);
    const raw = transfer?.getData(DRAG_MIME);
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as DropPayload;
      if ((payload.kind === 'preset' || payload.kind === 'node') && typeof payload.id === 'string') {
        this.onDrop(parentId, index, payload);
      }
    } catch {
      // Ignore foreign drags (files, text) silently.
    }
  }

  markEntering(ids: NodeId[]): void {
    if (ids.length === 0) return;
    const next = new Set(this.enteringIds());
    for (const id of ids) next.add(id);
    this.enteringIds.set(next);
    setTimeout(() => {
      const after = new Set(this.enteringIds());
      for (const id of ids) after.delete(id);
      this.enteringIds.set(after);
    }, 900);
  }
}
