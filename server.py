from collections import OrderedDict
import os
import re

from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room

from uno_engine import UnoGame

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'legendary-uno-secret')
socketio = SocketIO(
    app,
    cors_allowed_origins='*',
    async_mode=os.environ.get('SOCKETIO_ASYNC_MODE', 'gevent'),
    max_http_buffer_size=5_000_000,
)

rooms = {}
ROOM_ID_RE = re.compile(r'[^a-zA-Z0-9_-]+')
DEFAULT_STARTING_CARDS = 7

CHARACTERS = {
    'leon': {
        'name': 'Leon',
        'bio': 'هادئ، سريع، ويحب اللعب المحسوب. مناسب لمن يريد افتتاحًا قويًا وتحكمًا ذكيًا في الطاولة.',
        'avatar': '/static/avatars/leon.jpg',
    },
    'wesker': {
        'name': 'Albert Wesker',
        'bio': 'بارد وواثق ويعشق المفاجآت. مناسب لمن يحب قلب الإيقاع فجأة واستغلال أوراق الحركة.',
        'avatar': '/static/avatars/wesker.jpg',
    },
    'chris': {
        'name': 'Chris',
        'bio': 'قتالي ومباشر ويضغط على الخصوم من البداية. ممتاز لمن يفضل أسلوبًا هجوميًا ثابتًا.',
        'avatar': '/static/avatars/chris.jpg',
    },
    'saddam': {
        'name': 'صدام حسين',
        'bio': 'شخصية ضيف مختلفة تضيف حضورًا غير متوقع إلى اللوبي، لمن يريد طابعًا غريبًا ولافتًا.',
        'avatar': '/static/avatars/saddam.jpg',
    },
}


@app.route('/')
def index():
    return render_template('index.html', characters=CHARACTERS)


@app.route('/room/<room_id>')
def room(room_id):
    clean_room_id = sanitize_room_id(room_id) or 'ROOM'
    return render_template('room.html', room_id=clean_room_id, characters=CHARACTERS)


def sanitize_room_id(raw_room_id):
    return ROOM_ID_RE.sub('', (raw_room_id or '').strip())[:24].upper()


def sanitize_username(raw_username):
    username = (raw_username or '').strip()[:24]
    return username or 'زائر'


def sanitize_avatar(raw_avatar, fallback_avatar):
    if isinstance(raw_avatar, str):
        avatar = raw_avatar.strip()
        if avatar.startswith('data:image/') and ';base64,' in avatar and len(avatar) <= 2_800_000:
            return avatar
    return fallback_avatar


def ensure_room(room_id):
    room = rooms.get(room_id)
    if room:
        return room
    room = {
        'users': OrderedDict(),
        'host_sid': None,
        'join_counter': 0,
        'settings': {'starting_cards': DEFAULT_STARTING_CARDS},
        'game': UnoGame(),
    }
    rooms[room_id] = room
    return room


@socketio.on('join_room')
def handle_join(data):
    room_id = sanitize_room_id(data.get('room_id'))
    if not room_id:
        emit('toast', {'message': 'رمز الغرفة غير صالح', 'type': 'error'})
        return

    room = ensure_room(room_id)
    room['join_counter'] += 1

    character_key = (data.get('character') or 'leon').strip().lower()
    if character_key not in CHARACTERS:
        character_key = 'leon'
    character = CHARACTERS[character_key]

    chosen_avatar = sanitize_avatar(data.get('avatar'), character['avatar'])

    user = room['users'].get(request.sid)
    if user is None:
        room['users'][request.sid] = {
            'id': request.sid,
            'name': sanitize_username(data.get('username')),
            'character': character_key,
            'avatar': chosen_avatar,
            'bio': character['bio'],
            'speaking': False,
            'muted': False,
            'speaker_muted': False,
            'join_seq': room['join_counter'],
        }
    else:
        user['name'] = sanitize_username(data.get('username') or user.get('name'))
        user['character'] = character_key
        user['avatar'] = chosen_avatar
        user['bio'] = character['bio']

    if room['host_sid'] is None or room['host_sid'] not in room['users']:
        room['host_sid'] = request.sid

    join_room(room_id)

    emit('joined_ack', {'sid': request.sid, 'room_id': room_id, 'characters': CHARACTERS})
    emit_room_state(room_id)
    socketio.emit(
        'toast',
        {'message': f'انضم {room["users"][request.sid]["name"]} إلى الغرفة', 'type': 'info'},
        to=room_id,
        skip_sid=request.sid,
    )


@socketio.on('leave_room_event')
def handle_leave(data):
    _remove_user(sanitize_room_id(data.get('room_id')), request.sid)


