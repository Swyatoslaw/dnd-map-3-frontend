import { supabase } from './supabaseClient.js';

export async function createRoom() {
  const { data, error } = await supabase.rpc('create_room');
  if (error) throw error;
  // rpc() with a set-returning function returns an array of rows.
  const row = Array.isArray(data) ? data[0] : data;
  return { roomId: row.room_id, ownerToken: row.owner_token };
}

export async function verifyOwner(roomId, ownerToken) {
  const { data, error } = await supabase.rpc('verify_owner', {
    p_room_id: roomId,
    p_owner_token: ownerToken,
  });
  if (error) throw error;
  return data === true;
}

export async function getPlayerIdForToken(roomId, playerToken) {
  const { data, error } = await supabase.rpc('get_player_id_for_token', {
    p_room_id: roomId,
    p_player_token: playerToken,
  });
  if (error) throw error;
  return data;
}

export async function fetchRoom(roomId) {
  const { data, error } = await supabase
    .from('rooms')
    .select('id, background_url, allow_player_edit')
    .eq('id', roomId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

const MAP_EXT_FALLBACK = 'png';

export async function uploadMapImage(roomId, file) {
  const ext = (file.name.split('.').pop() || MAP_EXT_FALLBACK).toLowerCase();
  const path = `${roomId}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from('maps').upload(path, file);
  if (uploadError) throw uploadError;
  const { data } = supabase.storage.from('maps').getPublicUrl(path);
  return data.publicUrl;
}

export async function updateRoomMap(roomId, ownerToken, backgroundUrl) {
  const { error } = await supabase.rpc('update_room_map', {
    p_room_id: roomId,
    p_owner_token: ownerToken,
    p_background_url: backgroundUrl,
  });
  if (error) throw error;
}

export async function setPlayerEditAllowed(roomId, ownerToken, allowed) {
  const { error } = await supabase.rpc('set_player_edit_allowed', {
    p_room_id: roomId,
    p_owner_token: ownerToken,
    p_allowed: allowed,
  });
  if (error) throw error;
}

// app_settings is a manually-edited, dashboard-only table (see
// dnd-map-3-supabase README) — this only ever reads it.
export async function fetchAppSettings() {
  const { data, error } = await supabase
    .from('app_settings')
    .select('disable_room_creation')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return data ?? { disable_room_creation: false };
}
