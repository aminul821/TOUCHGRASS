"""Settings, read from environment variables or a .env file."""
import os

from dotenv import load_dotenv

load_dotenv()


def _int_list(value: str) -> set[int]:
    return {int(x) for x in value.replace(",", " ").split() if x.strip().lstrip("-").isdigit()}


# Bot token from @BotFather (required).
BOT_TOKEN = os.getenv("BOT_TOKEN", "")

# Ollama server hosting the open-weight model. Plans and photos never leave it.
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")
# Any Ollama model. A vision model (gemma3, qwen2.5vl, llava…) is needed to check /touched photos.
MODEL = os.getenv("OLLAMA_MODEL", "gemma3:4b")

# How far to look for parks, trails and viewpoints, in metres.
SEARCH_RADIUS = int(os.getenv("SEARCH_RADIUS", "3000"))
# The daily golden-hour nudge goes out this many minutes before sunset (0 = never).
NUDGE_BEFORE_SUNSET = int(os.getenv("NUDGE_BEFORE_SUNSET", "120"))

# Optional: only answer in these chat ids (space or comma separated). Empty = anywhere.
ALLOWED_CHATS = _int_list(os.getenv("ALLOWED_CHATS", ""))

DATA_PATH = os.path.abspath(os.getenv("DATA_PATH", "data/touchgrass.json"))