@socketio.on('disconnect')
def handle_disconnect():
    for room_id, room in list(rooms.items()):
        if request.sid in room['users']:
            _remove_user(room_id, request.sid)
            break


@socketio.on('update_profile')
def handle_update_profile(data):
    room_id = sanitize_room_id(data.get('room_id'))
    room = rooms.get(room_id)
    if not room or request.sid not in room['users']:
        return

    user = room['users'][request.sid]
    user['name'] = sanitize_username(data.get('username') or user['name'])

    character_key = (data.get('character') or user['character']).strip().lower()
    if character_key not in CHARACTERS:
        character_key = user['character']
    character = CHARACTERS[character_key]
    user['character'] = character_key
    user['avatar'] = sanitize_avatar(data.get('avatar', user.get('avatar')), character['avatar'])
    user['bio'] = character['bio']

    emit_room_state(room_id)


@socketio.on('update_settings')
def handle_update_settings(data):
    room_id = sanitize_room_id(data.get('room_id'))
    room = rooms.get(room_id)
    if not room:
        return
    if room['host_sid'] != request.sid:
        emit('toast', {'message': 'فقط المضيف يستطيع تعديل الإعدادات', 'type': 'error'})
        return

    try:
        starting_cards = int(data.get('starting_cards') or DEFAULT_STARTING_CARDS)
    except (TypeError, ValueError):
        starting_cards = DEFAULT_STARTING_CARDS

    room['settings']['starting_cards'] = max(3, min(12, starting_cards))
    emit_room_state(room_id)
    emit('toast', {'message': 'تم حفظ إعدادات الجولة', 'type': 'success'})


@socketio.on('start_game')
def handle_start_game(data):
    room_id = sanitize_room_id(data.get('room_id'))
    room = rooms.get(room_id)
    if not room:
        return
    if room['host_sid'] != request.sid:
        emit('toast', {'message': 'فقط المضيف يستطيع بدء الجولة', 'type': 'error'})
        return

    player_ids = list(room['users'].keys())
    try:
        room['game'].start_round(player_ids, room['settings'].get('starting_cards', DEFAULT_STARTING_CARDS))
    except ValueError as exc:
        emit('toast', {'message': friendly_error(str(exc)), 'type': 'error'})
        return

    emit_room_state(room_id)
    socketio.emit('toast', {'message': 'بدأت الجولة، حظًا موفقًا!', 'type': 'success'}, to=room_id)


@socketio.on('play_card')
def handle_play_card(data):
    room_id = sanitize_room_id(data.get('room_id'))
    room = rooms.get(room_id)
    if not room:
        return
    try:
        room['game'].play_card(request.sid, data.get('card_id'), data.get('chosen_color'))
        emit_room_state(room_id)
    except ValueError as exc:
        emit('toast', {'message': friendly_error(str(exc)), 'type': 'error'})


@socketio.on('draw_card')
def handle_draw_card(data):
    room_id = sanitize_room_id(data.get('room_id'))
    room = rooms.get(room_id)
    if not room:
        return
    try:
        room['game'].draw_card(request.sid)
        emit_room_state(room_id)
    except ValueError as exc:
        emit('toast', {'message': friendly_error(str(exc)), 'type': 'error'})


@socketio.on('pass_turn')
def handle_pass_turn(data):
    room_id = sanitize_room_id(data.get('room_id'))
    room = rooms.get(room_id)
    if not room:
        return
    try:
        room['game'].pass_turn(request.sid)
        emit_room_state(room_id)
    except ValueError as exc:
        emit('toast', {'message': friendly_error(str(exc)), 'type': 'error'})


@socketio.on('call_uno')
def handle_call_uno(data):
    room_id = sanitize_room_id(data.get('room_id'))
    room = rooms.get(room_id)
    if not room:
        return
    try:
        room['game'].call_uno(request.sid)
        emit_room_state(room_id)
        socketio.emit('toast', {'message': f'UNO! — {room["users"][request.sid]["name"]}', 'type': 'success'}, to=room_id)
    except ValueError as exc:
        emit('toast', {'message': friendly_error(str(exc)), 'type': 'error'})


@socketio.on('catch_uno')
def handle_catch_uno(data):
    room_id = sanitize_room_id(data.get('room_id'))
    room = rooms.get(room_id)
    target_sid = data.get('target_sid')
    if not room:
        return
    try:
        room['game'].catch_uno(request.sid, target_sid)
        emit_room_state(room_id)
        target_name = room['users'].get(target_sid, {}).get('name', 'لاعب')
        socketio.emit('toast', {'message': f'تم كشف {target_name} لأنه نسي UNO', 'type': 'warning'}, to=room_id)
    except ValueError as exc:
        emit('toast', {'message': friendly_error(str(exc)), 'type': 'error'})


