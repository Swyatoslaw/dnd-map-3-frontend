import { getParams, buildUrl } from './url.js';
import { createRoom, verifyOwner, getPlayerIdForToken, fetchRoom, uploadMapImage, updateRoomMap } from './room.js';
import { Board, subscribeRoomMap } from './board.js';
import { fetchPlayers, createPlayer, editPlayer, deletePlayer, moveToken, uploadAvatarImage, subscribeRoomPlayers } from './players.js';
import { TokensRenderer } from './tokens.js';

const $ = (id) => document.getElementById(id);
const landing = $('landing');
const boardView = $('board-view');
const statusEl = $('status');
const roleBadge = $('role-badge');
const ownerControls = $('owner-controls');
const playerPanel = $('player-panel');
const playerList = $('player-list');

function showStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
  statusEl.hidden = false;
  if (!isError) {
    setTimeout(() => { statusEl.hidden = true; }, 3000);
  }
}

async function main() {
  const { roomId, ownerToken, playerToken } = getParams();

  if (!roomId) {
    landing.hidden = false;
    $('create-room-btn').addEventListener('click', onCreateRoom);
    return;
  }

  let role = null;
  let myPlayerId = null;
  if (ownerToken) {
    role = (await verifyOwner(roomId, ownerToken)) ? 'owner' : null;
  } else if (playerToken) {
    myPlayerId = await getPlayerIdForToken(roomId, playerToken);
    role = myPlayerId ? 'player' : null;
  }

  if (!role) {
    landing.hidden = true;
    boardView.hidden = true;
    showStatus('Ссылка недействительна: комната или токен не найдены.', true);
    return;
  }

  boardView.hidden = false;
  roleBadge.textContent = role === 'owner' ? 'Ведущий' : 'Игрок';

  let tokens;
  const board = new Board({
    viewportEl: $('viewport'),
    stageEl: $('stage'),
    imageEl: $('map-image'),
    onTransformChange: () => tokens?.reposition(),
  });

  const room = await fetchRoom(roomId);
  if (room?.background_url) {
    await board.setImageUrl(room.background_url).catch(() => showStatus('Не удалось загрузить карту.', true));
  }

  subscribeRoomMap(roomId, (url) => {
    board.setImageUrl(url).catch(() => showStatus('Не удалось загрузить карту.', true));
  });

  const roomChannel = subscribeRoomPlayers(roomId, {
    onPlayersChange: () => refreshPlayers(),
    onTokenBroadcast: ({ playerId, x, y }) => tokens.applyRemotePosition(playerId, x, y),
  });

  tokens = new TokensRenderer({
    layerEl: $('tokens-layer'),
    board,
    isOwner: role === 'owner',
    myPlayerId,
    onMove: (playerId, x, y) => {
      moveToken(playerId, x, y, { ownerToken, playerToken }).catch(
        (err) => showStatus(`Не удалось передвинуть фишку: ${err.message}`, true)
      );
    },
    onDragging: (playerId, x, y) => roomChannel.broadcastMove(playerId, x, y),
  });

  async function refreshPlayers() {
    const players = await fetchPlayers(roomId);
    tokens.render(players);
    if (role === 'owner') renderPlayerList(players, roomId, ownerToken, refreshPlayers);
    return players;
  }
  await refreshPlayers();

  if (role === 'owner') {
    ownerControls.hidden = false;
    playerPanel.hidden = false;
    wireOwnerMapControls(roomId, ownerToken, board);
    wireAddPlayerForm(roomId, ownerToken, refreshPlayers);
    wirePlayerPanelToggle();
  }
}

function wirePlayerPanelToggle() {
  const toggleBtn = $('toggle-player-panel');
  toggleBtn.addEventListener('click', () => {
    const collapsed = playerPanel.classList.toggle('collapsed');
    toggleBtn.textContent = collapsed ? '+' : '−';
  });
}

async function onCreateRoom() {
  try {
    const { roomId, ownerToken } = await createRoom();
    window.location.href = buildUrl({ roomId, ownerToken });
  } catch (err) {
    showStatus(`Не удалось создать комнату: ${err.message}`, true);
  }
}

