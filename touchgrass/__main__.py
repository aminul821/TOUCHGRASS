import logging
import sys

from telegram import BotCommand, LinkPreviewOptions
from telegram.constants import ParseMode
from telegram.ext import Application, CallbackQueryHandler, CommandHandler, Defaults, MessageHandler, filters

from touchgrass import bot, config

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s %(name)s: %(message)s", datefmt="%H:%M:%S")
logging.getLogger("httpx").setLevel(logging.WARNING)
LOGGER = logging.getLogger("touchgrass")

COMMANDS = [
    BotCommand("touchgrass", "🌿 Best time & spot to go outside"),
    BotCommand("touched", "📸 Log a photo from outside"),
    BotCommand("grassboard", "🔥 Streak leaderboard"),
    BotCommand("sethome", "🏡 Set the group's home spot (admins)"),
    BotCommand("nudges", "☀️ Golden-hour nudges on/off (admins)"),
    BotCommand("help", "📖 Help"),
]


async def post_init(app: Application) -> None:
    await app.bot.set_my_commands(COMMANDS)
    LOGGER.info("Touch Grass bot @%s started · model %s at %s", app.bot.username, config.MODEL, config.OLLAMA_URL)


def main() -> None:
    if not config.BOT_TOKEN:
        LOGGER.error("BOT_TOKEN is missing (see .env.example)")
        sys.exit(1)
    app = (
        Application.builder()
        .token(config.BOT_TOKEN)
        .defaults(Defaults(parse_mode=ParseMode.HTML, link_preview_options=LinkPreviewOptions(is_disabled=True)))
        .post_init(post_init)
        .concurrent_updates(True)
        .build()
    )
    app.add_handler(CommandHandler(["start", "help"], bot.start_cmd))
    app.add_handler(CommandHandler(["touchgrass", "outside", "grass"], bot.touchgrass_cmd))
    app.add_handler(CommandHandler("sethome", bot.sethome_cmd))
    app.add_handler(CommandHandler("nudges", bot.nudges_cmd))
    app.add_handler(CommandHandler(["touched", "proof"], bot.touched_cmd))
    # A photo sent with "/touched" as its caption (commands in captions aren't CommandHandler updates).
    app.add_handler(MessageHandler(filters.PHOTO & filters.CaptionRegex(r"^/(touched|proof)(@\w+)?(\s|$)"), bot.touched_cmd))
    app.add_handler(CommandHandler(["grassboard", "streaks"], bot.grassboard_cmd))
    app.add_handler(CallbackQueryHandler(bot.rsvp_cb, pattern=r"^grass:in$"))
    app.add_handler(CallbackQueryHandler(bot.plan_cb, pattern=r"^grass:plan$"))
    if config.NUDGE_BEFORE_SUNSET:
        app.job_queue.run_repeating(bot.nudge_job, interval=600, first=30)
    app.run_polling(allowed_updates=["message", "callback_query"])


if __name__ == "__main__":
    main()
