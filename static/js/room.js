const socket = io();
const roomId = window.ROOM_ID;
const storedProfile = JSON.parse(localStorage.getItem('legendary-uno-profile') || '{}');
const profile = {
  username: storedProfile.username || 'زائر',
  character: storedProfile.character || Object.keys(window.CHARACTERS)[0],
  avatar: storedProfile.avatar || '',
};

let mySid = null;
let roomState = null;
let peers = {};
let remoteAudioEls = {};
let localStream = null;
let audioContext = null;
let speakingInterval = null;
let micMuted = false;
let speakerMuted = false;
let lastRenderedActionKey = '';

const els = {
  roomCode: document.getElementById('roomCode'),
  roomLobby: document.getElementById('roomLobby'),
  profileNameInput: document.getElementById('profileNameInput'),
  myAvatarPreview: document.getElementById('myAvatarPreview'),
  avatarInput: document.getElementById('avatarInput'),
  characterSelect: document.getElementById('characterSelect'),
  saveProfileBtn: document.getElementById('saveProfileBtn'),
  characterSpotlight: document.getElementById('characterSpotlight'),
  settingsToggleBtn: document.getElementById('settingsToggleBtn'),
  settingsPanel: document.getElementById('settingsPanel'),
  startingCardsInput: document.getElementById('startingCardsInput'),
  startingCardsValue: document.getElementById('startingCardsValue'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  startGameBtn: document.getElementById('startGameBtn'),
  micToggleBtn: document.getElementById('micToggleBtn'),
  speakerToggleBtn: document.getElementById('speakerToggleBtn'),
  micIcon: document.getElementById('micIcon'),
  speakerIcon: document.getElementById('speakerIcon'),
  playersMeta: document.getElementById('playersMeta'),
  playersRing: document.getElementById('playersRing'),
  benchPlayers: document.getElementById('benchPlayers'),
  gameMessage: document.getElementById('gameMessage'),
  lastPlayerBadge: document.getElementById('lastPlayerBadge'),
  drawPile: document.getElementById('drawPile'),
  drawCount: document.getElementById('drawCount'),
  topCardImage: document.getElementById('topCardImage'),
  currentColorBadge: document.getElementById('currentColorBadge'),
  drawCardBtn: document.getElementById('drawCardBtn'),
  passTurnBtn: document.getElementById('passTurnBtn'),
  callUnoBtn: document.getElementById('callUnoBtn'),
  catchUnoBtn: document.getElementById('catchUnoBtn'),
  challengePanel: document.getElementById('challengePanel'),
  acceptWild4Btn: document.getElementById('acceptWild4Btn'),
  challengeWild4Btn: document.getElementById('challengeWild4Btn'),
  handMeta: document.getElementById('handMeta'),
  myHandTray: document.getElementById('myHandTray'),
  toastStack: document.getElementById('toastStack'),
  tableArena: document.getElementById('tableArena'),
  discardPile: document.getElementById('discardPile'),
};

els.roomCode.textContent = roomId;
els.profileNameInput.value = profile.username;
els.characterSelect.value = profile.character;
renderCharacterSpotlight(profile.character);

function cardSrc(asset) {
  return `/static/cards/${asset}.svg`;
}

function iconSrc(name) {
  return `/static/icons/${name}.svg`;
}

function persistProfile() {
  localStorage.setItem('legendary-uno-profile', JSON.stringify(profile));
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  els.toastStack.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-8px)';
    setTimeout(() => toast.remove(), 280);
  }, 3200);
}

function renderCharacterSpotlight(key) {
  const c = window.CHARACTERS[key] || Object.values(window.CHARACTERS)[0];
  els.characterSpotlight.innerHTML = `
    <div class="spotlight-inner">
      <img src="${c.avatar}" alt="${c.name}" referrerpolicy="no-referrer">
      <div class="spotlight-copy">
        <h3>${c.name}</h3>
        <p>${c.bio}</p>
      </div>
    </div>`;
  els.myAvatarPreview.src = profile.avatar || c.avatar;
}

