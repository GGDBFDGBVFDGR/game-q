#!/usr/bin/env python3
"""Раздаёт игру и принимает нажатия с телефонов двух команд."""

import json
import os
import secrets
import socket
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
GAMES_PATH = os.path.join(ROOT, "games.json")
SESSIONS = {}
RUNTIME = {}
GAMES = {}
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def lan_ip():
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("8.8.8.8", 80))
        return probe.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        probe.close()


def load_games():
    global GAMES
    if not os.path.exists(GAMES_PATH):
        GAMES = {}
        return GAMES
    with open(GAMES_PATH, encoding="utf-8") as handle:
        data = json.load(handle)
    GAMES = data if isinstance(data, dict) else {}
    return GAMES


def save_games(games):
    global GAMES
    GAMES = games
    with open(GAMES_PATH, "w", encoding="utf-8") as handle:
        json.dump(games, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def clean_code(value):
    code = str(value or "").strip().upper()
    if len(code) != 6 or any(char not in CODE_ALPHABET for char in code):
        return ""
    return code


def fresh_code(games):
    for _ in range(30):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
        if code not in games:
            return code
    return secrets.token_hex(3).upper()


def blank_runtime():
    return {
        "pads": {
            "1": {"up": False, "down": False, "left": False, "right": False, "seen": 0.0},
            "2": {"up": False, "down": False, "left": False, "right": False, "seen": 0.0},
        },
        "question": {
            "1": {"quiz": None, "title": "", "prompt": "", "choices": [], "answered": False, "purse": 0, "cutOk": False, "revealOk": False},
            "2": {"quiz": None, "title": "", "prompt": "", "choices": [], "answered": False, "purse": 0, "cutOk": False, "revealOk": False},
        },
        "answers": [],
        "answer_seq": 0,
        "shops": [],
        "shop_seq": 0,
    }


def runtime_for(code):
    if code not in RUNTIME:
        RUNTIME[code] = blank_runtime()
    return RUNTIME[code]


def normalize_rooms(raw):
    if not isinstance(raw, list) or not 5 <= len(raw) <= 15:
        return None
    rooms = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            return None
        choices = item.get("choices")
        if not isinstance(choices, list) or len(choices) != 4:
            return None
        choices = [str(choice).strip()[:160] for choice in choices]
        if any(not choice for choice in choices):
            return None
        answer = item.get("answer")
        if isinstance(answer, bool) or not isinstance(answer, int) or not 0 <= answer <= 3:
            return None
        code = str(item.get("code") or "").strip()[:12]
        title = str(item.get("title") or "").strip()[:48]
        prompt = str(item.get("prompt") or "").strip()[:300]
        hint = str(item.get("hint") or "").strip()[:300]
        if not code or not title or not prompt:
            return None
        rooms.append({
            "id": index + 1,
            "code": code,
            "title": title,
            "x": index,
            "y": 0,
            "prompt": prompt,
            "choices": choices,
            "answer": answer,
            "hint": hint,
        })
    return rooms


def pad_view(runtime, team):
    pad = runtime["pads"][team]
    age = time.time() - pad["seen"]
    held = age < 1.6
    return {
        "up": bool(pad["up"]) if held else False,
        "down": bool(pad["down"]) if held else False,
        "left": bool(pad["left"]) if held else False,
        "right": bool(pad["right"]) if held else False,
        "connected": age < 4,
    }


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def session_token(self):
        cookie = self.headers.get("Cookie") or ""
        for part in cookie.split(";"):
            part = part.strip()
            if part.startswith("q_session="):
                return part.split("=", 1)[1]
        return ""

    def authed_code(self):
        token = self.session_token()
        return SESSIONS.get(token, "") if token else ""

    def set_session(self, token):
        self.send_header(
            "Set-Cookie",
            f"q_session={token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=43200",
        )

    def game_code_from_query(self):
        query = parse_qs(urlparse(self.path).query)
        return clean_code(query.get("code", query.get("game", [""]))[0])

    def live_game(self, code):
        if not code or code not in GAMES:
            return None
        return runtime_for(code)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/pad":
            runtime = self.live_game(self.game_code_from_query())
            if runtime is None:
                self._json({"ok": False, "error": "Нет такого кода"}, 404)
                return
            port = self.server.server_address[1]
            origin = f"http://{lan_ip()}:{port}"
            self._json({
                "origin": origin,
                "pads": {"1": pad_view(runtime, "1"), "2": pad_view(runtime, "2")},
                "answers": list(runtime["answers"]),
                "shops": list(runtime["shops"]),
            })
            return
        if path == "/api/question":
            runtime = self.live_game(self.game_code_from_query())
            if runtime is None:
                self._json({"ok": False, "error": "Нет такого кода"}, 404)
                return
            team = parse_qs(urlparse(self.path).query).get("team", ["1"])[0]
            self._json(runtime["question"].get(team) or runtime["question"]["1"])
            return
        if path == "/api/session":
            code = self.authed_code()
            self._json({"ok": bool(code), "code": code})
            return
        if path == "/api/mine":
            code = self.authed_code()
            game = load_games().get(code) if code else None
            if not game:
                self._json({"ok": False}, 401)
                return
            self._json({"ok": True, "code": code, "rooms": game.get("rooms") or []})
            return
        if path == "/api/quiz":
            code = self.game_code_from_query()
            game = load_games().get(code) if code else None
            if not game:
                self._json({"ok": False, "error": "Нет такого кода"}, 404)
                return
            self._json({"ok": True, "code": code, "rooms": game.get("rooms") or []})
            return
        super().do_GET()

    def open_session(self, code):
        token = secrets.token_urlsafe(24)
        SESSIONS[token] = code
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.set_session(token)
        raw = json.dumps({"ok": True, "code": code}, ensure_ascii=False).encode("utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        length = int(self.headers.get("Content-Length", "0") or 0)
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self.send_error(400)
            return
        if path == "/api/create":
            rooms = normalize_rooms(data.get("rooms"))
            if rooms is None:
                self._json({"ok": False, "error": "Нужно от 5 до 15 вопросов, у каждого 4 ответа и один верный"}, 400)
                return
            games = load_games()
            code = fresh_code(games)
            games[code] = {"rooms": rooms}
            save_games(games)
            self.open_session(code)
            return
        if path == "/api/login":
            code = clean_code(data.get("code"))
            game = load_games().get(code) if code else None
            if not game:
                self._json({"ok": False, "error": "Нет такого кода"}, 404)
                return
            self.open_session(code)
            return
        if path == "/api/logout":
            SESSIONS.pop(self.session_token(), None)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Set-Cookie", "q_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0")
            raw = json.dumps({"ok": True}).encode("utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        if path == "/api/quiz":
            code = self.authed_code()
            games = load_games()
            if code not in games:
                self._json({"ok": False, "error": "Сначала сохраните лабиринт"}, 401)
                return
            rooms = normalize_rooms(data.get("rooms"))
            if rooms is None:
                self._json({"ok": False, "error": "Нужно от 5 до 15 вопросов, у каждого 4 ответа и один верный"}, 400)
                return
            games[code]["rooms"] = rooms
            save_games(games)
            self._json({"ok": True, "code": code})
            return
        code = clean_code(data.get("game") or data.get("code"))
        runtime = self.live_game(code)
        if path == "/api/reset":
            if runtime is None:
                self._json({"ok": False, "error": "Нет такого кода"}, 404)
                return
            fresh = blank_runtime()
            runtime.clear()
            runtime.update(fresh)
            self._json({"ok": True})
            return
        if path == "/api/question":
            if runtime is None:
                self._json({"ok": False, "error": "Нет такого кода"}, 404)
                return
            teams = data.get("teams") if isinstance(data.get("teams"), dict) else {"1": data, "2": data}
            for key in ("1", "2"):
                item = teams.get(key)
                if not isinstance(item, dict):
                    continue
                runtime["question"][key] = {
                    "quiz": item.get("quiz"),
                    "title": str(item.get("title") or ""),
                    "prompt": str(item.get("prompt") or ""),
                    "choices": item.get("choices") if isinstance(item.get("choices"), list) else [],
                    "answered": bool(item.get("answered")),
                    "purse": int(item.get("purse") or 0),
                    "cutOk": bool(item.get("cutOk")),
                    "revealOk": bool(item.get("revealOk")),
                    "reveal": item.get("reveal") if isinstance(item.get("reveal"), int) and not isinstance(item.get("reveal"), bool) else None,
                }
            self._json({"ok": True})
            return
        if path == "/api/answer":
            if runtime is None:
                self.send_error(404)
                return
            team = str(data.get("team", ""))
            quiz = data.get("quiz")
            index = data.get("index")
            if team not in runtime["pads"] or not isinstance(quiz, int) or not isinstance(index, int):
                self.send_error(400)
                return
            runtime["answer_seq"] += 1
            runtime["answers"].append({"id": runtime["answer_seq"], "team": team, "quiz": quiz, "index": index})
            del runtime["answers"][:-20]
            self._json({"ok": True})
            return
        if path == "/api/shop":
            if runtime is None:
                self.send_error(404)
                return
            team = str(data.get("team", ""))
            action = data.get("action")
            if team not in runtime["pads"] or action not in ("cut", "reveal"):
                self.send_error(400)
                return
            runtime["shop_seq"] += 1
            runtime["shops"].append({"id": runtime["shop_seq"], "team": team, "action": action})
            del runtime["shops"][:-20]
            self._json({"ok": True})
            return
        if path != "/api/pad":
            self.send_error(404)
            return
        if runtime is None:
            self.send_error(404)
            return
        team = str(data.get("team", ""))
        if team not in runtime["pads"]:
            self.send_error(400)
            return
        pad = runtime["pads"][team]
        for key in ("up", "down", "left", "right"):
            pad[key] = bool(data.get(key))
        pad["seen"] = time.time()
        self._json({"ok": True})

    def _json(self, payload, status=200):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, fmt, *args):
        message = str(args[0])
        if "/api/" in message:
            return
        super().log_message(fmt, *args)


if __name__ == "__main__":
    load_games()
    server = ThreadingHTTPServer(("0.0.0.0", 8766), Handler)
    print(f"Q на экране: http://127.0.0.1:8766")
    print(f"Телефоны: http://{lan_ip()}:8766/control.html?team=1")
    server.serve_forever()
