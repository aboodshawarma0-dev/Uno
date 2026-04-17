const socket = io({ transports: ['websocket', 'polling'] });
const roomId = window.ROOM_ID;
const characterKeys = Object.keys(window.CHARACTERS);
const storedProfile = JSON.parse(localStorage.getItem('legendary-uno-profile') || '{}');
const profile = {
  username: storedProfile.username || '',
  character: characterKeys.includes(storedProfile.character) ? storedProfile.character : characterKeys[0],
  avatar: typeof storedProfile.avatar === 'string' ? storedProfile.avatar : '',
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
let hasJoinedRoom = false;
let introFinished = false;
let roomStateArrived = false;
let lastRenderedActionKey = '';
let decorativeCardAsset = randomDecorCard();

const els = {
  loadingScreen: document.getElementById('loadingScreen'),
  loadingBar: document.getElementById('loadingBar'),
  roomLobby: document.getElementById('roomLobby'),
  roomCode: document.getElementById('roomCode'),
  profileDisplayName: document.getElementById('profileDisplayName'),
  myAvatarPreview: document.getElementById('myAvatarPreview'),
  profileDisplayCharacter: document.getElementById('profileDisplayCharacter'),
  avatarStatus: document.getElementById('avatarStatus'),
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
  discardPile: document.getElementById('discardPile'),
};

els.roomCode.textContent = roomId;
renderProfileAvatar();
renderAvatarStatus();
startIntro();

function persistProfile() {
  localStorage.setItem('legendary-uno-profile', JSON.stringify(profile));
}

function cardSrc(asset) {
  return `/static/cards/${asset}.svg`;
}

function iconSrc(name) {
  return `/static/icons/${name}.svg`;
}

function randomDecorCard() {
  const cards = ['red_7_a', 'green_reverse_a', 'yellow_4_a', 'blue_draw2_a', 'wild_a', 'red_skip_a'];
  return cards[Math.floor(Math.random() * cards.length)];
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  els.toastStack.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-8px)';
    setTimeout(() => toast.remove(), 260);
  }, 3200);
}

function startIntro() {
  requestAnimationFrame(() => {
    if (els.loadingBar) {
      els.loadingBar.style.width = '100%';
    }
  });

  setTimeout(() => {
    introFinished = true;
    maybeHideIntro();
  }, 2450);

  setTimeout(() => {
    if (!roomStateArrived) {
      maybeHideIntro(true);
    }
  }, 3800);
}

function maybeHideIntro(force = false) {
  if (!els.loadingScreen) return;
  if (!force && (!introFinished || !roomStateArrived)) return;
  els.loadingScreen.classList.add('hidden');
}

function currentCharacterAvatar() {
  return window.CHARACTERS[profile.character]?.avatar || window.CHARACTERS[characterKeys[0]]?.avatar || '';
}

function isCustomAvatar(value) {
  return typeof value === 'string' && value.startsWith('data:image/');
}

function renderProfileAvatar() {
  els.myAvatarPreview.src = profile.avatar || currentCharacterAvatar();
  if (els.profileDisplayName) els.profileDisplayName.textContent = profile.username || 'لاعب جديد';
  if (els.profileDisplayCharacter) {
    const character = window.CHARACTERS[profile.character] || window.CHARACTERS[characterKeys[0]];
    els.profileDisplayCharacter.textContent = `الشخصية المختارة: ${character?.name || '—'}`;
  }
}


function renderAvatarStatus() {
  if (!els.avatarStatus) return;
  if (isCustomAvatar(profile.avatar)) {
    els.avatarStatus.textContent = 'تستخدم الآن صورة مخصصة محفوظة من اللوبي الخارجي. للرجوع أو التعديل ارجع إلى الصفحة الرئيسية.';
  } else {
    els.avatarStatus.textContent = 'تستخدم صورة الشخصية المختارة من اللوبي الخارجي. لتغييرها ارجع إلى الصفحة الرئيسية.';
  }
}










function getPlayer(sid) {
  return roomState?.players?.find((player) => player.id === sid);
}

function actionKey(action) {
  if (!action) return '';
  return JSON.stringify([
    action.type,
    action.sid,
    action.target_sid,
    action.card?.id,
    action.count,
    action.top_card?.id,
    roomState?.round_number,
    roomState?.top_card?.id,
  ]);
}

