import { getParams, buildUrl } from './url.js';
import { createRoom, verifyOwner, getPlayerIdForToken, fetchRoom, uploadMapImage, updateRoomMap, setPlayerEditAllowed, fetchAppSettings } from './room.js';
import { Board, subscribeRoom } from './board.js';
import { fetchPlayers, createPlayer, editPlayer, deletePlayer, moveToken, uploadAvatarImage, subscribeRoomPlayers, getPlayerTokens } from './players.js';
import { TokensRenderer } from './tokens.js';

const $ = (id) => document.getElementById(id);
const landing = $('landing');
const boardView = $('board-view');
const statusEl = $('status');
const roleBadge = $('role-badge');
const ownerControls = $('owner-controls');
const playerPanel = $('player-panel');
const playerList = $('player-list');
const selfPanel = $('self-panel');

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
    const createBtn = $('create-room-btn');
    createBtn.addEventListener('click', onCreateRoom);

    const settings = await fetchAppSettings().catch(() => ({ disable_room_creation: false }));
    if (settings.disable_room_creation) {
      createBtn.disabled = true;
      $('create-room-disabled-hint').hidden = false;
    }
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
  let currentBackgroundUrl = room?.background_url ?? null;
  if (currentBackgroundUrl) {
    await board.setImageUrl(currentBackgroundUrl).catch(() => showStatus('Не удалось загрузить карту.', true));
  }

  subscribeRoom(roomId, (updatedRoom) => {
    if (updatedRoom.background_url !== currentBackgroundUrl) {
      currentBackgroundUrl = updatedRoom.background_url;
      board.setImageUrl(currentBackgroundUrl).catch(() => showStatus('Не удалось загрузить карту.', true));
    }
    if (role === 'player') {
      applyPlayerEditAllowed(updatedRoom.allow_player_edit);
    }
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
    if (role === 'owner') {
      const playerTokens = await getPlayerTokens(roomId, ownerToken);
      renderPlayerList(players, roomId, ownerToken, refreshPlayers, playerTokens);
    } else if (role === 'player') {
      prefillSelfEditForm(players.find((p) => p.id === myPlayerId));
    }
    return players;
  }
  await refreshPlayers();

  if (role === 'owner') {
    ownerControls.hidden = false;
    playerPanel.hidden = false;
    wireOwnerMapControls(roomId, ownerToken, board);
    wireAddPlayerForm(roomId, ownerToken, refreshPlayers);
    wirePlayerPanelToggle();
    wireCopyAllLinks(roomId, ownerToken);
    wireAllowPlayerEditToggle(roomId, ownerToken, room?.allow_player_edit ?? false);
  } else if (role === 'player') {
    selfPanel.hidden = false;
    selfPanel.classList.add('collapsed');
    $('toggle-self-panel').textContent = '+';
    wireSelfPanelToggle();
    wireSelfEditForm(roomId, myPlayerId, playerToken, refreshPlayers);
    applyPlayerEditAllowed(room?.allow_player_edit ?? false);
  }
}

async function copyToClipboard(text) {
  await navigator.clipboard.writeText(text);
}

function wireCopyAllLinks(roomId, ownerToken) {
  $('copy-all-links-btn').addEventListener('click', async () => {
    try {
      const [players, playerTokens] = await Promise.all([
        fetchPlayers(roomId),
        getPlayerTokens(roomId, ownerToken),
      ]);
      if (players.length === 0) {
        showStatus('Пока нет ни одного игрока.');
        return;
      }
      const text = players
        .map((p) => `${p.name}:\n${buildUrl({ roomId, playerToken: playerTokens.get(p.id) })}`)
        .join('\n\n');
      await copyToClipboard(text);
      showStatus('Список ссылок скопирован.');
    } catch (err) {
      showStatus(`Не удалось скопировать ссылки: ${err.message}`, true);
    }
  });
}

function wirePlayerPanelToggle() {
  const toggleBtn = $('toggle-player-panel');
  toggleBtn.addEventListener('click', () => {
    const collapsed = playerPanel.classList.toggle('collapsed');
    toggleBtn.textContent = collapsed ? '+' : '−';
  });
}

