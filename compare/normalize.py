"""Normalizarea numelor de produse și extragerea cantității (gramaj / volum / bucăți)."""
import re
import unicodedata
from dataclasses import dataclass

# Litere chirilice des întâlnite în nume (ТОРЧИН, ЯВА) → transliterare simplă, ca să se poată căuta și în latină.
_CYR = str.maketrans({
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "j", "з": "z", "и": "i",
    "й": "i", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t",
    "у": "u", "ф": "f", "х": "h", "ц": "t", "ч": "ci", "ш": "s", "щ": "s", "ы": "i", "э": "e", "ю": "iu",
    "я": "ia", "ь": "", "ъ": "",
})

# unitate → (unitate de bază, factor de conversie)
UNITS = {
    "kg": ("kg", 1.0), "g": ("kg", 0.001), "gr": ("kg", 0.001), "grame": ("kg", 0.001),
    "l": ("l", 1.0), "ml": ("l", 0.001), "cl": ("l", 0.01), "litri": ("l", 1.0), "litru": ("l", 1.0),
    "buc": ("buc", 1.0), "b": ("buc", 1.0), "p": ("buc", 1.0), "pl": ("buc", 1.0),
}
_UNIT_RE = "|".join(sorted(UNITS, key=len, reverse=True))
# „6x0.5l”, „2 x 250 ml”
_MULTI_RE = re.compile(rf"(\d+)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*({_UNIT_RE})\b")
# „400g”, „0.5 l”, „1L”
_QTY_RE = re.compile(rf"(?<![\d.])(\d+(?:\.\d+)?)\s*({_UNIT_RE})\b")
# vândut la kilogram: „CEAPA, Moldova kg”, „per kg”
_BY_WEIGHT_RE = re.compile(r"(?:^|[\s,/])(?:per\s+)?kg\b")


def normalize(text: str) -> str:
    text = text.lower().translate(_CYR)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"(\d),(\d)", r"\1.\2", text)  # 2,5% → 2.5%
    return re.sub(r"\s+", " ", text).strip()


def words(text: str) -> list[str]:
    """Cuvintele unui nume deja normalizat; păstrează procentele și zecimalele (2.5%)."""
    return re.findall(r"\d+(?:\.\d+)?%?|[a-z]+", text)


@dataclass(frozen=True)
class Quantity:
    amount: float  # în unitatea de bază
    unit: str      # kg | l | buc

    def __str__(self) -> str:
        if self.unit == "buc":
            return f"{self.amount:g} buc"
        if self.amount < 1:
            return f"{self.amount * 1000:g} {'g' if self.unit == 'kg' else 'ml'}"
        return f"{self.amount:g} {self.unit}"


def parse_quantity(text: str) -> Quantity | None:
    """Cantitatea dintr-un text normalizat. Ultima potrivire câștigă (de obicei e gramajul ambalajului)."""
    m = _MULTI_RE.search(text)
    if m:
        unit, factor = UNITS[m.group(3)]
        return Quantity(int(m.group(1)) * float(m.group(2)) * factor, unit)
    matches = list(_QTY_RE.finditer(text))
    if matches:
        # preferăm masă/volum în fața bucăților („Ceai 25p 50g” → 50 g)
        weighted = [m for m in matches if UNITS[m.group(2)][0] != "buc"] or matches
        m = weighted[-1]
        unit, factor = UNITS[m.group(2)]
        if float(m.group(1)) > 0:
            return Quantity(float(m.group(1)) * factor, unit)
    if _BY_WEIGHT_RE.search(text):
        return Quantity(1.0, "kg")
    return None


def product_quantity(norm_name: str, unit: str | None) -> tuple[Quantity | None, bool]:
    """(cantitatea ambalajului, vândut la cântar?) pentru un produs din baza de date.

    `unit` vine de la scraper: zakaz dă „1000 ml” / „1 kg” (la cântar); Family Market dă „1 Kg” la cântar,
    iar „0.91 buc” e greutatea brută, pe care o ignorăm.
    """
    qty = parse_quantity(norm_name)
    if qty is None and unit and not unit.lower().endswith("buc"):
        qty = parse_quantity(normalize(unit))
    by_weight = qty is not None and qty.unit == "kg" and qty.amount == 1.0 and not re.search(r"\d\s*kg", norm_name)
    return qty, by_weight