function hashSeed(value) {
  const text = String(value || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function playerStateLabel(player) {
  if (roomState?.status === 'playing') {
    return player.is_turn ? 'دوره الآن' : 'في الجولة';
  }
  if (roomState?.status === 'round_over') {
    return player.id === roomState?.winner_sid ? 'فاز بالجولة' : 'ينتظر جولة جديدة';
  }
  return 'في اللوبي';
}

function renderPlayers() {
  const players = roomState?.players || [];
  els.playersMeta.textContent = `${players.length} لاعب`;
  els.playersRing.querySelectorAll('.player-node').forEach((node) => node.remove());
  els.benchPlayers.innerHTML = '';

  const ringRect = els.playersRing.getBoundingClientRect();
  const width = ringRect.width || 800;
  const height = ringRect.height || 560;
  const centerX = width / 2;
  const centerY = height / 2;
  const radiusX = Math.max(160, Math.min(width * 0.38, 320));
  const radiusY = Math.max(150, Math.min(height * 0.34, 220));

  players.forEach((player, index) => {
    const count = Math.max(players.length, 1);
    const baseAngle = ((index / count) * Math.PI * 2) - (Math.PI / 2);
    const seed = hashSeed(player.id);
    const jitterX = ((seed % 15) - 7);
    const jitterY = (((seed >> 4) % 15) - 7);
    const x = centerX + Math.cos(baseAngle) * radiusX + jitterX;
    const y = centerY + Math.sin(baseAngle) * radiusY + jitterY;
    const node = document.createElement('article');
    node.className = `player-node${player.is_viewer ? ' self' : ''}${player.is_turn ? ' turn' : ''}${player.speaking ? ' speaking' : ''}`;
    node.dataset.sid = player.id;
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.innerHTML = `
      <img class="avatar" src="${player.avatar || window.CHARACTERS[player.character]?.avatar || ''}" alt="${player.name}">
      <div class="player-name">${player.name}</div>
      <div class="player-subtext">${playerStateLabel(player)}</div>
      <div class="player-meta">
        ${player.is_host ? '<span class="tag host-tag">مضيف</span>' : ''}
        <span class="tag">${player.score} نقطة</span>
        <span class="tag">${player.hand_count} كرت</span>
        ${player.is_turn ? '<span class="tag turn-tag">دوره</span>' : ''}
        ${player.uno_pending || player.said_uno ? '<span class="tag uno-tag">UNO</span>' : ''}
      </div>
    `;
    els.playersRing.appendChild(node);
  });

  players
    .slice()
    .sort((a, b) => {
      if (a.is_turn && !b.is_turn) return -1;
      if (!a.is_turn && b.is_turn) return 1;
      return (a.join_seq || 0) - (b.join_seq || 0);
    })
    .forEach((player) => {
      const item = document.createElement('div');
      item.className = 'bench-card';
      item.innerHTML = `
        <img src="${player.avatar || ''}" alt="${player.name}">
        <div>
          <strong>${player.name}</strong>
          <small>${playerStateLabel(player)}</small>
        </div>
        <span class="status-mini">${player.score} نقطة</span>`;
      els.benchPlayers.appendChild(item);
    });
}

function renderTopCard() {
  const colorMap = { red: 'أحمر', blue: 'أزرق', green: 'أخضر', yellow: 'أصفر', wild: 'متعدد' };
  const currentTop = roomState?.top_card?.asset || decorativeCardAsset;
  els.topCardImage.src = cardSrc(currentTop);
  els.drawCount.textContent = roomState?.draw_pile_count ?? 0;
  els.currentColorBadge.textContent = colorMap[roomState?.current_color] || 'تحضير';
  const rotationSeed = hashSeed(roomState?.top_card?.id || currentTop);
  const rotation = ((rotationSeed % 18) - 9);
  els.topCardImage.style.setProperty('--top-card-rotation', `${rotation}deg`);
}

function renderLastPlayerBadge() {
  const action = roomState?.last_action;
  if (!action?.sid) {
    els.lastPlayerBadge.innerHTML = '<span>ما زالت الطاولة تنتظر أول حركة</span>';
    return;
  }
  const player = getPlayer(action.sid);
  const titleMap = {
    play: 'آخر حركة',
    win: 'الفائز',
    draw: 'سحب كرت',
    call_uno: 'نداء UNO',
    catch_uno: 'كشف لاعب',
    wild4_accept: 'قبول +4',
    wild4_challenge_success: 'نجح التحدي',
    wild4_challenge_fail: 'فشل التحدي',
  };
  els.lastPlayerBadge.innerHTML = `
    <img src="${player?.avatar || ''}" alt="${player?.name || ''}">
    <div>
      <div style="font-size:.82rem;color:var(--muted);">${titleMap[action.type] || 'آخر حدث'}</div>
      <strong>${player?.name || '—'}</strong>
    </div>`;
}

function renderMyHand() {
  const myHand = roomState?.my_hand || [];
  const playableIds = new Set(roomState?.my_playable_ids || []);
  els.myHandTray.innerHTML = '';
  els.handMeta.textContent = `${myHand.length} كرت`;

  myHand.forEach((card) => {
    const cardEl = document.createElement('button');
    cardEl.type = 'button';
    const playable = playableIds.has(card.id);
    cardEl.className = `hand-card${playable ? ' playable' : ' disabled'}`;
    cardEl.dataset.cardId = card.id;
    cardEl.dataset.type = card.type;
    cardEl.innerHTML = `<img src="${cardSrc(card.asset)}" alt="${card.label}">`;

    if (card.type === 'wild' || card.type === 'wild4') {
      const chooser = document.createElement('div');
      chooser.className = 'wild-chooser';
      ['red', 'yellow', 'green', 'blue'].forEach((color) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `color-pick ${color}`;
        button.dataset.color = color;
        chooser.appendChild(button);
      });
      cardEl.appendChild(chooser);
    }

    els.myHandTray.appendChild(cardEl);
  });
}

function renderLobbyAndSettings() {
  const me = roomState?.players?.find((player) => player.id === mySid);
  if (me) {
    profile.username = me.name;
    profile.character = me.character;
    profile.avatar = me.avatar || '';
    renderProfileAvatar();
    renderAvatarStatus();
    persistProfile();
  }

  const showLobby = roomState?.status !== 'playing';
  els.roomLobby.classList.toggle('hidden', !showLobby);
  const isHost = roomState?.host_sid === mySid;
  els.settingsToggleBtn.classList.toggle('hidden', !isHost);
  if (!isHost) {
    els.settingsPanel.classList.add('hidden');
  }

  const startingCards = roomState?.settings?.starting_cards || 7;
  els.startingCardsInput.value = startingCards;
  els.startingCardsValue.textContent = startingCards;
}

function renderControls() {
  const pendingForMe = Boolean(roomState?.pending_challenge?.for_viewer);
  els.drawCardBtn.disabled = !roomState?.can_draw;
  els.passTurnBtn.disabled = !roomState?.can_pass;
  els.callUnoBtn.disabled = !roomState?.can_call_uno;
  els.catchUnoBtn.disabled = !(roomState?.catchable_uno?.length);
  els.challengePanel.classList.toggle('hidden', !pendingForMe);
  els.startGameBtn.disabled = !roomState?.can_start;
}

function renderState() {
  els.gameMessage.textContent = roomState?.message || 'بانتظار اللاعبين';
  renderLobbyAndSettings();
  renderPlayers();
  renderTopCard();
  renderLastPlayerBadge();
  renderMyHand();
  renderControls();
  animateLastAction();
}

function animateCardFromTo(srcEl, targetEl, src) {
  if (!srcEl || !targetEl) return;
  const s = srcEl.getBoundingClientRect();
  const t = targetEl.getBoundingClientRect();
  if (!s.width || !t.width) return;
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
    flyer.style.opacity = '.95';
  });
  setTimeout(() => flyer.remove(), 700);
}

