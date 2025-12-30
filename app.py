import math
import json
import os
import random
import time
import html
import urllib.parse
import urllib.request
from flask import Flask, render_template, request, jsonify

def google_keys_path():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_dir, "google_keys.txt")

def load_google_keys():
    """
    Load both Maps and Translation keys from google_keys.txt.
    Supports JSON ({"maps": "...", "translation": "..."}) or KEY=VALUE lines.
    """
    keys = {"maps": "", "translation": ""}
    path = google_keys_path()
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = f.read().strip()
        if raw:
            # Try JSON first
            try:
                data = json.loads(raw)
                if isinstance(data, dict):
                    keys["maps"] = str(data.get("maps") or data.get("maps_key") or data.get("MAPS_KEY") or "")
                    keys["translation"] = str(data.get("translation") or data.get("translation_key") or data.get("TRANSLATION_KEY") or "")
                    return keys
            except json.JSONDecodeError:
                pass
            # Fallback: parse KEY=VALUE lines
            for line in raw.splitlines():
                if "=" in line:
                    k, v = line.split("=", 1)
                    k = k.strip().lower()
                    v = v.strip()
                    if k in {"maps", "maps_key"}:
                        keys["maps"] = v
                    if k in {"translation", "translation_key"}:
                        keys["translation"] = v
    except FileNotFoundError:
        pass
    except OSError:
        pass
    return keys

GOOGLE_KEYS = load_google_keys()
GOOGLE_MAPS_KEY = GOOGLE_KEYS.get("maps", "")
TRANSLATION_API_KEY = GOOGLE_KEYS.get("translation", "")

app = Flask(__name__)

# Seed randomness each run so success messages vary
random.seed(time.time_ns())

# --- LOAD & SAVE RIDDLES FROM FILE ---

def riddles_path():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_dir, "riddles.json")

def sounds_folder():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_dir, "static", "assets", "sounds")

def normalize_riddles(data):
    """
    Ensure every riddle has text/lat/lng/tolerance and a sequential id.
    """
    cleaned = []
    if isinstance(data, list):
        for idx, r in enumerate(data):
            if not isinstance(r, dict):
                continue
            cleaned.append({
                "id": idx,
                "text": str(r.get("text", "") or ""),
                "lat": float(r.get("lat", 0.0)),
                "lng": float(r.get("lng", 0.0)),
                "tolerance_m": float(r.get("tolerance_m", 200)),
            })
    return cleaned


def load_riddles():
    """
    Load riddles from riddles.json in the same folder as app.py.
    """
    path = riddles_path()
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return normalize_riddles(data)

def save_riddles(riddles_list):
    """
    Save riddles to riddles.json and overwrite the global RIDDLES.
    """
    global RIDDLES
    # re-number ids
    for i, r in enumerate(riddles_list):
        r["id"] = i
    path = riddles_path()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(riddles_list, f, ensure_ascii=False, indent=2)
    RIDDLES = riddles_list

RIDDLES = load_riddles()

def game_content_path():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_dir, "game_content.json")

DEFAULT_LANDING_CONTENT = {
    "headline": "מסע בעקבות המטמון",
    "subtitle": (
        "ברוכים הבאים למשחק החידות!\\n"
        "השתמשו ברמזים, נחשו את המיקומים על המפה ובנו יחד חוויה כיפית.\\n"
        "אפשר לערוך את הטקסט הזה במסך העיצוב בכל רגע."
    ),
    "ending_title": "התראות",
    "treasure_message": (
        "🎉רועי ונתנאלה היקרים,"
        "המסע שלכם הוכיח שכשהלב יודע את הדרך הכל מסתדר."
        "עברתם יחד דרך מוסיקה, לימודים, צבא,אתגרים, שמחות וזיכרונות. וכל תחנה הובילה אתכם אל המקום שבו אתם בוחרים זה בזו מחדש."
        ""
        "מברכים אתכם באהבה גדולה ובאין סוף רגעים יפים יחד,"
        "מעיין, ירדן, איתי, יאיר ועדי 🎉"
    ),
    "success_messages": [
        {"text": "פגעתם בול בפוני!", "sound": "success1.m4a"},
        {"text": "כל הכבוד, תשובה מושלמת!", "sound": "success2.m4a"},
        {"text": "יפה מאוד! מצאתם את המקום המדויק!", "sound": "success3.m4a"},
        {"text": "מעולה! אתם ממש על זה!", "sound": "success4.m4a"},
        {"text": "קולעים למטרה כמו מקצוענים!", "sound": "success5.m4a"},
        {"text": "ניחוש מצוין - ממש בול במקום!", "sound": "success6.m4a"},
        {"text": "אלופים! הגעתם לנקודה המדויקת!", "sound": "success7.m4a"},
        {"text": "וואו! איזה דיוק!", "sound": "success8.m4a"},
        {"text": "תשובה נהדרת, ממש זוג מנצח!", "sound": "success9.m4a"},
    ],
}

