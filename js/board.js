import { supabase } from './supabaseClient.js';

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// Manages the pannable/zoomable map viewport and the tokens layer overlaid
// on top of it. Token coordinates are percentages (0..100) of the image's
// natural size, so they line up regardless of current zoom/pan/viewport size.
export class Board {
  constructor({ viewportEl, stageEl, imageEl, onTransformChange }) {
    this.viewport = viewportEl;
    this.stage = stageEl;
    this.image = imageEl;
    this.onTransformChange = onTransformChange;

    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.naturalWidth = 0;
    this.naturalHeight = 0;

    this.pointers = new Map();
    this.pinch = null;
    this.pan = null;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onWheel = this._onWheel.bind(this);

    this.viewport.addEventListener('pointerdown', this._onPointerDown);
    this.viewport.addEventListener('pointermove', this._onPointerMove);
    this.viewport.addEventListener('pointerup', this._onPointerUp);
    this.viewport.addEventListener('pointercancel', this._onPointerUp);
    this.viewport.addEventListener('wheel', this._onWheel, { passive: false });
    // Belt-and-suspenders against native HTML5 image drag hijacking the pan
    // gesture (draggable="false" + -webkit-user-drag:none on the map <img>
    // should already prevent it, this is a catch-all safety net).
    this.viewport.addEventListener('dragstart', (evt) => evt.preventDefault());
  }

  async setImageUrl(url) {
    if (!url) {
      this.image.removeAttribute('src');
      this.naturalWidth = 0;
      this.naturalHeight = 0;
      return;
    }
    await new Promise((resolve, reject) => {
      this.image.onload = resolve;
      this.image.onerror = reject;
      this.image.src = url;
    });
    this.naturalWidth = this.image.naturalWidth;
    this.naturalHeight = this.image.naturalHeight;
    this.stage.style.width = `${this.naturalWidth}px`;
    this.stage.style.height = `${this.naturalHeight}px`;
    this._fitToView();
  }

  _fitToView() {
    if (!this.naturalWidth || !this.naturalHeight) return;
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    const scale = Math.min(vw / this.naturalWidth, vh / this.naturalHeight, 1);
    this.scale = scale || 1;
    this.tx = (vw - this.naturalWidth * this.scale) / 2;
    this.ty = (vh - this.naturalHeight * this.scale) / 2;
    this._applyTransform();
  }

  _applyTransform() {
    this.stage.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
    this.onTransformChange?.();
  }

  _clientPoint(evt) {
    const rect = this.viewport.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  _onPointerDown(evt) {
    if (evt.target.closest('.token')) return; // let board.js consumers handle token drags
    evt.preventDefault();
    this.viewport.setPointerCapture(evt.pointerId);
    this.pointers.set(evt.pointerId, this._clientPoint(evt));

    if (this.pointers.size === 1) {
      const [p] = this.pointers.values();
      this.pan = { start: p, tx0: this.tx, ty0: this.ty };
      this.pinch = null;
    } else if (this.pointers.size === 2) {
      const pts = [...this.pointers.values()];
      this.pinch = {
        startDist: distance(pts[0], pts[1]),
        startMid: midpoint(pts[0], pts[1]),
        scale0: this.scale,
        tx0: this.tx,
        ty0: this.ty,
      };
      this.pan = null;
    }
  }

  _onPointerMove(evt) {
    if (!this.pointers.has(evt.pointerId)) return;
    this.pointers.set(evt.pointerId, this._clientPoint(evt));

    if (this.pinch && this.pointers.size === 2) {
      const pts = [...this.pointers.values()];
      const dist = distance(pts[0], pts[1]);
      const mid = midpoint(pts[0], pts[1]);
      const newScale = this._clampScale(this.pinch.scale0 * (dist / this.pinch.startDist));

      const ix = (this.pinch.startMid.x - this.pinch.tx0) / this.pinch.scale0;
      const iy = (this.pinch.startMid.y - this.pinch.ty0) / this.pinch.scale0;
      this.scale = newScale;
      this.tx = mid.x - ix * newScale;
      this.ty = mid.y - iy * newScale;
      this._applyTransform();
    } else if (this.pan && this.pointers.size === 1) {
      const p = [...this.pointers.values()][0];
      this.tx = this.pan.tx0 + (p.x - this.pan.start.x);
      this.ty = this.pan.ty0 + (p.y - this.pan.start.y);
      this._applyTransform();
    }
  }

  _onPointerUp(evt) {
    this.pointers.delete(evt.pointerId);
    this.pinch = null;
    if (this.pointers.size === 1) {
      const [p] = this.pointers.values();
      this.pan = { start: p, tx0: this.tx, ty0: this.ty };
    } else {
      this.pan = null;
    }
  }

  _onWheel(evt) {
    evt.preventDefault();
    const point = this._clientPoint(evt);
    const factor = Math.exp(-evt.deltaY * 0.001);
    const newScale = this._clampScale(this.scale * factor);

    const ix = (point.x - this.tx) / this.scale;
    const iy = (point.y - this.ty) / this.scale;
    this.scale = newScale;
    this.tx = point.x - ix * newScale;
    this.ty = point.y - iy * newScale;
    this._applyTransform();
  }

  _clampScale(scale) {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
  }
}

// Passes the full updated room row so callers can react to any column
// (background_url, allow_player_edit, ...) without a separate channel each.
export function subscribeRoom(roomId, onRoomChanged) {
  const channel = supabase
    .channel(`room-${roomId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
      (payload) => onRoomChanged(payload.new)
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}
