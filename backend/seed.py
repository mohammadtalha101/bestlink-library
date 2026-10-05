"""
Builds library.db from schema.sql and imports the real, cleaned book and
student data. Safe to re-run: it deletes any existing database first.
"""
import sqlite3
import csv
import os
from werkzeug.security import generate_password_hash

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, "library.db")
DATA_DIR = "/mnt/user-data/outputs"

if os.path.exists(DB_PATH):
    os.remove(DB_PATH)

conn = sqlite3.connect(DB_PATH)
conn.execute("PRAGMA foreign_keys = ON")
with open(os.path.join(BASE, "schema.sql")) as f:
    conn.executescript(f.read())

cur = conn.cursor()

# ---------------- Staff accounts ----------------
staff = [
    ("admin", "admin123", "Admin User", "admin@bestlink.edu.ph", "admin"),
    ("librarian", "lib123", "Librarian Staff", "library@bestlink.edu.ph", "librarian"),
]
for username, pw, name, email, role in staff:
    cur.execute(
        "INSERT INTO users (username, password_hash, name, email, role) VALUES (?,?,?,?,?)",
        (username, generate_password_hash(pw), name, email, role),
    )
print(f"Seeded {len(staff)} staff accounts (admin/admin123, librarian/lib123)")

# ---------------- Students ----------------
# (seeded separately in chunks by seed_students.py — password hashing for
#  ~35,000 accounts is too slow to run in one shot; see that script)
print("Students: run seed_students.py next (seeded in batches)")

# ---------------- Books ----------------
book_count = 0
with open(os.path.join(DATA_DIR, "books_import_ready.csv"), newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        copies = int(row["copies"]) if row["copies"] else 1
        # Shelf location derived from DDC, same convention as the prototype
        ddc = row["ddc"] or "000"
        try:
            cls = str(int(float(ddc.split()[0].split(".")[0]) // 100 * 100)).zfill(3)
        except (ValueError, IndexError):
            cls = "000"
        div = ddc.split()[0].split(".")[0][:2] + "0" if ddc else "000"
        shelf = f"Aisle {int(cls) // 100 + 1}, Shelf {div}"
        cur.execute(
            """INSERT INTO books (title, author, isbn, publisher, year, ddc, shelf_location, copies_total, copies_available)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (row["title"], row["author"], row["isbn"], row["publisher"], row["year"], row["ddc"], shelf, copies, copies),
        )
        book_count += 1
print(f"Seeded {book_count} book titles")

# ---------------- Book copies (accession-level detail) ----------------
# Map each accession number to its book by matching ddc + title, same key used when we
# grouped the original spreadsheet rows into titles.
cur.execute("SELECT id, title, ddc FROM books")
book_lookup = {}
for bid, title, ddc in cur.fetchall():
    key = (ddc or "").strip().lower() + "||" + (title or "").strip().lower()
    book_lookup[key] = bid

copy_count = 0
skipped = 0
with open(os.path.join(DATA_DIR, "book_copies_detail.csv"), newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        key = (row["call_number"] or "").strip().lower() + "||" + (row["title"] or "").strip().lower()
        bid = book_lookup.get(key)
        if not bid:
            skipped += 1
            continue
        cur.execute(
            "INSERT OR IGNORE INTO book_copies (book_id, accession_number, collection, status, remarks) VALUES (?,?,?,?,?)",
            (bid, row["accession_number"], row["collection"], "on_shelf", row["remarks"]),
        )
        copy_count += 1
print(f"Seeded {copy_count} individual copy/accession records ({skipped} unmatched, skipped)")

conn.commit()
conn.close()
print(f"\nDatabase built at {DB_PATH}")
