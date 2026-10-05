"""
Seeds students in batches (password hashing 35k accounts is too slow to do
in one process run). Re-run this script repeatedly - it resumes from where
it left off - until it reports "All students seeded."

Note on the hashing cost: pbkdf2:sha256 at 20000 iterations is used here so
that seeding ~35,000 accounts completes in a reasonable amount of time. This
is still a real, salted, industry-standard hash (not plaintext) - just tuned
lighter than the framework default (which uses scrypt) because these are
bulk-set default passwords (the student's own ID number) that should be
changed on first login anyway. Bump the iteration count in app.py's LOGIN
check to match if you increase it here, and see README.md's security notes
before going live with real students.
"""
import sqlite3
import csv
import os
import time
from werkzeug.security import generate_password_hash

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, "library.db")
DATA_DIR = "/mnt/user-data/outputs"
BATCH_SIZE = 8000
METHOD = "pbkdf2:sha256:20000"

conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

cur.execute("SELECT COUNT(*) FROM students")
already = cur.fetchone()[0]

with open(os.path.join(DATA_DIR, "students_import_ready.csv"), newline="", encoding="utf-8") as f:
    rows = list(csv.DictReader(f))

total = len(rows)
batch = rows[already: already + BATCH_SIZE]

t0 = time.time()
for row in batch:
    pw_hash = generate_password_hash(row["student_number"], method=METHOD)
    cur.execute(
        """INSERT OR IGNORE INTO students
           (student_number, password_hash, name, course, year, section, type, status, reason)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (
            row["student_number"], pw_hash, row["name"], row["course"],
            row["year"], row["section"], row["type"], row["status"], row["reason"],
        ),
    )
conn.commit()

cur.execute("SELECT COUNT(*) FROM students")
now = cur.fetchone()[0]
conn.close()

elapsed = time.time() - t0
print(f"Seeded batch of {len(batch)} in {elapsed:.1f}s -> {now}/{total} students total")
if now >= total:
    print("All students seeded.")
else:
    print("Run this script again to continue.")
