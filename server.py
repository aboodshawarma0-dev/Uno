from collections import OrderedDict
import os
import re

from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room

from uno_engine import UnoGame

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'legendary-uno-secret')
socketio = SocketIO(app, cors_allowed_origins='*', async_mode='gevent', max_http_buffer_size=5_000_000)

rooms = {}
ROOM_ID_RE = re.compile(r'[^a-zA-Z0-9_-]+')

CHARACTERS = {
    'leon': {
        'name': 'Leon S. Kennedy',
        'bio': 'عميل ميداني هادئ ودقيق، ممتاز تحت الضغط ويحب اللعب المحسوب.',
        'avatar': 'https://upload.wikimedia.org/wikipedia/commons/3/36/Resident_Evil_4_-_Leon_S._Kennedy.jpg',
    },
    'jill': {
        'name': 'Jill Valentine',
        'bio': 'مقاتلة ذكية وسريعة التكيّف، تركّز على النجاة والقرارات السريعة.',
        'avatar': 'https://upload.wikimedia.org/wikipedia/commons/c/c0/Jill_Valentine%2C_Resident_Evil_character_%28photographed_by_Shin_Illuits%2C_2011%29.jpg',
    },
    'claire': {
        'name': 'Claire Redfield',
        'bio': 'جريئة وتحب المخاطرة الذكية، أسلوبها هجومي لكن متوازن.',
        'avatar': 'https://upload.wikimedia.org/wikipedia/commons/d/d1/Claire_Resident_Evil_2.jpg',
    },
    'ada': {
        'name': 'Ada Wong',
        'bio': 'غامضة وأنيقة وتحب المباغتة، مثالية لمن يريد شخصية واثقة.',
        'avatar': 'https://upload.wikimedia.org/wikipedia/commons/5/5d/Cosplayer_of_Ada_Wong%2C_Resident_Evil_at_PF23_20151025.jpg',
    },
    'chris': {
        'name': 'Chris Redfield',
        'bio': 'قائد مباشر وقوي، مناسب لمن يحب السيطرة على إيقاع الجولة.',
        'avatar': 'https://upload.wikimedia.org/wikipedia/commons/d/db/Chris_Redfield_cosplayer_at_NCCBF_2010-04-18_2.JPG',
    },
}


@app.route('/')
def index():
    return render_template('index.html', characters=CHARACTERS)


@app.route('/room/<room_id>')
def room(room_id):
    clean_room_id = ROOM_ID_RE.sub('', room_id)[:24] or 'ROOM'
    return render_template('room.html', room_id=clean_room_id, characters=CHARACTERS)


@socketio.on('join_room')
def handle_join(data):
    room_id = ROOM_ID_RE.sub('', (data.get('room_id') or ''))[:24]
    username = (data.get('username') or 'زائر').strip()[:24]
    character_key = (data.get('character') or 'leon').strip().lower()
    avatar = (data.get('avatar') or '').strip()
    if not room_id:
        return

    character = CHARACTERS.get(character_key, CHARACTERS['leon'])
    room = rooms.setdefault(room_id, {
        'users': OrderedDict(),
        'host_sid': None,
        'join_counter': 0,
        'settings': {'starting_cards': 7},
        'game': UnoGame(),
    })

    join_room(room_id)
    room['join_counter'] += 1
    room['users'][request.sid] = {
        'id': request.sid,
        'name': username,
        'character': character_key,
        'avatar': avatar or character['avatar'],
        'bio': character['bio'],
        'speaking': False,
        'muted': False,
        'speaker_muted': False,
        'join_seq': room['join_counter'],
    }
    if room['host_sid'] is None:
        room['host_sid'] = request.sid

    emit('joined_ack', {'sid': request.sid, 'room_id': room_id, 'characters': CHARACTERS})
    emit_room_state(room_id)
    emit('toast', {'message': f'انضم {username} إلى الغرفة', 'type': 'info'}, to=room_id, skip_sid=request.sid)


@socketio.on('update_profile')
def handle_update_profile(data):
    room_id = data.get('room_id')
    room = rooms.get(room_id)
    if not room or request.sid not in room['users']:
        return
    user = room['users'][request.sid]
    name = (data.get('username') or user['name']).strip()[:24]
    character_key = (data.get('character') or user['character']).strip().lower()
    avatar = (data.get('avatar') or user['avatar']).strip()
    character = CHARACTERS.get(character_key, CHARACTERS['leon'])
    user['name'] = name
    user['character'] = character_key
    user['bio'] = character['bio']
    if avatar:
        user['avatar'] = avatar
    elif not user.get('avatar'):
        user['avatar'] = character['avatar']
    emit_room_state(room_id)


@socketio.on('leave_room_event')
def handle_leave(data):
    room_id = data.get('room_id')
    _remove_user(room_id, request.sid)


@socketio.on('disconnect')
def handle_disconnect():
    for room_id, room in list(rooms.items()):
        if request.sid in room['users']:
            _remove_user(room_id, request.sid)
            break