def normalize_landing_content(data):
    """
    Normalize landing/ending content with defaults.
    """
    try:
        headline = str(data.get("headline", "")).strip()
        subtitle = str(data.get("subtitle", "")).strip()
        ending_title = str(data.get("ending_title", "")).strip()
        treasure_message = str(data.get("treasure_message", "")).strip()
        success_messages_raw = data.get("success_messages", [])
    except Exception:
        headline = ""
        subtitle = ""
        ending_title = ""
        treasure_message = ""
        success_messages_raw = []

    return {
        "headline": headline or DEFAULT_LANDING_CONTENT["headline"],
        "subtitle": subtitle or DEFAULT_LANDING_CONTENT["subtitle"],
        "ending_title": ending_title or DEFAULT_LANDING_CONTENT.get("ending_title", ""),
        "treasure_message": treasure_message or DEFAULT_LANDING_CONTENT["treasure_message"],
        "success_messages": normalize_success_messages(success_messages_raw),
    }

def normalize_success_messages(raw_list):
    success = []
    if isinstance(raw_list, list):
        for item in raw_list:
            if not isinstance(item, dict):
                continue
            text = str(item.get("text", "")).strip()
            sound = str(item.get("sound", "")).strip() or "success1.m4a"
            if text:
                success.append({"text": text, "sound": sound})
    if not success:
        success = DEFAULT_LANDING_CONTENT["success_messages"]
    return success

