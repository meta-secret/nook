import type { WidgetPosition } from './state'
import { WidgetHostKind, WidgetPlacementKind, widgetState } from './state'
const DRAG_THRESHOLD_PX = 4

type ClampWidgetPositionArgs = {
  left: number
  top: number
  width: number
  height: number
}

export function clampWidgetPosition({
  left,
  top,
  width,
  height,
}: ClampWidgetPositionArgs): WidgetPosition {
  const margin = 8
  const maxLeft = Math.max(margin, window.innerWidth - width - margin)
  const maxTop = Math.max(margin, window.innerHeight - height - margin)
  return {
    left: Math.min(Math.max(margin, left), maxLeft),
    top: Math.min(Math.max(margin, top), maxTop),
  }
}

type ApplyWidgetPositionArgs = {
  host: HTMLElement
  position: WidgetPosition
}

export function applyWidgetPosition({
  host,
  position,
}: ApplyWidgetPositionArgs): void {
  host.style.top = `${position.top}px`
  host.style.left = `${position.left}px`
  host.style.right = 'auto'
}
export function clampMountedWidgetPosition(): void {
  if (
    widgetState.host.kind !== WidgetHostKind.Attached ||
    widgetState.placement.kind !== WidgetPlacementKind.Positioned
  ) {
    return
  }
  const host = widgetState.host.element
  const nookTypedArgs0_0: Parameters<typeof clampWidgetPosition>[0] = {
    left: widgetState.placement.position.left,
    top: widgetState.placement.position.top,
    width: host.offsetWidth,
    height: host.offsetHeight,
  }
  const position = clampWidgetPosition(nookTypedArgs0_0)
  widgetState.setPosition(position)
  const nookTypedArgs0_1: Parameters<typeof applyWidgetPosition>[0] = {
    host,
    position,
  }
  applyWidgetPosition(nookTypedArgs0_1)
}

export enum PointerDragBehaviorKind {
  DragOnly = 'drag-only',
  Tappable = 'tappable',
}

export type PointerDragBehavior =
  | { kind: PointerDragBehaviorKind.DragOnly }
  | { kind: PointerDragBehaviorKind.Tappable; onTap: () => void }

type AttachPointerDragRequest = {
  host: HTMLElement
  handle: HTMLElement
  behavior: PointerDragBehavior
}

export function attachPointerDrag({
  host,
  handle,
  behavior,
}: AttachPointerDragRequest): void {
  enum DragPointerStateKind {
    Released = 'released',
    Captured = 'captured',
  }

  type DragPointerState =
    | { kind: DragPointerStateKind.Released }
    | { kind: DragPointerStateKind.Captured; pointerId: number }

  let pointer: DragPointerState = { kind: DragPointerStateKind.Released }
  let startX = 0
  let startY = 0
  let originLeft = 0
  let originTop = 0
  let dragged = false
  let suppressClick = false

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    const target = event.target
    if (
      target instanceof Element &&
      target.closest('button') &&
      !handle.classList.contains('collapsed-launch')
    ) {
      return
    }
    pointer = {
      kind: DragPointerStateKind.Captured,
      pointerId: event.pointerId,
    }
    handle.setPointerCapture(pointer.pointerId)
    const rect = host.getBoundingClientRect()
    startX = event.clientX
    startY = event.clientY
    originLeft = rect.left
    originTop = rect.top
    dragged = false
  })

  handle.addEventListener('pointermove', (event) => {
    if (
      pointer.kind !== DragPointerStateKind.Captured ||
      event.pointerId !== pointer.pointerId
    ) {
      return
    }
    const dx = event.clientX - startX
    const dy = event.clientY - startY
    if (!dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
    dragged = true
    host.classList.add('dragging')
    const nookTypedArgs0_2: Parameters<typeof clampWidgetPosition>[0] = {
      left: originLeft + dx,
      top: originTop + dy,
      width: host.offsetWidth,
      height: host.offsetHeight,
    }
    const position = clampWidgetPosition(nookTypedArgs0_2)
    widgetState.setPosition(position)
    const nookTypedArgs0_3: Parameters<typeof applyWidgetPosition>[0] = {
      host,
      position,
    }
    applyWidgetPosition(nookTypedArgs0_3)
  })

  const endDrag = (event: PointerEvent) => {
    if (
      pointer.kind !== DragPointerStateKind.Captured ||
      event.pointerId !== pointer.pointerId
    ) {
      return
    }
    if (handle.hasPointerCapture(pointer.pointerId)) {
      handle.releasePointerCapture(pointer.pointerId)
    }
    pointer = { kind: DragPointerStateKind.Released }
    host.classList.remove('dragging')
    if (dragged && event.type === 'pointerup') {
      suppressClick = true
      window.setTimeout(() => {
        suppressClick = false
      }, 0)
    }
  }

  handle.addEventListener('pointerup', endDrag)
  handle.addEventListener('pointercancel', endDrag)
  if (behavior.kind === PointerDragBehaviorKind.Tappable) {
    handle.addEventListener('click', (event) => {
      if (suppressClick) {
        event.preventDefault()
        suppressClick = false
        return
      }
      behavior.onTap()
    })
  }
}