els.characterSelect.addEventListener('change', () => {
  profile.character = els.characterSelect.value;
  if (!profile.avatar || profile.avatar.startsWith('https://upload.wikimedia.org/')) {
    profile.avatar = window.CHARACTERS[profile.character]?.avatar || '';
  }
  renderCharacterSpotlight(profile.character);
  persistProfile();
});

els.avatarInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('اختر صورة فقط', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    profile.avatar = reader.result;
    els.myAvatarPreview.src = profile.avatar;
    persistProfile();
  };
  reader.readAsDataURL(file);
});

els.saveProfileBtn.addEventListener('click', () => {
  profile.username = (els.profileNameInput.value || 'زائر').trim().slice(0, 24) || 'زائر';
  persistProfile();
  socket.emit('update_profile', { room_id: roomId, username: profile.username, character: profile.character, avatar: profile.avatar });
  showToast('تم حفظ الملف الشخصي', 'success');
});

els.startingCardsInput.addEventListener('input', () => {
  els.startingCardsValue.textContent = els.startingCardsInput.value;
});
els.saveSettingsBtn.addEventListener('click', () => {
  socket.emit('update_settings', { room_id: roomId, starting_cards: Number(els.startingCardsInput.value) });
  showToast('تم حفظ الإعدادات', 'success');
});
els.startGameBtn.addEventListener('click', () => socket.emit('start_game', { room_id: roomId }));
els.drawCardBtn.addEventListener('click', () => socket.emit('draw_card', { room_id: roomId }));
els.passTurnBtn.addEventListener('click', () => socket.emit('pass_turn', { room_id: roomId }));
els.callUnoBtn.addEventListener('click', () => socket.emit('call_uno', { room_id: roomId }));
els.acceptWild4Btn.addEventListener('click', () => socket.emit('resolve_wild4', { room_id: roomId, challenge: false }));
els.challengeWild4Btn.addEventListener('click', () => socket.emit('resolve_wild4', { room_id: roomId, challenge: true }));
els.catchUnoBtn.addEventListener('click', () => {
  if (!roomState?.catchable_uno?.length) {
    showToast('لا يوجد لاعب قابل للكشف الآن', 'info');
    return;
  }
  const targetSid = roomState.catchable_uno[0];
  socket.emit('catch_uno', { room_id: roomId, target_sid: targetSid });
});

els.settingsToggleBtn.addEventListener('click', () => {
  const willOpen = els.settingsPanel.classList.contains('hidden');
  els.settingsPanel.classList.toggle('hidden');
  els.settingsPanel.animate([
    { opacity: willOpen ? 0 : 1, transform: `translateY(${willOpen ? 10 : 0}px)` },
    { opacity: willOpen ? 1 : 0.98, transform: 'translateY(0)' },
  ], { duration: 180, easing: 'ease-out' });
});

function setMicMuted(nextMuted) {
  micMuted = nextMuted;
  if (localStream) {
    localStream.getAudioTracks().forEach((track) => { track.enabled = !micMuted; });
  }
  els.micIcon.src = iconSrc(micMuted ? 'mic-off' : 'mic');
  socket.emit('toggle_mute', { room_id: roomId, muted: micMuted });
}

function setSpeakerMuted(nextMuted) {
  speakerMuted = nextMuted;
  Object.values(remoteAudioEls).forEach((el) => { el.muted = speakerMuted; });
  els.speakerIcon.src = iconSrc(speakerMuted ? 'speaker-off' : 'speaker');
  socket.emit('toggle_speaker', { room_id: roomId, speaker_muted: speakerMuted });
}

els.micToggleBtn.addEventListener('click', async () => {
  if (!localStream) await initAudio();
  setMicMuted(!micMuted);
});
els.speakerToggleBtn.addEventListener('click', () => setSpeakerMuted(!speakerMuted));

async function initAudio() {
  if (localStream) return localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    localStream.getAudioTracks().forEach((track) => { track.enabled = !micMuted; });
    setupSpeakingDetector();
    syncPeers();
    return localStream;
  } catch (error) {
    showToast('تعذر تشغيل المايك. اسمح بالوصول للصوت من المتصفح.', 'error');
    throw error;
  }
}