function animateLastAction() {
  const action = roomState?.last_action;
  const key = actionKey(action);
  if (!action || key === lastRenderedActionKey) return;
  lastRenderedActionKey = key;

  const roomPlayers = roomState?.players || [];
  const playerName = roomPlayers.find((item) => item.id === action.sid)?.name || 'لاعب';

  if (['deal', 'draw', 'draw2', 'wild4_accept', 'wild4_challenge_fail', 'wild4_challenge_success', 'catch_uno'].includes(action.type)) {
    const target = action.sid === mySid || action.target_sid === mySid
      ? els.myHandTray
      : document.querySelector(`.player-node[data-sid="${action.target_sid || action.sid}"]`);
    if (target) {
      animateCardFromTo(els.drawPile.querySelector('img'), target, cardSrc(action.cards?.[0]?.asset || 'back'));
    }
  }

  if (action.type === 'play' || action.type === 'win') {
    const src = document.querySelector(`.hand-card[data-card-id="${action.card?.id}"]`) || document.querySelector(`.player-node[data-sid="${action.sid}"] img.avatar`);
    animateCardFromTo(src, els.discardPile.querySelector('img'), cardSrc(action.card?.asset || 'back'));
  }

  if (action.type === 'deal') showToast('بدأ توزيع الأوراق', 'success');
  if (action.type === 'call_uno') showToast(`UNO! — ${playerName}`, 'success');
  if (action.type === 'catch_uno') showToast('تم كشف لاعب نسي قول UNO', 'warning');
  if (action.type === 'wild4_challenge_success') showToast('نجح التحدي على +4', 'success');
  if (action.type === 'wild4_challenge_fail') showToast('فشل التحدي على +4', 'error');
  if (action.type === 'win') showToast(`فاز ${playerName} بهذه الجولة`, 'success');
}

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

async function initAudio() {
  if (localStream) return localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
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
    const avg = data.reduce((sum, value) => sum + value, 0) / data.length;
    const next = avg > 22;
    if (next !== active) {
      active = next;
      socket.emit('speaking_state', { room_id: roomId, speaking: next });
    }
  }, 240);
}

