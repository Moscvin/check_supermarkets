"""Botul Telegram: primește o listă de cumpărături și răspunde cu comparația între magazine.

    python -m bot          (tokenul din .env: TELEGRAM_BOT_TOKEN=...)
"""
import asyncio
import logging
import os
from pathlib import Path

from aiogram import Bot, Dispatcher, F
from aiogram.client.default import DefaultBotProperties
from aiogram.filters import Command, CommandStart
from aiogram.types import LinkPreviewOptions, Message

from compare.matcher import load_offers
from compare.report import build_report
from scraper import db

ROOT = Path(__file__).resolve().parent.parent
MAX_LEN = 4000  # limita Telegram e 4096 caractere

HELP = (
    "Trimite-mi lista de cumpărături, <b>un produs pe rând</b>:\n\n"
    "<code>lapte 2.5% 1l\npaine x2\nrosii 1kg\nulei floarea soarelui 1l\noua 10</code>\n\n"
    "Îți spun cât costă în fiecare magazin (Linella, Family Market, Metro, Bonus), "
    "unde e cel mai ieftin și cât economisești dacă împarți coșul.\n\n"
    "Sfaturi: pune cantitatea (<code>1l</code>, <code>500g</code>, <code>1kg</code>) pentru o comparație corectă; "
    "<code>x2</code> = două bucăți.\n"
    "/scurt + listă = doar totalurile, fără detalii."
)


def load_env() -> None:
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip())


class Catalog:
    """Produsele din baza de date, reîncărcate automat când scraperele scriu prețuri noi."""

    def __init__(self) -> None:
        self._mtime = 0.0
        self._offers = []

    def get(self):
        mtime = db.DB_PATH.stat().st_mtime
        if mtime != self._mtime:
            self._offers = load_offers(db.connect())
            self._mtime = mtime
            logging.info("catalog încărcat: %d produse", len(self._offers))
        return self._offers


def split_message(text: str) -> list[str]:
    parts, current = [], ""
    for line in text.split("\n"):
        if len(current) + len(line) + 1 > MAX_LEN:
            parts.append(current)
            current = ""
        current += line + "\n"
    return parts + [current] if current.strip() else parts


catalog = Catalog()
dp = Dispatcher()


@dp.message(CommandStart())
@dp.message(Command("help"))
async def start(message: Message) -> None:
    await message.answer(HELP)


async def reply_report(message: Message, text: str, details: bool) -> None:
    lines = text.splitlines()
    if len(lines) > 60:
        await message.answer("Lista e prea lungă: maximum 60 de produse.")
        return
    report = await asyncio.to_thread(build_report, lines, catalog.get(), details)
    for part in split_message(report):
        await message.answer(part)


@dp.message(Command("scurt"))
async def short(message: Message) -> None:
    text = (message.text or "").split(maxsplit=1)
    if len(text) < 2:
        await message.answer("Scrie lista după comandă, ex.:\n<code>/scurt\nlapte 1l\npaine</code>")
        return
    await reply_report(message, text[1], details=False)


@dp.message(F.text & ~F.text.startswith("/"))
async def shopping_list(message: Message) -> None:
    await reply_report(message, message.text, details=True)


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    load_env()
    bot = Bot(
        os.environ["TELEGRAM_BOT_TOKEN"],
        default=DefaultBotProperties(parse_mode="HTML", link_preview=LinkPreviewOptions(is_disabled=True)),
    )
    catalog.get()
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