function setupSpeakingDetector() {
  if (!localStream || speakingInterval) return;
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioContext.createMediaStreamSource(localStream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  let active = false;
  speakingInterval = setInterval(() => {
    if (micMuted) {
      if (active) {
        active = false;
        socket.emit('speaking_state', { room_id: roomId, speaking: false });
      }
      return;
    }
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
    const next = avg > 22;
    if (next !== active) {
      active = next;
      socket.emit('speaking_state', { room_id: roomId, speaking: next });
    }
  }, 260);
}

function createPeerConnection(targetSid) {
  if (peers[targetSid]) return peers[targetSid];
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  peers[targetSid] = pc;

  if (localStream) {
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) socket.emit('webrtc_ice', { target_sid: targetSid, candidate: event.candidate });
  };

  pc.ontrack = (event) => {
    let audio = remoteAudioEls[targetSid];
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      audio.playsInline = true;
      audio.muted = speakerMuted;
      remoteAudioEls[targetSid] = audio;
      document.body.appendChild(audio);
    }
    audio.srcObject = event.streams[0];
  };

  return pc;
}

async function ensureOffer(targetSid) {
  if (!mySid || mySid > targetSid) return;
  try {
    const pc = createPeerConnection(targetSid);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('webrtc_offer', { target_sid: targetSid, offer });
  } catch (error) {
    console.error('offer error', error);
  }
}

function cleanupPeers(liveIds) {
  Object.keys(peers).forEach((sid) => {
    if (liveIds.includes(sid)) return;
    peers[sid].close();
    delete peers[sid];
    remoteAudioEls[sid]?.remove();
    delete remoteAudioEls[sid];
  });
}

function syncPeers() {
  if (!roomState?.players || !mySid) return;
  const others = roomState.players.map((p) => p.id).filter((id) => id !== mySid);
  cleanupPeers(others);
  others.forEach((sid) => {
    createPeerConnection(sid);
    ensureOffer(sid);
  });
}

socket.on('joined_ack', async ({ sid }) => {
  mySid = sid;
  socket.emit('update_profile', { room_id: roomId, username: profile.username, character: profile.character, avatar: profile.avatar });
  try { await initAudio(); } catch (_) {}
});

socket.on('toast', (payload) => showToast(payload.message, payload.type));
socket.on('user_speaking', ({ user_id, speaking }) => {
  const node = document.querySelector(`.player-node[data-sid="${user_id}"]`);
  if (node) node.classList.toggle('speaking', speaking);
});

socket.on('webrtc_offer', async ({ offer, from_sid }) => {
  try {
    const pc = createPeerConnection(from_sid);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('webrtc_answer', { target_sid: from_sid, answer });
  } catch (error) {
    console.error('offer receive error', error);
  }
});

socket.on('webrtc_answer', async ({ answer, from_sid }) => {
  try {
    const pc = createPeerConnection(from_sid);
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  } catch (error) {
    console.error('answer receive error', error);
  }
});

socket.on('webrtc_ice', async ({ candidate, from_sid }) => {
  try {
    const pc = createPeerConnection(from_sid);
    await pc.addIceCandidate(candidate);
  } catch (error) {
    console.error('ice receive error', error);
  }
});

socket.on('room_state', (state) => {
  roomState = state;
  renderState();
  syncPeers();
});

function getPlayer(sid) {
  return roomState?.players?.find((player) => player.id === sid);
}

function actionKey(action) {
  if (!action) return '';
  return JSON.stringify([action.type, action.sid, action.target_sid, action.card?.id, action.count, action.top_card?.id, roomState?.round_number]);
}

function animateCardFromTo(srcEl, targetEl, src) {
  if (!srcEl || !targetEl) return;
  const s = srcEl.getBoundingClientRect();
  const t = targetEl.getBoundingClientRect();
  const flyer = document.createElement('img');
  flyer.src = src;
  flyer.className = 'flying-card';
  flyer.style.left = `${s.left}px`;
  flyer.style.top = `${s.top}px`;
  flyer.style.width = `${s.width}px`;
  document.body.appendChild(flyer);
  requestAnimationFrame(() => {
    flyer.style.left = `${t.left}px`;
    flyer.style.top = `${t.top}px`;
    flyer.style.width = `${t.width}px`;
    flyer.style.transform = 'rotate(8deg)';
    flyer.style.opacity = '.96';
  });
  setTimeout(() => flyer.remove(), 700);
}