@socketio.on('resolve_wild4')
def handle_resolve_wild4(data):
    room_id = sanitize_room_id(data.get('room_id'))
    room = rooms.get(room_id)
    if not room:
        return
    try:
        room['game'].resolve_wild4(request.sid, challenge=bool(data.get('challenge')))
        emit_room_state(room_id)
    except ValueError as exc:
        emit('toast', {'message': friendly_error(str(exc)), 'type': 'error'})


@socketio.on('toggle_mute')
def handle_toggle_mute(data):
    room_id = sanitize_room_id(data.get('room_id'))
    room = rooms.get(room_id)
    if room and request.sid in room['users']:
        room['users'][request.sid]['muted'] = bool(data.get('muted', False))
        emit_room_state(room_id)


@socketio.on('toggle_speaker')
def handle_toggle_speaker(data):
    room_id = sanitize_room_id(data.get('room_id'))
    room = rooms.get(room_id)
    if room and request.sid in room['users']:
        room['users'][request.sid]['speaker_muted'] = bool(data.get('speaker_muted', False))
        emit_room_state(room_id)


@socketio.on('speaking_state')
def handle_speaking_state(data):
    room_id = sanitize_room_id(data.get('room_id'))
    room = rooms.get(room_id)
    if room and request.sid in room['users']:
        speaking = bool(data.get('speaking', False))
        room['users'][request.sid]['speaking'] = speaking
        socketio.emit('user_speaking', {'user_id': request.sid, 'speaking': speaking}, to=room_id)
        emit_room_state(room_id)


@socketio.on('webrtc_offer')
def handle_offer(data):
    socketio.emit('webrtc_offer', {'offer': data['offer'], 'from_sid': request.sid}, to=data['target_sid'])


@socketio.on('webrtc_answer')
def handle_answer(data):
    socketio.emit('webrtc_answer', {'answer': data['answer'], 'from_sid': request.sid}, to=data['target_sid'])


@socketio.on('webrtc_ice')
def handle_ice(data):
    socketio.emit('webrtc_ice', {'candidate': data['candidate'], 'from_sid': request.sid}, to=data['target_sid'])


def emit_room_state(room_id):
    room = rooms.get(room_id)
    if not room:
        return
    users = list(room['users'].values())
    for sid in list(room['users'].keys()):
        state = room['game'].state_for(sid, users, room['host_sid'], room['settings'])
        socketio.emit('room_state', state, to=sid)


def friendly_error(code):
    mapping = {
        'minimum_players': 'تحتاج لاعبَين على الأقل',
        'not_your_turn': 'ليس دورك الآن',
        'choose_color': 'اختر اللون أولًا',
        'illegal_move': 'هذه الورقة لا يمكن لعبها الآن',
        'card_not_found': 'تعذر العثور على الورقة',
        'only_drawn_card': 'بعد السحب يمكنك لعب الورقة المسحوبة فقط أو إنهاء الدور',
        'must_play_or_pass': 'يجب أن تلعب الورقة المسحوبة أو تنهي الدور',
        'nothing_to_pass': 'لا يوجد دور لإنهائه الآن',
        'challenge_pending': 'هناك قرار تحدي +4 بانتظار اللاعب المستهدف',
        'uno_not_available': 'لا يمكنك قول UNO الآن',
        'cannot_catch_self': 'لا يمكنك معاقبة نفسك',
        'target_safe': 'هذا اللاعب قال UNO أو لم يعد مؤهلًا للعقوبة',
        'invalid_target': 'اللاعب المستهدف غير صالح',
        'not_target': 'هذا القرار ليس لك',
        'no_challenge_pending': 'لا يوجد تحدٍ معلق الآن',
        'not_playing': 'الجولة غير جارية حاليًا',
        'deck_empty': 'نفدت الأوراق',
    }
    return mapping.get(code, 'حدث خطأ غير متوقع')


def _remove_user(room_id, sid):
    room = rooms.get(room_id)
    if not room or sid not in room['users']:
        return

    leave_room(room_id, sid=sid)
    user = room['users'].pop(sid)

    if room['host_sid'] == sid:
        room['host_sid'] = select_next_host(room, user['join_seq'])

    room['game'].remove_player(sid)

    if not room['users']:
        del rooms[room_id]
        return

    emit_room_state(room_id)
    socketio.emit('toast', {'message': f'غادر {user["name"]} الغرفة', 'type': 'info'}, to=room_id)


def select_next_host(room, departing_seq):
    users = list(room['users'].values())
    if not users:
        return None
    higher = [user for user in users if user['join_seq'] > departing_seq]
    if higher:
        higher.sort(key=lambda item: item['join_seq'])
        return higher[0]['id']
    users.sort(key=lambda item: item['join_seq'])
    return users[0]['id']


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port, debug=False)