function wireAllowPlayerEditToggle(roomId, ownerToken, initialValue) {
  const checkbox = $('allow-player-edit-toggle');
  checkbox.checked = initialValue;
  checkbox.addEventListener('change', async () => {
    const allowed = checkbox.checked;
    try {
      await setPlayerEditAllowed(roomId, ownerToken, allowed);
      showStatus(allowed ? 'Игроки теперь могут менять свои данные.' : 'Редактирование для игроков выключено.');
    } catch (err) {
      checkbox.checked = !allowed;
      showStatus(`Не удалось изменить настройку: ${err.message}`, true);
    }
  });
}

function wireSelfPanelToggle() {
  const toggleBtn = $('toggle-self-panel');
  toggleBtn.addEventListener('click', () => {
    const collapsed = selfPanel.classList.toggle('collapsed');
    toggleBtn.textContent = collapsed ? '+' : '−';
  });
}

function applyPlayerEditAllowed(allowed) {
  $('self-edit-hint').hidden = allowed;
  $('self-name').disabled = !allowed;
  $('self-avatar-file').disabled = !allowed;
  $('self-avatar-url').disabled = !allowed;
  $('self-edit-save-btn').disabled = !allowed;
}

function prefillSelfEditForm(player) {
  if (!player) return;
  const nameInput = $('self-name');
  const urlInput = $('self-avatar-url');
  if (document.activeElement !== nameInput) nameInput.value = player.name;
  if (document.activeElement !== urlInput) urlInput.value = player.avatar_url || '';
}

function wireSelfEditForm(roomId, myPlayerId, playerToken, refreshPlayers) {
  $('self-edit-form').addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const name = $('self-name').value.trim();
    if (!name) return;
    const file = $('self-avatar-file').files[0];
    const urlInput = $('self-avatar-url').value.trim();

    try {
      let avatarUrl = urlInput || undefined;
      if (file) avatarUrl = await uploadAvatarImage(roomId, file);
      await editPlayer(myPlayerId, { name, avatarUrl, playerToken });
      $('self-avatar-file').value = '';
      await refreshPlayers();
      showStatus('Данные обновлены.');
    } catch (err) {
      showStatus(`Не удалось сохранить: ${err.message}`, true);
    }
  });
}

async function onCreateRoom() {
  try {
    const { roomId, ownerToken } = await createRoom();
    window.location.href = buildUrl({ roomId, ownerToken });
  } catch (err) {
    const message = err.message.includes('room_creation_disabled')
      ? 'Создание новых комнат временно отключено.'
      : `Не удалось создать комнату: ${err.message}`;
    showStatus(message, true);
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

function renderPlayerList(players, roomId, ownerToken, refreshPlayers, playerTokens) {
  playerList.innerHTML = '';
  for (const player of players) {
    playerList.appendChild(createPlayerRow(player, roomId, ownerToken, refreshPlayers, playerTokens));
  }
}

function createPlayerRow(player, roomId, ownerToken, refreshPlayers, playerTokens) {
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

  const copyLinkBtn = document.createElement('button');
  copyLinkBtn.className = 'icon-btn';
  copyLinkBtn.type = 'button';
  copyLinkBtn.textContent = '🔗';
  copyLinkBtn.title = 'Скопировать ссылку игрока';
  copyLinkBtn.addEventListener('click', async () => {
    try {
      const playerToken = playerTokens.get(player.id);
      await copyToClipboard(buildUrl({ roomId, playerToken }));
      showStatus(`Ссылка «${player.name}» скопирована.`);
    } catch (err) {
      showStatus(`Не удалось скопировать ссылку: ${err.message}`, true);
    }
  });

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

  actions.append(copyLinkBtn, editBtn, deleteBtn);
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
      await editPlayer(player.id, { name: nameInput.value.trim(), avatarUrl, ownerToken });
      form.remove();
      await refreshPlayers();
      showStatus('Игрок обновлён.');
    } catch (err) {
      showStatus(`Не удалось сохранить: ${err.message}`, true);
    }
  });
}

main().catch((err) => showStatus(`Ошибка: ${err.message}`, true));
