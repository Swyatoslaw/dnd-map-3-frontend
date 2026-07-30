function colorForId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 45%)`;
}

// Renders players as absolutely-positioned DOM elements (left/top in % —
// same coordinate space as players.x/y) inside the board's tokens layer, and
// handles Pointer Events dragging with permission checks (owner: any token,
// player: only their own).
export class TokensRenderer {
  constructor({ layerEl, board, isOwner, myPlayerId, onMove }) {
    this.layer = layerEl;
    this.board = board;
    this.isOwner = isOwner;
    this.myPlayerId = myPlayerId;
    this.onMove = onMove;
    this.elements = new Map();
    this.draggingPlayerId = null;
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
      if (this.draggingPlayerId !== player.id) {
        el.style.left = `${player.x}%`;
        el.style.top = `${player.y}%`;
      }
      this._updateContent(el, player);
    }
    for (const [id, el] of this.elements) {
      if (!seen.has(id)) {
        el.remove();
        this.elements.delete(id);
      }
    }
  }

  _createElement(playerId) {
    const el = document.createElement('div');
    el.className = 'token';
    el.dataset.playerId = playerId;

    const avatar = document.createElement('img');
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
      avatar.src = player.avatar_url;
      avatar.style.background = 'transparent';
    } else {
      avatar.removeAttribute('src');
      avatar.style.background = colorForId(player.id);
    }
  }

  _onPointerDown(evt, playerId) {
    evt.stopPropagation();
    evt.preventDefault();
    const el = this.elements.get(playerId);
    el.setPointerCapture(evt.pointerId);

    const startClientX = evt.clientX;
    const startClientY = evt.clientY;
    const startLeft = parseFloat(el.style.left) || 0;
    const startTop = parseFloat(el.style.top) || 0;
    this.draggingPlayerId = playerId;

    const onMove = (moveEvt) => {
      const dxPct = ((moveEvt.clientX - startClientX) / this.board.scale / this.board.naturalWidth) * 100;
      const dyPct = ((moveEvt.clientY - startClientY) / this.board.scale / this.board.naturalHeight) * 100;
      const x = Math.min(100, Math.max(0, startLeft + dxPct));
      const y = Math.min(100, Math.max(0, startTop + dyPct));
      el.style.left = `${x}%`;
      el.style.top = `${y}%`;
    };

    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      this.draggingPlayerId = null;
      const x = parseFloat(el.style.left) || 0;
      const y = parseFloat(el.style.top) || 0;
      this.onMove(playerId, x, y);
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }
}
