// Query-param based routing. Deliberately not path-based (`/room/:id/...`)
// because GitHub Pages serves a static bundle and cannot rewrite arbitrary
// paths — a direct link to a path-based URL would 404 on load/refresh.

export function getParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    roomId: params.get('room'),
    ownerToken: params.get('owner'),
    playerToken: params.get('player'),
  };
}

export function buildUrl({ roomId, ownerToken, playerToken }) {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('room', roomId);
  if (ownerToken) url.searchParams.set('owner', ownerToken);
  if (playerToken) url.searchParams.set('player', playerToken);
  return url.toString();
}
