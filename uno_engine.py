import itertools
import random
from copy import deepcopy

COLORS = ["red", "yellow", "green", "blue"]
COLOR_LABELS = {
    "red": "أحمر",
    "yellow": "أصفر",
    "green": "أخضر",
    "blue": "أزرق",
    "wild": "متعدد",
}
ACTION_LABELS = {
    "skip": "تخطي",
    "reverse": "عكس",
    "draw2": "+2",
    "wild": "اختيار لون",
    "wild4": "+4",
}
CARD_POINTS = {
    "skip": 20,
    "reverse": 20,
    "draw2": 20,
    "wild": 50,
    "wild4": 50,
}


def card_public(card):
    return {
        "id": card["id"],
        "color": card["color"],
        "type": card["type"],
        "value": card["value"],
        "asset": card["asset"],
        "label": card["label"],
    }


class UnoGame:
    def __init__(self):
        self.reset(full=True)

    def reset(self, full=False):
        if full:
            self.scores = {}
        self.status = "lobby"
        self.players = []
        self.hands = {}
        self.draw_pile = []
        self.discard_pile = []
        self.current_sid = None
        self.direction = 1
        self.current_color = None
        self.message = "بانتظار بدء الجولة"
        self.winner_sid = None
        self.last_action = None
        self.starting_cards = 7
        self.pending_challenge = None
        self.must_play_drawn = {}
        self.uno_called = set()
        self.uno_pending = set()
        self.round_number = 0

    def ensure_score_slots(self, player_ids):
        for sid in player_ids:
            self.scores.setdefault(sid, 0)

    def _make_card(self, uid, color, ctype, value, copy_suffix):
        if ctype == "number":
            face = f"{color}_{value}_{copy_suffix}"
            label = f"{COLOR_LABELS[color]} {value}"
        elif ctype in ("skip", "reverse", "draw2"):
            face = f"{color}_{ctype}_{copy_suffix}"
            label = f"{COLOR_LABELS[color]} {ACTION_LABELS[ctype]}"
        elif ctype == "wild":
            face = f"wild_{copy_suffix}"
            label = ACTION_LABELS[ctype]
        else:
            face = f"wild4_{copy_suffix}"
            label = ACTION_LABELS[ctype]
        return {
            "id": f"c{uid}",
            "color": color,
            "type": ctype,
            "value": value,
            "asset": face,
            "label": label,
        }

    def create_deck(self):
        deck = []
        uid = itertools.count(1)
        for color in COLORS:
            deck.append(self._make_card(next(uid), color, "number", "0", "a"))
            for value in map(str, range(1, 10)):
                deck.append(self._make_card(next(uid), color, "number", value, "a"))
                deck.append(self._make_card(next(uid), color, "number", value, "b"))
            for action in ("skip", "reverse", "draw2"):
                deck.append(self._make_card(next(uid), color, action, action, "a"))
                deck.append(self._make_card(next(uid), color, action, action, "b"))
        for suffix in ("a", "b", "c", "d"):
            deck.append(self._make_card(next(uid), "wild", "wild", "wild", suffix))
            deck.append(self._make_card(next(uid), "wild", "wild4", "wild4", suffix))
        random.shuffle(deck)
        return deck

    def _draw_one(self):
        if not self.draw_pile:
            self._reshuffle()
        if not self.draw_pile:
            return None
        return self.draw_pile.pop()

    def _reshuffle(self):
        if len(self.discard_pile) <= 1:
            return
        top = self.discard_pile[-1]
        pool = self.discard_pile[:-1]
        random.shuffle(pool)
        self.draw_pile = pool
        self.discard_pile = [top]

    def start_round(self, player_ids, starting_cards=7):
        if len(player_ids) < 2:
            raise ValueError("minimum_players")
        self.ensure_score_slots(player_ids)
        self.status = "playing"
        self.players = list(player_ids)
        self.hands = {sid: [] for sid in self.players}
        self.draw_pile = self.create_deck()
        self.discard_pile = []
        self.current_sid = self.players[0]
        self.direction = 1
        self.current_color = None
        self.pending_challenge = None
        self.must_play_drawn = {}
        self.uno_called = set()
        self.uno_pending = set()
        self.winner_sid = None
        self.last_action = None
        self.round_number += 1
        self.starting_cards = max(3, min(12, int(starting_cards or 7)))

        dealt = []
        for _ in range(self.starting_cards):
            for sid in self.players:
                card = self._draw_one()
                self.hands[sid].append(card)
                dealt.append({"sid": sid, "card": card_public(card)})

        while True:
            first = self._draw_one()
            if first is None:
                raise RuntimeError("empty_deck")
            if first["type"] == "number":
                self.discard_pile.append(first)
                self.current_color = first["color"]
                break
            self.draw_pile.insert(0, first)
            random.shuffle(self.draw_pile)

        self.message = "بدأت الجولة — الدور على أول لاعب داخل الطاولة"
        self.last_action = {
            "type": "deal",
            "dealt": dealt,
            "top_card": card_public(first),
        }
        return self.snapshot_message()

    def remove_player(self, sid):
        if sid not in self.players:
            return
        idx = self.players.index(sid)
        self.players.remove(sid)
        self.hands.pop(sid, None)
        self.must_play_drawn.pop(sid, None)
        self.uno_called.discard(sid)
        self.uno_pending.discard(sid)
        if self.pending_challenge and sid in (self.pending_challenge["target_sid"], self.pending_challenge["offender_sid"]):
            self.pending_challenge = None
        if self.status == "playing":
            if len(self.players) < 2:
                self.status = "round_over"
                self.current_sid = None
                self.message = "انتهت الجولة لأن عدد اللاعبين لم يعد كافيًا"
                self.winner_sid = self.players[0] if self.players else None
                return
            if self.current_sid == sid:
                if self.direction == 1:
                    self.current_sid = self.players[idx % len(self.players)]
                else:
                    self.current_sid = self.players[(idx - 1) % len(self.players)]
                self.message = "غادر لاعب أثناء دوره — تم نقل الدور تلقائيًا"

    def next_sid(self, sid, steps=1):
        if sid not in self.players or not self.players:
            return None
        idx = self.players.index(sid)
        idx = (idx + (steps * self.direction)) % len(self.players)
        return self.players[idx]

    def top_card(self):
        return self.discard_pile[-1] if self.discard_pile else None

    def player_has_color(self, sid, color, exclude_card_id=None):
        if color not in COLORS:
            return False
        for card in self.hands.get(sid, []):
            if card["id"] == exclude_card_id:
                continue
            if card["color"] == color:
                return True
        return False

    def is_playable_on_top(self, sid, card):
        top = self.top_card()
        if not top:
            return True
        if card["type"] in ("wild", "wild4"):
            if card["type"] == "wild4":
                return not self.player_has_color(sid, self.current_color, exclude_card_id=card["id"])
            return True
        if card["color"] == self.current_color:
            return True
        if top["type"] == "number" and card["type"] == "number" and top["value"] == card["value"]:
            return True
        if top["type"] != "number" and card["type"] == top["type"]:
            return True
        return False

    def playable_card_ids(self, sid):
        ids = []
        restriction = self.must_play_drawn.get(sid)
        for card in self.hands.get(sid, []):
            if restriction and card["id"] != restriction["id"]:
                continue
            if self.is_playable_on_top(sid, card):
                ids.append(card["id"])
        return ids

    def sync_uno_flags(self, sid):
        hand_len = len(self.hands.get(sid, []))
        if hand_len != 1:
            self.uno_pending.discard(sid)
            self.uno_called.discard(sid)

    def draw_card(self, sid):
        if self.status != "playing":
            raise ValueError("not_playing")
        if self.pending_challenge:
            raise ValueError("challenge_pending")
        if sid != self.current_sid:
            raise ValueError("not_your_turn")
        if sid in self.must_play_drawn:
            raise ValueError("must_play_or_pass")
        card = self._draw_one()
        if card is None:
            raise ValueError("deck_empty")
        self.hands[sid].append(card)
        self.sync_uno_flags(sid)
        self.last_action = {"type": "draw", "sid": sid, "count": 1, "cards": [card_public(card)]}
        if self.is_playable_on_top(sid, card):
            self.must_play_drawn[sid] = card
            self.message = "سحبت ورقة قابلة للعب — يمكنك لعبها أو إنهاء دورك"
        else:
            self.message = "سحبت ورقة غير قابلة للعب — انتقل الدور"
            self.advance_turn(sid)
        return card_public(card)

    def pass_turn(self, sid):
        if self.status != "playing":
            raise ValueError("not_playing")
        if sid != self.current_sid:
            raise ValueError("not_your_turn")
        if sid not in self.must_play_drawn:
            raise ValueError("nothing_to_pass")
        self.must_play_drawn.pop(sid, None)
        self.message = "تم إنهاء الدور بعد السحب"
        self.last_action = {"type": "pass", "sid": sid}
        self.advance_turn(sid)

    def call_uno(self, sid):
        if len(self.hands.get(sid, [])) != 1:
            raise ValueError("uno_not_available")
        self.uno_called.add(sid)
        self.uno_pending.discard(sid)
        self.message = "UNO! تم تأمين الورقة الأخيرة"
        self.last_action = {"type": "call_uno", "sid": sid}

    def catch_uno(self, catcher_sid, target_sid):
        if catcher_sid == target_sid:
            raise ValueError("cannot_catch_self")
        if target_sid not in self.players:
            raise ValueError("invalid_target")
        if len(self.hands.get(target_sid, [])) != 1 or target_sid not in self.uno_pending:
            raise ValueError("target_safe")
        cards = []
        for _ in range(2):
            card = self._draw_one()
            if card:
                self.hands[target_sid].append(card)
                cards.append(card_public(card))
        self.sync_uno_flags(target_sid)
        self.message = "تمت معاقبة لاعب نسي قول UNO بسحب ورقتين"
        self.last_action = {"type": "catch_uno", "sid": catcher_sid, "target_sid": target_sid, "count": 2, "cards": cards}

    def play_card(self, sid, card_id, chosen_color=None):
        if self.status != "playing":
            raise ValueError("not_playing")
        if self.pending_challenge:
            raise ValueError("challenge_pending")
        if sid != self.current_sid:
            raise ValueError("not_your_turn")

        hand = self.hands.get(sid, [])
        card = next((c for c in hand if c["id"] == card_id), None)
        if not card:
            raise ValueError("card_not_found")

        restriction = self.must_play_drawn.get(sid)
        if restriction and restriction["id"] != card_id:
            raise ValueError("only_drawn_card")

        if card["type"] in ("wild", "wild4"):
            if chosen_color not in COLORS:
                raise ValueError("choose_color")
        elif chosen_color is None:
            chosen_color = card["color"]

        if not self.is_playable_on_top(sid, card):
            raise ValueError("illegal_move")

        had_color_before_wild4 = False
        if card["type"] == "wild4":
            had_color_before_wild4 = self.player_has_color(sid, self.current_color, exclude_card_id=card["id"])

        hand.remove(card)
        self.discard_pile.append(card)
        self.must_play_drawn.pop(sid, None)
        self.current_color = chosen_color if card["type"] in ("wild", "wild4") else card["color"]

        if len(hand) == 1:
            self.uno_pending.add(sid)
            self.uno_called.discard(sid)
        else:
            self.uno_pending.discard(sid)
            self.uno_called.discard(sid)

        if len(hand) == 0:
            self.finish_round(sid)
            self.last_action = {"type": "win", "sid": sid, "card": card_public(card)}
            return

        action = {"type": "play", "sid": sid, "card": card_public(card), "chosen_color": self.current_color}

        if card["type"] == "number":
            self.message = f"تم لعب {card['label']}"
            self.last_action = action
            self.advance_turn(sid)
            return

        if card["type"] == "skip":
            target = self.next_sid(sid)
            action.update({"target_sid": target, "count": 0})
            self.message = f"تم لعب {card['label']} — تم تخطي اللاعب التالي"
            self.last_action = action
            self.advance_turn(sid, steps=2)
            return

        if card["type"] == "reverse":
            self.direction *= -1
            if len(self.players) == 2:
                self.current_sid = sid
                self.message = "عكس مع لاعبين فقط — نفس اللاعب يلعب مرة أخرى"
            else:
                self.message = "تم عكس اتجاه اللعب"
                self.advance_turn(sid)
            self.last_action = action
            return

        if card["type"] == "draw2":
            target = self.next_sid(sid)
            drawn_cards = []
            for _ in range(2):
                drawn = self._draw_one()
                if drawn:
                    self.hands[target].append(drawn)
                    drawn_cards.append(card_public(drawn))
            self.sync_uno_flags(target)
            action.update({"target_sid": target, "count": 2, "cards": drawn_cards})
            self.message = "+2 — اللاعب التالي يسحب ورقتين ويُتخطى"
            self.last_action = action
            self.advance_turn(sid, steps=2)
            return

        if card["type"] == "wild":
            self.message = f"تم تغيير اللون إلى {COLOR_LABELS[self.current_color]}"
            self.last_action = action
            self.advance_turn(sid)
            return

        if card["type"] == "wild4":
            target = self.next_sid(sid)
            self.pending_challenge = {
                "offender_sid": sid,
                "target_sid": target,
                "had_matching_color": had_color_before_wild4,
                "chosen_color": self.current_color,
            }
            self.current_sid = target
            action.update({"target_sid": target, "count": 4})
            self.last_action = action
            self.message = "+4 — على اللاعب التالي قبول السحب أو التحدي"
            return

    def resolve_wild4(self, sid, challenge=False):
        if not self.pending_challenge:
            raise ValueError("no_challenge_pending")
        if sid != self.pending_challenge["target_sid"]:
            raise ValueError("not_target")
        offender = self.pending_challenge["offender_sid"]
        target = self.pending_challenge["target_sid"]
        had_match = self.pending_challenge["had_matching_color"]
        self.pending_challenge = None
        cards = []

        if challenge:
            if had_match:
                for _ in range(4):
                    card = self._draw_one()
                    if card:
                        self.hands[offender].append(card)
                        cards.append(card_public(card))
                self.sync_uno_flags(offender)
                self.message = "نجح التحدي — اللاعب الذي لعب +4 سحب 4 أوراق"
                self.last_action = {"type": "wild4_challenge_success", "sid": sid, "target_sid": offender, "count": 4, "cards": cards}
            else:
                for _ in range(6):
                    card = self._draw_one()
                    if card:
                        self.hands[target].append(card)
                        cards.append(card_public(card))
                self.sync_uno_flags(target)
                self.message = "فشل التحدي — سحبت 6 أوراق"
                self.last_action = {"type": "wild4_challenge_fail", "sid": sid, "target_sid": target, "count": 6, "cards": cards}
        else:
            for _ in range(4):
                card = self._draw_one()
                if card:
                    self.hands[target].append(card)
                    cards.append(card_public(card))
            self.sync_uno_flags(target)
            self.message = "تم قبول +4 وسحب 4 أوراق"
            self.last_action = {"type": "wild4_accept", "sid": sid, "target_sid": target, "count": 4, "cards": cards}

        self.current_sid = self.next_sid(target)

    def advance_turn(self, sid, steps=1):
        self.current_sid = self.next_sid(sid, steps)

    def finish_round(self, winner_sid):
        total = 0
        for sid, cards in self.hands.items():
            if sid == winner_sid:
                continue
            total += sum(self.card_points(c) for c in cards)
        self.scores[winner_sid] = self.scores.get(winner_sid, 0) + total
        self.status = "round_over"
        self.winner_sid = winner_sid
        self.current_sid = None
        self.pending_challenge = None
        self.must_play_drawn = {}
        self.uno_pending.clear()
        self.uno_called.clear()
        self.message = f"انتهت الجولة — الفائز حصل على {total} نقطة"

    def card_points(self, card):
        if card["type"] == "number":
            return int(card["value"])
        return CARD_POINTS[card["type"]]

    def snapshot_message(self):
        return {"status": self.status, "message": self.message}

    def state_for(self, viewer_sid, room_users, host_sid, room_settings):
        players = []
        for user in room_users:
            sid = user["id"]
            hand = self.hands.get(sid, [])
            players.append({
                "id": sid,
                "name": user["name"],
                "character": user["character"],
                "avatar": user.get("avatar"),
                "bio": user.get("bio", ""),
                "speaking": user.get("speaking", False),
                "muted": user.get("muted", False),
                "speaker_muted": user.get("speaker_muted", False),
                "join_seq": user.get("join_seq", 0),
                "is_host": sid == host_sid,
                "in_round": sid in self.players,
                "hand_count": len(hand),
                "said_uno": sid in self.uno_called,
                "uno_pending": sid in self.uno_pending,
                "is_turn": sid == self.current_sid and self.status == "playing" and not self.pending_challenge,
                "score": self.scores.get(sid, 0),
                "is_viewer": sid == viewer_sid,
            })

        my_hand = [card_public(card) for card in self.hands.get(viewer_sid, [])]
        my_playable = self.playable_card_ids(viewer_sid) if self.status == "playing" else []

        pending_challenge = None
        if self.pending_challenge:
            pending_challenge = deepcopy(self.pending_challenge)
            pending_challenge["for_viewer"] = viewer_sid == self.pending_challenge["target_sid"]

        catchable = [p["id"] for p in players if p["id"] != viewer_sid and p["uno_pending"] and p["hand_count"] == 1]
        in_round_count = len([p for p in players if p["in_round"]])

        return {
            "status": self.status,
            "message": self.message,
            "round_number": self.round_number,
            "current_sid": self.current_sid,
            "direction": self.direction,
            "current_color": self.current_color,
            "top_card": card_public(self.top_card()) if self.top_card() else None,
            "draw_pile_count": len(self.draw_pile),
            "discard_count": len(self.discard_pile),
            "players": players,
            "my_hand": my_hand,
            "my_playable_ids": my_playable,
            "host_sid": host_sid,
            "winner_sid": self.winner_sid,
            "pending_challenge": pending_challenge,
            "can_start": viewer_sid == host_sid and len(room_users) >= 2 and self.status in ("lobby", "round_over"),
            "can_draw": self.status == "playing" and viewer_sid == self.current_sid and not self.pending_challenge and viewer_sid not in self.must_play_drawn,
            "can_pass": self.status == "playing" and viewer_sid == self.current_sid and viewer_sid in self.must_play_drawn,
            "can_call_uno": viewer_sid in self.uno_pending and len(self.hands.get(viewer_sid, [])) == 1,
            "catchable_uno": catchable,
            "in_round_count": in_round_count,
            "settings": {
                "starting_cards": room_settings.get("starting_cards", self.starting_cards),
            },
            "last_action": deepcopy(self.last_action),
        }
