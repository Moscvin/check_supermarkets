-- Catalogul curent (ultimul preț). Istoricul de prețuri rămâne doar local / în artefactele GitHub,
-- ca să rămânem sub limita gratuită D1 de 100k scrieri pe zi.
CREATE TABLE IF NOT EXISTS products (
    store       TEXT NOT NULL,
    product_id  TEXT NOT NULL,
    name        TEXT NOT NULL,
    norm        TEXT NOT NULL,   -- nume normalizat (fără diacritice, litere mici, 2,5 → 2.5)
    price       REAL NOT NULL,
    old_price   REAL,
    qty_amount  REAL,            -- cantitatea ambalajului în unitatea de bază
    qty_unit    TEXT,            -- kg | l | buc
    by_weight   INTEGER NOT NULL DEFAULT 0,  -- 1 = la cântar, prețul e pe kg
    url         TEXT,
    hash        TEXT NOT NULL,   -- detectarea modificărilor la sincronizare
    updated     TEXT NOT NULL,
    PRIMARY KEY (store, product_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
    norm, content='products', content_rowid='rowid', tokenize='unicode61', prefix='2 3', columnsize=0
);

CREATE TRIGGER IF NOT EXISTS products_ai AFTER INSERT ON products BEGIN
    INSERT INTO products_fts(rowid, norm) VALUES (new.rowid, new.norm);
END;
CREATE TRIGGER IF NOT EXISTS products_ad AFTER DELETE ON products BEGIN
    INSERT INTO products_fts(products_fts, rowid, norm) VALUES ('delete', old.rowid, old.norm);
END;
-- doar dacă numele s-a schimbat; altfel fiecare actualizare de preț ar rescrie indexul FTS
DROP TRIGGER IF EXISTS products_au;
CREATE TRIGGER products_au AFTER UPDATE ON products WHEN old.norm != new.norm BEGIN
    INSERT INTO products_fts(products_fts, rowid, norm) VALUES ('delete', old.rowid, old.norm);
    INSERT INTO products_fts(rowid, norm) VALUES (new.rowid, new.norm);
END;