function animateLastAction() {
  const action = roomState?.last_action;
  const key = actionKey(action);
  if (!action || key === lastRenderedActionKey) return;
  lastRenderedActionKey = key;

  if (action.type === 'deal' || action.type === 'draw' || action.type === 'draw2' || action.type === 'wild4_accept' || action.type === 'wild4_challenge_fail' || action.type === 'wild4_challenge_success' || action.type === 'catch_uno') {
    const target = action.sid === mySid || action.target_sid === mySid ? els.myHandTray : document.querySelector(`.player-node[data-sid="${action.target_sid || action.sid}"]`);
    if (target) {
      animateCardFromTo(els.drawPile.querySelector('img'), target, cardSrc(action.cards?.[0]?.asset || 'back'));
    }
  }

  if (action.type === 'play' || action.type === 'win') {
    const src = document.querySelector(`.hand-card[data-card-id="${action.card?.id}"]`) || document.querySelector(`.player-node[data-sid="${action.sid}"] img.avatar`);
    animateCardFromTo(src, els.discardPile.querySelector('img'), cardSrc(action.card?.asset || 'back'));
  }
}

function renderPlayers() {
  const players = roomState.players || [];
  const inRound = players.filter((p) => p.in_round);
  const bench = players.filter((p) => !p.in_round);
  els.playersMeta.textContent = `${players.length} لاعب`;
  els.playersRing.innerHTML = '';
  els.benchPlayers.innerHTML = '';
  const cx = els.playersRing.clientWidth / 2;
  const cy = els.playersRing.clientHeight / 2;
  const radius = Math.min(cx, cy) - 68;

  inRound.forEach((player, index) => {
    const angle = (-90 + (360 / Math.max(inRound.length, 1)) * index) * (Math.PI / 180);
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    const node = document.createElement('div');
    node.className = `player-node${player.is_viewer ? ' self' : ''}${player.is_turn ? ' turn' : ''}${player.speaking ? ' speaking' : ''}`;
    node.dataset.sid = player.id;
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.innerHTML = `
      <img class="avatar" src="${player.avatar || window.CHARACTERS[player.character]?.avatar || ''}" alt="${player.name}" referrerpolicy="no-referrer">
      <div class="player-name">${player.name}</div>
      <div class="player-meta">
        ${player.is_host ? '<span class="tag">مضيف</span>' : ''}
        ${player.hand_count >= 0 ? `<span class="tag">${player.hand_count} كرت</span>` : ''}
        ${player.said_uno ? '<span class="tag">UNO</span>' : ''}
      </div>
    `;
    els.playersRing.appendChild(node);
  });

  bench.forEach((player) => {
    const item = document.createElement('div');
    item.className = 'bench-card';
    item.innerHTML = `
      <img src="${player.avatar || window.CHARACTERS[player.character]?.avatar || ''}" alt="${player.name}" referrerpolicy="no-referrer">
      <div>
        <strong>${player.name}</strong>
        <div style="color:var(--muted);font-size:.85rem;">ينتظر الجولة القادمة</div>
      </div>`;
    els.benchPlayers.appendChild(item);
  });
}

function renderTopCard() {
  els.topCardImage.src = roomState.top_card ? cardSrc(roomState.top_card.asset) : cardSrc('back');
  els.drawCount.textContent = roomState.draw_pile_count ?? 0;
  const colorMap = { red: 'أحمر', blue: 'أزرق', green: 'أخضر', yellow: 'أصفر', wild: 'متعدد' };
  els.currentColorBadge.textContent = colorMap[roomState.current_color] || '—';
}

