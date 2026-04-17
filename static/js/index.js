const characterGrid = document.getElementById('characterGrid');
const usernameInput = document.getElementById('username');
const roomIdInput = document.getElementById('roomId');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');

const saved = JSON.parse(localStorage.getItem('legendary-uno-profile') || '{}');
let selectedCharacter = saved.character || Object.keys(window.CHARACTERS)[0];
if (saved.username) usernameInput.value = saved.username;

function pickCharacter(key) {
  selectedCharacter = key;
  document.querySelectorAll('.character-tile').forEach((el) => {
    el.classList.toggle('active', el.dataset.character === key);
  });
}

characterGrid?.addEventListener('click', (event) => {
  const tile = event.target.closest('.character-tile');
  if (!tile) return;
  pickCharacter(tile.dataset.character);
});

pickCharacter(selectedCharacter);

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

function storeProfile(username) {
  const payload = {
    username,
    character: selectedCharacter,
    avatar: saved.avatar || '',
  };
  localStorage.setItem('legendary-uno-profile', JSON.stringify(payload));
}

function showNameRequired() {
  usernameInput.focus();
  usernameInput.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-6px)' },
      { transform: 'translateX(6px)' },
      { transform: 'translateX(0)' },
    ],
    { duration: 240 },
  );
  usernameInput.classList.add('input-error');
  setTimeout(() => usernameInput.classList.remove('input-error'), 1200);
}

function goToRoom(create = false) {
  const username = (usernameInput.value || '').trim();
  if (!username) {
    showNameRequired();
    return;
  }
  const roomId = slugRoom(roomIdInput.value) || (create ? randomRoom() : '');
  if (!roomId) {
    roomIdInput.focus();
    roomIdInput.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-6px)' },
        { transform: 'translateX(6px)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 240 },
    );
    return;
  }

  storeProfile(username);
  location.href = `/room/${encodeURIComponent(roomId)}`;
}

createRoomBtn?.addEventListener('click', () => goToRoom(true));
joinRoomBtn?.addEventListener('click', () => goToRoom(false));

roomIdInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    goToRoom(false);
  }
});
