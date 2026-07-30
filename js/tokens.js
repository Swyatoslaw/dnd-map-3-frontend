function colorForId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 45%)`;
}

const DRAG_BROADCAST_INTERVAL_MS = 50;

// Leading-edge throttle: fine here since the final position is always sent
// separately (and reliably) via onMove at drag release — a missed
// intermediate tick just means one less live-preview frame for onlookers.
function throttle(fn, waitMs) {
  let last = 0;
  return (...args) => {
    const now = performance.now();
    if (now - last >= waitMs) {
      last = now;
      fn(...args);
    }
  };
}

// Renders players as absolutely-positioned DOM elements inside a viewport-
// level layer (a sibling of the zoomable/pannable #stage, NOT a child of
// it) so a token's on-screen size stays fixed regardless of the map's zoom
// level or the map image's own dimensions. Position is tracked internally
// as a percentage of the map image (same space as players.x/y) and
// converted to viewport px using the board's current tx/ty/scale — both at
// render time and live whenever the board's transform changes (pan/zoom).
export class TokensRenderer {
  constructor({ layerEl, board, isOwner, myPlayerId, onMove, onDragging }) {
    this.layer = layerEl;
    this.board = board;
    this.isOwner = isOwner;
    this.myPlayerId = myPlayerId;
    this.onMove = onMove;
    this.onDragging = onDragging ? throttle(onDragging, DRAG_BROADCAST_INTERVAL_MS) : null;
    this.elements = new Map();
    this.positions = new Map();
    this.draggingPlayerId = null;
  }

  // Applied for a token someone ELSE is dragging, received via Realtime
  // broadcast — live preview only, the authoritative value still arrives
  // later through postgres_changes once they release the pointer.
  applyRemotePosition(playerId, x, y) {
    if (this.draggingPlayerId === playerId) return;
    this.positions.set(playerId, { x, y });
    const el = this.elements.get(playerId);
    if (!el) return;
    const scr = this._percentToScreen(x, y);
    el.style.left = `${scr.x}px`;
    el.style.top = `${scr.y}px`;
  }

  canDrag(playerId) {
    return this.isOwner || playerId === this.myPlayerId;
  }

  render(players) {
    const seen = new Set();
    for (const player of players) {
      seen.add(player.id);
      let el = this.elements.get(player.id);
      if (!el) {
        el = this._createElement(player.id);
        this.elements.set(player.id, el);
        this.layer.appendChild(el);
      }
      this._updateContent(el, player);
      if (this.draggingPlayerId !== player.id) {
        this.positions.set(player.id, { x: player.x, y: player.y });
      }
    }
    for (const [id, el] of this.elements) {
      if (!seen.has(id)) {
        el.remove();
        this.elements.delete(id);
        this.positions.delete(id);
      }
    }
    this.reposition();
  }

  // Called by Board after every pan/zoom transform update.
  reposition() {
    for (const [id, el] of this.elements) {
      const pos = this.positions.get(id);
      if (!pos) continue;
      const { x, y } = this._percentToScreen(pos.x, pos.y);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    }
  }

  _percentToScreen(xPct, yPct) {
    const b = this.board;
    return {
      x: b.tx + (xPct / 100) * b.naturalWidth * b.scale,
      y: b.ty + (yPct / 100) * b.naturalHeight * b.scale,
    };
  }

  _screenToPercent(xPx, yPx) {
    const b = this.board;
    return {
      x: Math.min(100, Math.max(0, ((xPx - b.tx) / b.scale / b.naturalWidth) * 100)),
      y: Math.min(100, Math.max(0, ((yPx - b.ty) / b.scale / b.naturalHeight) * 100)),
    };
  }

  _createElement(playerId) {
    const el = document.createElement('div');
    el.className = 'token';
    el.dataset.playerId = playerId;

    const avatar = document.createElement('div');
    avatar.className = 'token-avatar';
    const name = document.createElement('div');
    name.className = 'token-name';
    el.append(avatar, name);

    if (this.canDrag(playerId)) {
      el.addEventListener('pointerdown', (evt) => this._onPointerDown(evt, playerId));
    } else {
      el.style.cursor = 'default';
    }
    return el;
  }

  _updateContent(el, player) {
    const avatar = el.querySelector('.token-avatar');
    const name = el.querySelector('.token-name');
    name.textContent = player.name;
    if (player.avatar_url) {
      avatar.style.backgroundImage = `url("${player.avatar_url}")`;
      avatar.style.backgroundColor = 'transparent';
    } else {
      avatar.style.backgroundImage = 'none';
      avatar.style.backgroundColor = colorForId(player.id);
    }
  }

  _onPointerDown(evt, playerId) {
    evt.stopPropagation();
    evt.preventDefault();
    const el = this.elements.get(playerId);
    el.setPointerCapture(evt.pointerId);
    this.draggingPlayerId = playerId;

    const viewportRect = this.board.viewport.getBoundingClientRect();

    const onMove = (moveEvt) => {
      const { x, y } = this._screenToPercent(
        moveEvt.clientX - viewportRect.left,
        moveEvt.clientY - viewportRect.top
      );
      this.positions.set(playerId, { x, y });
      const scr = this._percentToScreen(x, y);
      el.style.left = `${scr.x}px`;
      el.style.top = `${scr.y}px`;
      this.onDragging?.(playerId, x, y);
    };

    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      this.draggingPlayerId = null;
      const pos = this.positions.get(playerId);
      this.onMove(playerId, pos.x, pos.y);
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }
}
