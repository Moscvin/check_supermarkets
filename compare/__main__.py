"""Compară o listă de cumpărături între magazine.

    python -m compare lista.txt
    echo -e "lapte 2.5% 1l\\npaine x2\\nulei 1l" | python -m compare

Fiecare rând: produs [cantitate] [xN], ex. „lapte 2.5% 1l”, „rosii 1kg”, „paine x2”.
"""
import re
import sys
from html import unescape

from scraper import db

from .matcher import load_offers
from .report import build_report


def main() -> int:
    source = open(sys.argv[1], encoding="utf-8") if len(sys.argv) > 1 else sys.stdin
    report = build_report(source.read().splitlines(), load_offers(db.connect()))
    print(unescape(re.sub(r"<[^>]+>", "", report)))  # în terminal fără tagurile HTML
    return 0


if __name__ == "__main__":
    sys.exit(main())
