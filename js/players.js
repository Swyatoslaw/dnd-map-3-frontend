import { supabase } from './supabaseClient.js';

export async function fetchPlayers(roomId) {
  const { data, error } = await supabase
    .from('players')
    .select('id, room_id, name, avatar_url, x, y')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function createPlayer(roomId, ownerToken, name, avatarUrl) {
  const { data, error } = await supabase.rpc('create_player', {
    p_room_id: roomId,
    p_owner_token: ownerToken,
    p_name: name,
    p_avatar_url: avatarUrl || null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { playerId: row.player_id, playerToken: row.player_token };
}

export async function editPlayer(playerId, ownerToken, { name, avatarUrl } = {}) {
  const { error } = await supabase.rpc('edit_player', {
    p_player_id: playerId,
    p_owner_token: ownerToken,
    p_name: name ?? null,
    p_avatar_url: avatarUrl ?? null,
  });
  if (error) throw error;
}

export async function deletePlayer(playerId, ownerToken) {
  const { error } = await supabase.rpc('delete_player', {
    p_player_id: playerId,
    p_owner_token: ownerToken,
  });
  if (error) throw error;
}

export async function moveToken(playerId, x, y, { ownerToken, playerToken } = {}) {
  const { error } = await supabase.rpc('move_token', {
    p_player_id: playerId,
    p_x: x,
    p_y: y,
    p_owner_token: ownerToken ?? null,
    p_player_token: playerToken ?? null,
  });
  if (error) throw error;
}

export async function uploadAvatarImage(roomId, file) {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const path = `${roomId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('avatars').upload(path, file);
  if (error) throw error;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl;
}

export function subscribePlayers(roomId, { onChange }) {
  const channel = supabase
    .channel(`room-players-${roomId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` },
      onChange
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}
