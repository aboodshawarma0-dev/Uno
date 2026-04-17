const characterGrid = document.getElementById('characterGrid');
const usernameInput = document.getElementById('username');
const roomIdInput = document.getElementById('roomId');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const avatarInput = document.getElementById('avatarInput');
const clearAvatarBtn = document.getElementById('clearAvatarBtn');
const avatarPreview = document.getElementById('avatarPreview');
const selectedCharacterName = document.getElementById('selectedCharacterName');
const avatarStatusText = document.getElementById('avatarStatusText');
const characterSpotlight = document.getElementById('characterSpotlight');
const lobbyStarfield = document.getElementById('lobbyStarfield');

const saved = JSON.parse(localStorage.getItem('legendary-uno-profile') || '{}');
const characterKeys = Object.keys(window.CHARACTERS || {});
const params = new URLSearchParams(location.search);
let selectedCharacter = characterKeys.includes(saved.character) ? saved.character : characterKeys[0];
let customAvatar = typeof saved.avatar === 'string' ? saved.avatar : '';

if (saved.username) usernameInput.value = saved.username;
if (params.get('room')) roomIdInput.value = params.get('room');

function currentCharacter() {
  return window.CHARACTERS[selectedCharacter] || window.CHARACTERS[characterKeys[0]];
}

function isCustomAvatar(value) {
  return typeof value === 'string' && value.startsWith('data:image/');
}

function renderProfilePreview() {
  const character = currentCharacter();
  selectedCharacterName.textContent = character.name;
  avatarPreview.src = customAvatar || character.avatar;
  avatarStatusText.textContent = isCustomAvatar(customAvatar)
    ? 'تستخدم صورتك المخصصة فوق الشخصية المختارة'
    : 'تستخدم صورة الشخصية المختارة حاليًا';
}

function renderSpotlight() {
  const character = currentCharacter();
  characterSpotlight.innerHTML = `
    <div class="spotlight-inner">
      <img src="${character.avatar}" alt="${character.name}">
      <div class="spotlight-copy">
        <h3>${character.name}</h3>
        <p>${character.bio}</p>
      </div>
    </div>`;
}

function pickCharacter(key) {
  if (!window.CHARACTERS[key]) return;
  selectedCharacter = key;
  document.querySelectorAll('.character-tile').forEach((el) => {
    el.classList.toggle('active', el.dataset.character === key);
  });
  renderProfilePreview();
  renderSpotlight();
  persistProfile();
}

function slugRoom(raw) {
  return (raw || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 24)
    .toUpperCase();
}

function randomRoom() {
  return `UNO-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function persistProfile(usernameOverride = null) {
  const payload = {
    username: typeof usernameOverride === 'string' ? usernameOverride : (usernameInput.value || '').trim(),
    character: selectedCharacter,
    avatar: customAvatar || '',
  };
  localStorage.setItem('legendary-uno-profile', JSON.stringify(payload));
}

function animateError(input) {
  input.focus();
  input.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-6px)' },
      { transform: 'translateX(6px)' },
      { transform: 'translateX(0)' },
    ],
    { duration: 240 },
  );
  input.classList.add('input-error');
  setTimeout(() => input.classList.remove('input-error'), 1200);
}

async function fileToOptimizedDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read_failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('image_failed'));
      img.onload = () => {
        const maxSide = 420;
        let { width, height } = img;
        const ratio = Math.min(maxSide / width, maxSide / height, 1);
        width = Math.max(1, Math.round(width * ratio));
        height = Math.max(1, Math.round(height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function createStarfield() {
  if (!lobbyStarfield || lobbyStarfield.childElementCount) return;
  const tones = ['#ffffff', '#fde68a', '#fef3c7', '#c7e9ff', '#ffd7a8'];
  for (let i = 0; i < 90; i += 1) {
    const star = document.createElement('span');
    const size = (Math.random() * 2.8) + 1.2;
    const tone = tones[Math.floor(Math.random() * tones.length)];
    star.className = 'sky-star';
    star.style.left = `${Math.random() * 100}%`;
    star.style.top = `${Math.random() * 100}%`;
    star.style.width = `${size}px`;
    star.style.height = `${size}px`;
    star.style.setProperty('--star-color', tone);
    star.style.setProperty('--move-x', `${(Math.random() * 28) - 14}px`);
    star.style.setProperty('--move-y', `${(Math.random() * 18) - 9}px`);
    star.style.animationDuration = `${8 + (Math.random() * 10)}s, ${1.6 + (Math.random() * 2.4)}s`;
    star.style.animationDelay = `${Math.random() * 6}s, ${Math.random() * 2}s`;
    lobbyStarfield.appendChild(star);
  }
}

function goToRoom(create = false) {
  const username = (usernameInput.value || '').trim();
  if (!username) {
    animateError(usernameInput);
    return;
  }

  const roomId = slugRoom(roomIdInput.value) || (create ? randomRoom() : '');
  if (!roomId) {
    animateError(roomIdInput);
    return;
  }

  persistProfile(username);
  location.href = `/room/${encodeURIComponent(roomId)}`;
}

characterGrid?.addEventListener('click', (event) => {
  const tile = event.target.closest('.character-tile');
  if (!tile) return;
  pickCharacter(tile.dataset.character);
});

avatarInput?.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    customAvatar = await fileToOptimizedDataUrl(file);
    renderProfilePreview();
    persistProfile();
  } catch (_) {
    avatarStatusText.textContent = 'تعذر قراءة الصورة. جرّب صورة أصغر أو بصيغة مختلفة.';
  }
  event.target.value = '';
});

clearAvatarBtn?.addEventListener('click', () => {
  customAvatar = '';
  renderProfilePreview();
  persistProfile();
});

createRoomBtn?.addEventListener('click', () => goToRoom(true));
joinRoomBtn?.addEventListener('click', () => goToRoom(false));

roomIdInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    goToRoom(false);
  }
});

usernameInput?.addEventListener('input', () => persistProfile());

pickCharacter(selectedCharacter);
createStarfield();
renderProfilePreview();
renderSpotlight();