@socketio.on('update_settings')
def handle_update_settings(data):
    room_id = data.get('room_id')
    room = rooms.get(room_id)
    if not room or room['host_sid'] != request.sid:
        return
    try:
        starting_cards = int((data.get('starting_cards') or 7))
    except Exception:
        starting_cards = 7
    room['settings']['starting_cards'] = max(3, min(12, starting_cards))
    emit_room_state(room_id)


@socketio.on('start_game')
def handle_start_game(data):
    room_id = data.get('room_id')
    room = rooms.get(room_id)
    if not room:
        return
    if room['host_sid'] != request.sid:
        emit('toast', {'message': 'فقط المضيف يستطيع بدء الجولة', 'type': 'error'})
        return
    if len(room['users']) < 2:
        emit('toast', {'message': 'تحتاج لاعبَين على الأقل لبدء UNO', 'type': 'error'})
        return

    player_ids = list(room['users'].keys())
    game = room['game']
    try:
        game.start_round(player_ids, room['settings'].get('starting_cards', 7))
    except Exception:
        emit('toast', {'message': 'تعذر بدء الجولة', 'type': 'error'})
        return

    emit_room_state(room_id)
    emit('toast', {'message': 'بدأت جولة UNO جديدة', 'type': 'success'}, to=room_id)


@socketio.on('play_card')
def handle_play_card(data):
    room_id = data.get('room_id')
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
    room_id = data.get('room_id')
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
    room_id = data.get('room_id')
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
    room_id = data.get('room_id')
    room = rooms.get(room_id)
    if not room:
        return
    try:
        room['game'].call_uno(request.sid)
        emit_room_state(room_id)
        emit('toast', {'message': 'UNO!', 'type': 'success'}, to=room_id)
    except ValueError as exc:
        emit('toast', {'message': friendly_error(str(exc)), 'type': 'error'})


@socketio.on('catch_uno')
def handle_catch_uno(data):
    room_id = data.get('room_id')
    target_sid = data.get('target_sid')
    room = rooms.get(room_id)
    if not room:
        return
    try:
        room['game'].catch_uno(request.sid, target_sid)
        emit_room_state(room_id)
        emit('toast', {'message': 'تم كشف لاعب نسي قول UNO', 'type': 'warning'}, to=room_id)
    except ValueError as exc:
        emit('toast', {'message': friendly_error(str(exc)), 'type': 'error'})


@socketio.on('resolve_wild4')
def handle_resolve_wild4(data):
    room_id = data.get('room_id')
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
    room_id = data.get('room_id')
    room = rooms.get(room_id)
    if room and request.sid in room['users']:
        room['users'][request.sid]['muted'] = bool(data.get('muted', False))
        emit_room_state(room_id)


@socketio.on('toggle_speaker')
def handle_toggle_speaker(data):
    room_id = data.get('room_id')
    room = rooms.get(room_id)
    if room and request.sid in room['users']:
        room['users'][request.sid]['speaker_muted'] = bool(data.get('speaker_muted', False))
        emit_room_state(room_id)


@socketio.on('speaking_state')
def handle_speaking_state(data):
    room_id = data.get('room_id')
    room = rooms.get(room_id)
    if room and request.sid in room['users']:
        room['users'][request.sid]['speaking'] = bool(data.get('speaking', False))
        emit('user_speaking', {'user_id': request.sid, 'speaking': room['users'][request.sid]['speaking']}, to=room_id)
        emit_room_state(room_id)


@socketio.on('webrtc_offer')
def handle_offer(data):
    emit('webrtc_offer', {'offer': data['offer'], 'from_sid': request.sid}, to=data['target_sid'])


@socketio.on('webrtc_answer')
def handle_answer(data):
    emit('webrtc_answer', {'answer': data['answer'], 'from_sid': request.sid}, to=data['target_sid'])


@socketio.on('webrtc_ice')
def handle_ice(data):
    emit('webrtc_ice', {'candidate': data['candidate'], 'from_sid': request.sid}, to=data['target_sid'])


def emit_room_state(room_id):
    room = rooms.get(room_id)
    if not room:
        return
    users = list(room['users'].values())
    for sid in list(room['users'].keys()):
        state = room['game'].state_for(sid, users, room['host_sid'], room['settings'])
        emit('room_state', state, to=sid)


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
    old_host = room['host_sid']
    if old_host == sid:
        room['host_sid'] = select_next_host(room, user['join_seq'])
    room['game'].remove_player(sid)
    if not room['users']:
        del rooms[room_id]
        return
    emit_room_state(room_id)
    emit('toast', {'message': f'غادر {user["name"]} الغرفة', 'type': 'info'}, to=room_id)


def select_next_host(room, departing_seq):
    users = list(room['users'].values())
    if not users:
        return None
    higher = [u for u in users if u['join_seq'] > departing_seq]
    if higher:
        higher.sort(key=lambda x: x['join_seq'])
        return higher[0]['id']
    users.sort(key=lambda x: x['join_seq'])
    return users[0]['id']


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port, debug=False)