def load_game_content():
    """
    Load combined game config (riddles + landing) from game_content.json if it exists,
    otherwise fall back to separate riddles file + defaults.
    """
    gc_path = game_content_path()
    if os.path.exists(gc_path):
        try:
            with open(gc_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            riddles = normalize_riddles(data.get("riddles", []))
            landing = normalize_landing_content(data.get("landing", {}))
            return {"riddles": riddles, "landing": landing}
        except (OSError, json.JSONDecodeError):
            pass
    return {"riddles": load_riddles(), "landing": normalize_landing_content({})}

def save_game_content(riddles_list, landing_content):
    """
    Save combined game config to a single JSON file, and keep riddles file in sync.
    """
    global GAME_CONTENT, RIDDLES, TREASURE_MESSAGE, SUCCESS_MESSAGES, SUCCESS_SOUNDS

    cleaned_riddles = normalize_riddles(riddles_list)
    cleaned_landing = normalize_landing_content(landing_content)

    payload = {
        "riddles": cleaned_riddles,
        "landing": cleaned_landing,
    }
    with open(game_content_path(), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    # Update globals
    save_riddles(cleaned_riddles)  # optional compatibility
    GAME_CONTENT = payload
    RIDDLES = cleaned_riddles
    TREASURE_MESSAGE = cleaned_landing.get("treasure_message", DEFAULT_LANDING_CONTENT["treasure_message"])
    SUCCESS_MESSAGES = [item.get("text", "") for item in cleaned_landing.get("success_messages", DEFAULT_LANDING_CONTENT["success_messages"])]
    SUCCESS_SOUNDS = [item.get("sound", "") for item in cleaned_landing.get("success_messages", DEFAULT_LANDING_CONTENT["success_messages"])]
GAME_CONTENT = load_game_content()
RIDDLES = GAME_CONTENT["riddles"]

TREASURE_MESSAGE = GAME_CONTENT["landing"].get("treasure_message", DEFAULT_LANDING_CONTENT["treasure_message"])
SUCCESS_MESSAGES = [item.get("text", "") for item in GAME_CONTENT["landing"].get("success_messages", DEFAULT_LANDING_CONTENT["success_messages"])]
SUCCESS_SOUNDS = [item.get("sound", "") for item in GAME_CONTENT["landing"].get("success_messages", DEFAULT_LANDING_CONTENT["success_messages"])]

# --- HELPERS ---

def haversine_distance_m(lat1, lon1, lat2, lon2):
    R = 6371000  # meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = (math.sin(dphi / 2) ** 2 +
         math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def translate_texts(texts, target_lang="en", source_lang="he"):
    """
    Use Google Cloud Translation API (v2) with the key from cloud_translation_key.txt.
    If the key is missing or the call fails, return the original texts unchanged.
    """
    if not TRANSLATION_API_KEY:
        return texts
    if not texts:
        return []

    translated = []
    endpoint = "https://translation.googleapis.com/language/translate/v2"

    # API accepts multiple q parameters; keep batches modest to avoid huge payloads
    batch_size = 80
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        params = {
            "key": TRANSLATION_API_KEY,
            "target": target_lang,
            "source": source_lang,
            "format": "text",
        }
        data = urllib.parse.urlencode(
            [("q", t) for t in batch] +
            [("target", target_lang), ("source", source_lang), ("format", "text"), ("key", TRANSLATION_API_KEY)]
        ).encode("utf-8")
        req = urllib.request.Request(endpoint, data=data, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
                entries = payload.get("data", {}).get("translations", [])
                for idx, entry in enumerate(entries):
                    if "translatedText" in entry:
                        translated.append(html.unescape(entry["translatedText"]))
                    else:
                        translated.append(batch[idx] if idx < len(batch) else "")
        except Exception:
            # On any failure, fall back to originals for this batch
            translated.extend(batch)

    # In case API returned fewer items, pad with originals
    if len(translated) < len(texts):
        translated.extend(texts[len(translated):])
    return translated


# --- ROUTES ---

@app.route("/game")
def game():
    print("serving from", __file__, "key:", repr(GOOGLE_MAPS_KEY), flush=True)
    return render_template(
        "game.html",
        start_riddle_id=RIDDLES[0]["id"],
        start_riddle_text=RIDDLES[0]["text"],
        success_sounds_json=json.dumps(SUCCESS_SOUNDS, ensure_ascii=False),
        GOOGLE_MAPS_KEY=GOOGLE_MAPS_KEY
    )

@app.route("/design")
def design():
    print("GOOGLE_MAPS_KEY:", repr(GOOGLE_MAPS_KEY))
    return render_template(
        "design.html",
        riddles_json=json.dumps(RIDDLES, ensure_ascii=False),
        landing_content_json=json.dumps(GAME_CONTENT["landing"], ensure_ascii=False),
        GOOGLE_MAPS_KEY=GOOGLE_MAPS_KEY
    )

@app.route("/")
def landing():
    # Simple landing page
    return render_template(
        "landing.html",
        landing_title=GAME_CONTENT["landing"].get("headline", DEFAULT_LANDING_CONTENT["headline"]),
        landing_subtitle=GAME_CONTENT["landing"].get("subtitle", DEFAULT_LANDING_CONTENT["subtitle"])
    )


@app.route("/instructions")
def instructions():
    # Simple instructions page
    return render_template("instructions.html")


@app.route("/save-riddles", methods=["POST"])
def save_riddles_route():
    # Legacy endpoint retained; now delegates to unified save-game
    data = request.get_json() or {}
    return save_game_route_core(data, legacy_only=True)


@app.route("/save-landing", methods=["POST"])
def save_landing_route():
    # Legacy endpoint retained; now delegates to unified save-game
    data = request.get_json() or {}
    return save_game_route_core(data, legacy_only=True)

@app.route("/save-game", methods=["POST"])
def save_game_route():
    data = request.get_json() or {}
    return save_game_route_core(data, legacy_only=False)

def save_game_route_core(data, legacy_only=False):
    # Validate riddles
    riddles_payload = data.get("riddles")
    if riddles_payload is None:
        if legacy_only:
            riddles_payload = RIDDLES
        else:
            return jsonify({"ok": False, "error": "No riddles provided"}), 400

    cleaned_riddles = []
    for r in riddles_payload:
        try:
            text = str(r.get("text", "")).strip()
            lat = float(r.get("lat"))
            lng = float(r.get("lng"))
            tol = float(r.get("tolerance_m", 200))
        except (TypeError, ValueError):
            return jsonify({"ok": False, "error": "Invalid riddle fields"}), 400

        cleaned_riddles.append({
            "text": text,
            "lat": lat,
            "lng": lng,
            "tolerance_m": tol
        })

    # Validate landing/ending content
    landing_data = data.get("landing", data)
    try:
        headline = str(landing_data.get("headline", "")).strip()
        subtitle = str(landing_data.get("subtitle", "")).strip()
        ending_title = str(landing_data.get("ending_title", "")).strip()
        treasure_message = str(landing_data.get("treasure_message", "")).strip()
        success_messages_raw = landing_data.get("success_messages", [])
    except Exception:
        return jsonify({"ok": False, "error": "Invalid landing fields"}), 400

    landing_payload = {
        "headline": headline,
        "subtitle": subtitle,
        "ending_title": ending_title,
        "treasure_message": treasure_message,
        "success_messages": success_messages_raw,
    }

    save_game_content(cleaned_riddles, landing_payload)
    return jsonify({"ok": True})


@app.route("/check-answer", methods=["POST"])
def check_answer():
    """
    Used by the game screen.
    """
    data = request.get_json()
    riddle_id = data.get("riddle_id")
    click_lat = data.get("lat")
    click_lng = data.get("lng")

    if riddle_id is None or click_lat is None or click_lng is None:
        return jsonify({
            "correct": False,
            "message": "נתונים לא תקינים נשלחו.",
            "next_riddle": None,
            "finished": False
        }), 400

    if not (0 <= riddle_id < len(RIDDLES)):
        return jsonify({
            "correct": False,
            "message": "חידה לא מוכרת.",
            "next_riddle": None,
            "finished": False
        }), 400

    riddle = RIDDLES[riddle_id]
    target_lat = riddle["lat"]
    target_lng = riddle["lng"]
    tolerance = riddle.get("tolerance_m", 200)

    dist = haversine_distance_m(click_lat, click_lng, target_lat, target_lng)

    if dist <= tolerance:
        if riddle_id + 1 < len(RIDDLES):
            next_riddle = RIDDLES[riddle_id + 1]
            msg_index = random.randrange(len(SUCCESS_MESSAGES))
            msg_text = SUCCESS_MESSAGES[msg_index]
            msg_sound = SUCCESS_SOUNDS[msg_index] if msg_index < len(SUCCESS_SOUNDS) else ""
            return jsonify({
                "correct": True,
                "message": msg_text,
                "message_index": msg_index,
                "sound": msg_sound,
                "next_riddle": {
                    "id": next_riddle["id"],
                    "text": next_riddle["text"]
                },
                "finished": False
            })
        else:
            return jsonify({
                "correct": True,
                "message": TREASURE_MESSAGE,
                "next_riddle": None,
                "finished": True
            })
    else:
        return jsonify({
            "correct": False,
            "message": f"עדיין לא... אתם בערך {int(dist)} מטרים מהמקום. נסו שוב!",
            "next_riddle": None,
            "finished": False
        })

@app.route("/upload-sound", methods=["POST"])
def upload_sound():
    """
    Upload an audio file for success/ending alerts and store under static/assets/sounds.
    """
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "No file provided"}), 400
    file = request.files["file"]
    original_name = file.filename or ""
    if not original_name:
        return jsonify({"ok": False, "error": "Empty filename"}), 400

    _, ext = os.path.splitext(original_name)
    ext = ext.lower()
    allowed_exts = {".mp3", ".m4a", ".wav", ".ogg"}
    if ext not in allowed_exts:
        return jsonify({"ok": False, "error": "Unsupported audio type"}), 400

    safe_name = os.path.basename(original_name).replace(" ", "_")
    dest_dir = sounds_folder()
    os.makedirs(dest_dir, exist_ok=True)
    dest_path = os.path.join(dest_dir, safe_name)
    try:
        file.save(dest_path)
    except OSError as exc:
        return jsonify({"ok": False, "error": f"Could not save file: {exc}"}), 500

    return jsonify({
        "ok": True,
        "filename": safe_name,
        "url": f"/static/assets/sounds/{safe_name}"
    })


@app.route("/translate", methods=["POST"])
def translate_route():
    """
    Translate a batch of strings using Google Cloud Translation.
    Expects JSON: { "texts": [...], "target": "en" }
    """
    data = request.get_json() or {}
    texts = data.get("texts", [])
    target = str(data.get("target", "en") or "en")
    if not isinstance(texts, list):
        return jsonify({"ok": False, "error": "texts must be a list"}), 400
    # Limit payload size
    flat_texts = []
    for t in texts:
        if isinstance(t, str):
            flat_texts.append(t)
        elif t is not None:
            flat_texts.append(str(t))
    if len(flat_texts) > 500:
        flat_texts = flat_texts[:500]

    translated = translate_texts(flat_texts, target_lang=target)
    return jsonify({"ok": True, "translations": translated})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
