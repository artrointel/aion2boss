import { get, onDisconnect, onValue, ref, remove, set, update } from 'firebase/database'
import { db } from './firebase'

export function subscribeServerTimeOffset(callback) {
  return onValue(ref(db, '.info/serverTimeOffset'), (snapshot) => {
    callback(snapshot.val())
  })
}

export function subscribeRoomBosses(roomId, callback) {
  return onValue(ref(db, `${roomId}/bosses`), (snapshot) => {
    callback(snapshot.val())
  })
}

export function subscribeRoomSettings(roomId, callback) {
  return onValue(ref(db, `${roomId}/settings`), (snapshot) => {
    callback(snapshot.val())
  })
}

export function subscribeRoomPresence(roomId, callback) {
  return onValue(ref(db, `${roomId}/presence`), (snapshot) => {
    callback(snapshot.val())
  })
}

export function subscribeConnectionStatus(callback) {
  return onValue(ref(db, '.info/connected'), (snapshot) => {
    callback(snapshot.val())
  })
}

export function createPresenceSessionRef(roomId, browserId, sessionId) {
  return ref(db, `${roomId}/presence/${browserId}/${sessionId}`)
}

export function scheduleDisconnectRemove(targetRef) {
  return onDisconnect(targetRef).remove()
}

export function cancelDisconnect(targetRef) {
  return onDisconnect(targetRef).cancel()
}

export function setValue(targetRef, payload) {
  return set(targetRef, payload)
}

export function updateValue(targetRef, payload) {
  return update(targetRef, payload)
}

export function removeValue(targetRef) {
  return remove(targetRef)
}

export function updateBoss(roomId, key, payload) {
  return update(ref(db, `${roomId}/bosses/${key}`), payload)
}

export function removeBoss(roomId, key) {
  return remove(ref(db, `${roomId}/bosses/${key}`))
}

export function updateRoot(payload) {
  return update(ref(db), payload)
}

export function updateRoomSettings(roomId, payload) {
  return update(ref(db, `${roomId}/settings`), payload)
}

export function getRoomSnapshot(roomId) {
  return get(ref(db, roomId))
}