function createPeerConnection(targetSid) {
  if (peers[targetSid]) return peers[targetSid];
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  peers[targetSid] = pc;

  if (localStream) {
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('webrtc_ice', { target_sid: targetSid, candidate: event.candidate });
    }
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
  if (!mySid || mySid > targetSid || !localStream) return;
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
  if (!roomState?.players || !mySid || !localStream) return;
  const others = roomState.players.map((player) => player.id).filter((id) => id !== mySid);
  cleanupPeers(others);
  others.forEach((sid) => {
    createPeerConnection(sid);
    ensureOffer(sid);
  });
}

function joinRoomNow() {
  const cleanName = (profile.username || '').trim();
  if (!cleanName) {
    showToast('لا يوجد اسم محفوظ. سيتم إعادتك إلى اللوبي الخارجي.', 'warning');
    setTimeout(() => { location.href = `/?room=${encodeURIComponent(roomId)}`; }, 600);
    return;
  }
  socket.emit('join_room', {
    room_id: roomId,
    username: cleanName,
    character: profile.character,
    avatar: profile.avatar || '',
  });
  hasJoinedRoom = true;
}

els.startingCardsInput.addEventListener('input', () => {
  els.startingCardsValue.textContent = els.startingCardsInput.value;
});

els.saveSettingsBtn.addEventListener('click', () => {
  socket.emit('update_settings', {
    room_id: roomId,
    starting_cards: Number(els.startingCardsInput.value),
  });
});

els.startGameBtn.addEventListener('click', () => socket.emit('start_game', { room_id: roomId }));
els.drawCardBtn.addEventListener('click', () => socket.emit('draw_card', { room_id: roomId }));
els.passTurnBtn.addEventListener('click', () => socket.emit('pass_turn', { room_id: roomId }));
els.callUnoBtn.addEventListener('click', () => socket.emit('call_uno', { room_id: roomId }));
els.acceptWild4Btn.addEventListener('click', () => socket.emit('resolve_wild4', { room_id: roomId, challenge: false }));
els.challengeWild4Btn.addEventListener('click', () => socket.emit('resolve_wild4', { room_id: roomId, challenge: true }));

els.catchUnoBtn.addEventListener('click', () => {
  const targetSid = roomState?.catchable_uno?.[0];
  if (!targetSid) {
    showToast('لا يوجد لاعب قابل للكشف الآن', 'info');
    return;
  }
  socket.emit('catch_uno', { room_id: roomId, target_sid: targetSid });
});

els.settingsToggleBtn.addEventListener('click', () => {
  els.settingsPanel.classList.toggle('hidden');
});

els.micToggleBtn.addEventListener('click', async () => {
  if (!localStream) await initAudio();
  setMicMuted(!micMuted);
});

els.speakerToggleBtn.addEventListener('click', () => setSpeakerMuted(!speakerMuted));

els.myHandTray.addEventListener('click', (event) => {
  const colorButton = event.target.closest('.color-pick');
  if (colorButton) {
    const parentCard = colorButton.closest('.hand-card');
    if (!parentCard) return;
    socket.emit('play_card', {
      room_id: roomId,
      card_id: parentCard.dataset.cardId,
      chosen_color: colorButton.dataset.color,
    });
    return;
  }

  const card = event.target.closest('.hand-card');
  if (!card || card.classList.contains('disabled')) return;
  const type = card.dataset.type;
  if (type === 'wild' || type === 'wild4') {
    document.querySelectorAll('.hand-card.choosing').forEach((item) => {
      if (item !== card) item.classList.remove('choosing');
    });
    card.classList.toggle('choosing');
    return;
  }
  socket.emit('play_card', { room_id: roomId, card_id: card.dataset.cardId });
});

socket.on('connect', () => {
  if (!profile.username) {
    location.href = `/?room=${encodeURIComponent(roomId)}`;
    return;
  }
  if (!hasJoinedRoom) {
    joinRoomNow();
  } else {
    socket.emit('join_room', { room_id: roomId, username: profile.username, character: profile.character, avatar: profile.avatar || '' });
  }
});

socket.on('joined_ack', async ({ sid }) => {
  mySid = sid;
  try {
    await initAudio();
  } catch (_) {
    // ignored on purpose; the user can enable audio later.
  }
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
  roomStateArrived = true;
  maybeHideIntro();
  renderState();
  syncPeers();
});

window.addEventListener('resize', () => {
  if (roomState) renderPlayers();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !localStream) initAudio().catch(() => {});
});

document.body.addEventListener('click', () => {
  if (!localStream) initAudio().catch(() => {});
}, { once: true });

window.addEventListener('beforeunload', () => {
  socket.emit('leave_room_event', { room_id: roomId });
});