function wireOwnerMapControls(roomId, ownerToken, board) {
  $('map-file-input').addEventListener('change', async (evt) => {
    const file = evt.target.files[0];
    if (!file) return;
    try {
      showStatus('Загрузка карты...');
      const url = await uploadMapImage(roomId, file);
      await updateRoomMap(roomId, ownerToken, url);
      await board.setImageUrl(url);
      showStatus('Карта обновлена.');
    } catch (err) {
      showStatus(`Ошибка загрузки карты: ${err.message}`, true);
    } finally {
      evt.target.value = '';
    }
  });

  $('map-url-btn').addEventListener('click', async () => {
    const url = $('map-url-input').value.trim();
    if (!url) return;
    try {
      await updateRoomMap(roomId, ownerToken, url);
      await board.setImageUrl(url);
      showStatus('Карта обновлена.');
    } catch (err) {
      showStatus(`Ошибка: ${err.message}`, true);
    }
  });
}

function wireAddPlayerForm(roomId, ownerToken, refreshPlayers) {
  $('add-player-form').addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const name = $('new-player-name').value.trim();
    if (!name) return;
    const file = $('new-player-avatar-file').files[0];
    const urlInput = $('new-player-avatar-url').value.trim();

    try {
      let avatarUrl = urlInput || null;
      if (file) avatarUrl = await uploadAvatarImage(roomId, file);
      await createPlayer(roomId, ownerToken, name, avatarUrl);
      evt.target.reset();
      await refreshPlayers();
      showStatus('Игрок добавлен.');
    } catch (err) {
      showStatus(`Не удалось добавить игрока: ${err.message}`, true);
    }
  });
}

function renderPlayerList(players, roomId, ownerToken, refreshPlayers) {
  playerList.innerHTML = '';
  for (const player of players) {
    playerList.appendChild(createPlayerRow(player, roomId, ownerToken, refreshPlayers));
  }
}

function createPlayerRow(player, roomId, ownerToken, refreshPlayers) {
  const row = document.createElement('div');
  row.className = 'player-row';

  const avatar = document.createElement('div');
  avatar.className = 'player-row-avatar';
  if (player.avatar_url) {
    avatar.style.backgroundImage = `url("${player.avatar_url}")`;
  } else {
    avatar.style.backgroundColor = '#5865f2';
  }

  const name = document.createElement('span');
  name.className = 'player-row-name';
  name.textContent = player.name;

  const actions = document.createElement('div');
  actions.className = 'player-row-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'icon-btn';
  editBtn.type = 'button';
  editBtn.textContent = '✎';
  editBtn.title = 'Редактировать';
  editBtn.addEventListener('click', () => toggleEditForm(row, player, roomId, ownerToken, refreshPlayers));

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'icon-btn';
  deleteBtn.type = 'button';
  deleteBtn.textContent = '🗑';
  deleteBtn.title = 'Удалить';
  deleteBtn.addEventListener('click', async () => {
    if (!confirm(`Удалить игрока «${player.name}»?`)) return;
    try {
      await deletePlayer(player.id, ownerToken);
      await refreshPlayers();
    } catch (err) {
      showStatus(`Не удалось удалить игрока: ${err.message}`, true);
    }
  });

  actions.append(editBtn, deleteBtn);
  row.append(avatar, name, actions);
  return row;
}

function toggleEditForm(row, player, roomId, ownerToken, refreshPlayers) {
  const existing = row.nextElementSibling;
  if (existing?.classList.contains('player-edit-form')) {
    existing.remove();
    return;
  }

  const form = document.createElement('form');
  form.className = 'player-edit-form';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = player.name;
  nameInput.required = true;

  const avatarUrlInput = document.createElement('input');
  avatarUrlInput.type = 'url';
  avatarUrlInput.placeholder = 'URL аватара';
  avatarUrlInput.value = player.avatar_url || '';

  const avatarFileLabel = document.createElement('label');
  avatarFileLabel.className = 'btn btn-secondary';
  avatarFileLabel.textContent = 'Аватар (файл)';
  const avatarFileInput = document.createElement('input');
  avatarFileInput.type = 'file';
  avatarFileInput.accept = 'image/*';
  avatarFileInput.hidden = true;
  avatarFileLabel.appendChild(avatarFileInput);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Сохранить';

  form.append(nameInput, avatarFileLabel, avatarUrlInput, saveBtn);
  row.after(form);

  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    try {
      let avatarUrl = avatarUrlInput.value.trim() || undefined;
      const file = avatarFileInput.files[0];
      if (file) avatarUrl = await uploadAvatarImage(roomId, file);
      await editPlayer(player.id, ownerToken, { name: nameInput.value.trim(), avatarUrl });
      form.remove();
      await refreshPlayers();
      showStatus('Игрок обновлён.');
    } catch (err) {
      showStatus(`Не удалось сохранить: ${err.message}`, true);
    }
  });
}

main().catch((err) => showStatus(`Ошибка: ${err.message}`, true));