function renderLastPlayerBadge() {
  const action = roomState.last_action;
  if (!action?.sid) {
    els.lastPlayerBadge.innerHTML = '<span>بانتظار أول حركة</span>';
    return;
  }
  const player = getPlayer(action.sid);
  const titleMap = {
    play: 'آخر حركة', win: 'الفائز', draw: 'سحب', call_uno: 'UNO', wild4_accept: 'تم السحب', catch_uno: 'كشف UNO'
  };
  els.lastPlayerBadge.innerHTML = `
    <img src="${player?.avatar || ''}" alt="${player?.name || ''}">
    <div>
      <div style="font-size:.8rem;color:var(--muted);">${titleMap[action.type] || 'آخر لاعب'}</div>
      <strong>${player?.name || '—'}</strong>
    </div>`;
}

function renderMyHand() {
  els.myHandTray.innerHTML = '';
  els.handMeta.textContent = `${roomState.my_hand.length} كرت`;
  const playable = new Set(roomState.my_playable_ids || []);

  roomState.my_hand.forEach((card) => {
    const item = document.createElement('div');
    item.className = `hand-card ${playable.has(card.id) ? 'playable' : 'disabled'}`;
    item.dataset.cardId = card.id;
    item.innerHTML = `<img src="${cardSrc(card.asset)}" alt="${card.label}">`;

    if (card.type === 'wild' || card.type === 'wild4') {
      const chooser = document.createElement('div');
      chooser.className = 'wild-chooser';
      ['red', 'yellow', 'green', 'blue'].forEach((color) => {
        const btn = document.createElement('button');
        btn.className = `color-pick ${color}`;
        btn.addEventListener('click', (event) => {
          event.stopPropagation();
          socket.emit('play_card', { room_id: roomId, card_id: card.id, chosen_color: color });
        });
        chooser.appendChild(btn);
      });
      item.appendChild(chooser);
    }

    item.addEventListener('click', () => {
      if (!playable.has(card.id)) return;
      if (card.type === 'wild' || card.type === 'wild4') {
        item.classList.toggle('choosing');
        return;
      }
      socket.emit('play_card', { room_id: roomId, card_id: card.id });
    });
    els.myHandTray.appendChild(item);
  });
}

function renderControls() {
  els.drawCardBtn.disabled = !roomState.can_draw;
  els.passTurnBtn.disabled = !roomState.can_pass;
  els.callUnoBtn.disabled = !roomState.can_call_uno;
  els.catchUnoBtn.disabled = !(roomState.catchable_uno || []).length;
  els.challengePanel.classList.toggle('hidden', !roomState.pending_challenge?.for_viewer);
}

function renderLobbyAndSettings() {
  const me = getPlayer(mySid);
  const isHost = roomState.host_sid === mySid;
  const shouldShowLobby = roomState.status !== 'playing' || !me?.in_round;
  els.roomLobby.classList.toggle('hidden', !shouldShowLobby);
  els.settingsToggleBtn.classList.toggle('hidden', !isHost);
  if (!isHost) {
    els.settingsPanel.classList.add('hidden');
  }
  els.startingCardsInput.value = roomState.settings.starting_cards;
  els.startingCardsValue.textContent = roomState.settings.starting_cards;
  els.startGameBtn.disabled = !roomState.can_start;
  if (me) {
    els.profileNameInput.value = me.name;
    els.myAvatarPreview.src = me.avatar || window.CHARACTERS[me.character]?.avatar || '';
    els.characterSelect.value = me.character;
    renderCharacterSpotlight(me.character);
  }
}

function renderState() {
  els.gameMessage.textContent = roomState.message;
  renderLobbyAndSettings();
  renderPlayers();
  renderTopCard();
  renderLastPlayerBadge();
  renderMyHand();
  renderControls();
  animateLastAction();
}

window.addEventListener('resize', () => {
  if (roomState) renderPlayers();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !localStream) initAudio().catch(() => {});
});

document.body.addEventListener('click', () => {
  if (!localStream) initAudio().catch(() => {});
}, { once: true });

socket.emit('join_room', { room_id: roomId, username: profile.username, character: profile.character, avatar: profile.avatar });
window.addEventListener('beforeunload', () => socket.emit('leave_room_event', { room_id: roomId }));
