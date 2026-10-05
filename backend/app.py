"""
Bestlink College Library System - Backend API
Flask + SQLite. Real password hashing (werkzeug), real JWT auth (PyJWT).

Run:  python3 app.py
API base: http://localhost:5000/api
"""
import sqlite3
import os
import jwt
import datetime
from functools import wraps
from flask import Flask, request, jsonify, g
from werkzeug.security import generate_password_hash, check_password_hash

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, "library.db")
JWT_SECRET = os.environ.get("LIBRARY_JWT_SECRET", "dev-secret-change-this-in-production")
FINE_RATE = 5.0  # pesos per day overdue
LOAN_DAYS = {"student": 7, "faculty": 30}

app = Flask(__name__)


# ---------------------------------------------------------------- db helpers
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def row_to_dict(row):
    return dict(row) if row else None


@app.after_request
def add_cors_headers(resp):
    resp.headers["Access-Control-Allow-Origin"] = https://bestlink-library.netlify.app/
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    return resp


@app.route("/api/<path:_any>", methods=["OPTIONS"])
def cors_preflight(_any):
    return "", 204


# ---------------------------------------------------------------- auth
def make_token(payload):
    payload = {**payload, "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=12)}
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def auth_required(roles=None):
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            auth = request.headers.get("Authorization", "")
            if not auth.startswith("Bearer "):
                return jsonify({"error": "Missing or invalid Authorization header"}), 401
            token = auth.split(" ", 1)[1]
            try:
                data = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
            except jwt.ExpiredSignatureError:
                return jsonify({"error": "Token expired, please log in again"}), 401
            except jwt.InvalidTokenError:
                return jsonify({"error": "Invalid token"}), 401
            if roles and data.get("role") not in roles:
                return jsonify({"error": "Not authorized for this action"}), 403
            g.current_user = data
            return f(*args, **kwargs)
        return wrapper
    return decorator


@app.route("/api/auth/login", methods=["POST"])
def login():
    body = request.get_json(force=True) or {}
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    if not username or not password:
        return jsonify({"error": "Username and password are required"}), 400

    db = get_db()

    # staff account?
    user = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if user and check_password_hash(user["password_hash"], password):
        token = make_token({"sub": user["username"], "role": user["role"], "kind": "staff", "id": user["id"]})
        return jsonify({
            "token": token,
            "user": {"username": user["username"], "name": user["name"], "email": user["email"], "role": user["role"]},
        })

    # student / faculty account (login with student number as username)
    stu = db.execute("SELECT * FROM students WHERE student_number = ?", (username,)).fetchone()
    if stu and check_password_hash(stu["password_hash"], password):
        token = make_token({"sub": stu["student_number"], "role": stu["type"], "kind": "student", "id": stu["id"]})
        return jsonify({
            "token": token,
            "user": {
                "username": stu["student_number"], "name": stu["name"], "role": stu["type"],
                "linkedNumber": stu["student_number"], "course": stu["course"], "status": stu["status"],
            },
        })

    return jsonify({"error": "Incorrect username or password"}), 401


@app.route("/api/auth/staff", methods=["POST"])
@auth_required(roles=["admin"])
def create_staff():
    """Only an admin can create librarian accounts."""
    body = request.get_json(force=True) or {}
    name, username, password = body.get("name", "").strip(), body.get("username", "").strip(), body.get("password", "")
    email = body.get("email", "").strip()
    if not name or not username or not password:
        return jsonify({"error": "Name, username, and password are required"}), 400
    db = get_db()
    exists = db.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone()
    if exists:
        return jsonify({"error": "That username is already taken"}), 409
    db.execute(
        "INSERT INTO users (username, password_hash, name, email, role) VALUES (?,?,?,?, 'librarian')",
        (username, generate_password_hash(password), name, email),
    )
    db.commit()
    return jsonify({"ok": True}), 201


@app.route("/api/staff", methods=["GET"])
@auth_required(roles=["admin"])
def list_staff():
    db = get_db()
    rows = db.execute("SELECT id, username, name, email, role FROM users WHERE role='librarian'").fetchall()
    return jsonify([row_to_dict(r) for r in rows])


@app.route("/api/staff/<int:staff_id>", methods=["DELETE"])
@auth_required(roles=["admin"])
def remove_staff(staff_id):
    db = get_db()
    db.execute("DELETE FROM users WHERE id = ? AND role='librarian'", (staff_id,))
    db.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------- books / catalog
@app.route("/api/books", methods=["GET"])
def list_books():
    db = get_db()
    q = request.args.get("q", "").strip()
    ddc_class = request.args.get("class", "").strip()
    page = max(1, int(request.args.get("page", 1)))
    per_page = min(100, int(request.args.get("per_page", 25)))
    offset = (page - 1) * per_page

    where, params = [], []
    if q:
        where.append("(title LIKE ? OR author LIKE ? OR isbn LIKE ? OR ddc LIKE ?)")
        params += [f"%{q}%"] * 4
    if ddc_class:
        where.append("CAST(SUBSTR(ddc,1,3) AS INTEGER) / 100 * 100 = ?")
        params.append(int(ddc_class))
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    total = db.execute(f"SELECT COUNT(*) FROM books {where_sql}", params).fetchone()[0]
    rows = db.execute(
        f"SELECT * FROM books {where_sql} ORDER BY title LIMIT ? OFFSET ?", params + [per_page, offset]
    ).fetchall()
    return jsonify({"total": total, "page": page, "per_page": per_page, "results": [row_to_dict(r) for r in rows]})


@app.route("/api/books/stats-by-class", methods=["GET"])
def books_stats_by_class():
    db = get_db()
    rows = db.execute("SELECT ddc FROM books").fetchall()
    counts = {}
    for r in rows:
        ddc = (r["ddc"] or "").strip()
        try:
            cls = str(int(float(ddc.split()[0]) // 100 * 100)).zfill(3)
        except (ValueError, IndexError):
            cls = "000"
        counts[cls] = counts.get(cls, 0) + 1
    return jsonify(counts)


@app.route("/api/books/<int:book_id>", methods=["GET"])
def get_book(book_id):
    db = get_db()
    book = db.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
    if not book:
        return jsonify({"error": "Not found"}), 404
    copies = db.execute("SELECT * FROM book_copies WHERE book_id = ?", (book_id,)).fetchall()
    d = row_to_dict(book)
    d["copies"] = [row_to_dict(c) for c in copies]
    return jsonify(d)


def shelf_for(ddc):
    try:
        n = float((ddc or "0").split()[0])
    except ValueError:
        n = 0
    cls = int(n // 100 * 100)
    div = int(n // 10 * 10)
    return f"Aisle {cls // 100 + 1}, Shelf {div:03d}"


@app.route("/api/books", methods=["POST"])
@auth_required(roles=["admin", "librarian"])
def add_book():
    b = request.get_json(force=True) or {}
    if not b.get("title") or not b.get("ddc"):
        return jsonify({"error": "Title and DDC call number are required"}), 400
    copies = max(1, int(b.get("copies", 1)))
    db = get_db()
    cur = db.execute(
        """INSERT INTO books (title, author, isbn, publisher, year, ddc, shelf_location, copies_total, copies_available)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (b["title"], b.get("author", "Unknown"), b.get("isbn", ""), b.get("publisher", ""),
         b.get("year", ""), b["ddc"], shelf_for(b["ddc"]), copies, copies),
    )
    db.commit()
    return jsonify({"id": cur.lastrowid}), 201


@app.route("/api/bulk/books", methods=["POST"])
@auth_required(roles=["admin", "librarian"])
def bulk_books():
    rows = request.get_json(force=True) or []
    db = get_db()
    imported = 0
    for b in rows:
        if not b.get("title") or not b.get("ddc"):
            continue
        copies = max(1, int(b.get("copies", 1) or 1))
        db.execute(
            """INSERT INTO books (title, author, isbn, publisher, year, ddc, shelf_location, copies_total, copies_available)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (b["title"], b.get("author", "Unknown"), b.get("isbn", ""), b.get("publisher", ""),
             b.get("year", ""), b["ddc"], shelf_for(b["ddc"]), copies, copies),
        )
        imported += 1
    db.commit()
    return jsonify({"imported": imported, "skipped": len(rows) - imported})


# ---------------------------------------------------------------- students
@app.route("/api/students", methods=["GET"])
@auth_required(roles=["admin", "librarian"])
def list_students():
    db = get_db()
    q = request.args.get("q", "").strip()
    page = max(1, int(request.args.get("page", 1)))
    per_page = min(100, int(request.args.get("per_page", 25)))
    offset = (page - 1) * per_page
    where, params = "", []
    if q:
        where = "WHERE student_number LIKE ? OR name LIKE ? OR course LIKE ?"
        params = [f"%{q}%"] * 3
    total = db.execute(f"SELECT COUNT(*) FROM students {where}", params).fetchone()[0]
    rows = db.execute(
        f"SELECT id, student_number, name, course, year, section, type, status, reason FROM students {where} "
        "ORDER BY name LIMIT ? OFFSET ?", params + [per_page, offset]
    ).fetchall()
    return jsonify({"total": total, "page": page, "per_page": per_page, "results": [row_to_dict(r) for r in rows]})


@app.route("/api/students/<student_number>", methods=["GET"])
@auth_required()
def get_student(student_number):
    db = get_db()
    s = db.execute(
        "SELECT id, student_number, name, course, year, section, type, status, reason FROM students WHERE student_number = ?",
        (student_number,),
    ).fetchone()
    if not s:
        return jsonify({"error": "Not found"}), 404
    return jsonify(row_to_dict(s))


@app.route("/api/students/<student_number>/status", methods=["PUT"])
@auth_required(roles=["admin", "librarian"])
def set_student_status(student_number):
    body = request.get_json(force=True) or {}
    status = body.get("status")
    if status not in ("active", "blocked"):
        return jsonify({"error": "status must be 'active' or 'blocked'"}), 400
    db = get_db()
    db.execute("UPDATE students SET status = ?, reason = ? WHERE student_number = ?",
               (status, body.get("reason", ""), student_number))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/bulk/students", methods=["POST"])
@auth_required(roles=["admin", "librarian"])
def bulk_students():
    rows = request.get_json(force=True) or []
    db = get_db()
    imported = 0
    for s in rows:
        if not s.get("student_number") or not s.get("name"):
            continue
        db.execute(
            """INSERT OR IGNORE INTO students (student_number, password_hash, name, course, year, section, type, status, reason)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (s["student_number"], generate_password_hash(s["student_number"]), s["name"], s.get("course", ""),
             s.get("year", ""), s.get("section", ""), s.get("type", "student"), s.get("status", "active"), s.get("reason", "")),
        )
        imported += 1
    db.commit()
    return jsonify({"imported": imported, "skipped": len(rows) - imported})


# ---------------------------------------------------------------- circulation
@app.route("/api/loans", methods=["GET"])
@auth_required()
def list_loans():
    db = get_db()
    status = request.args.get("status")
    student_number = request.args.get("student_number")
    where, params = [], []
    if status:
        where.append("l.status = ?"); params.append(status)
    if student_number:
        where.append("s.student_number = ?"); params.append(student_number)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    rows = db.execute(f"""
        SELECT l.*, b.title as book_title, b.ddc, s.student_number, s.name as student_name
        FROM loans l JOIN books b ON b.id=l.book_id JOIN students s ON s.id=l.student_id
        {where_sql} ORDER BY l.borrow_date DESC
    """, params).fetchall()
    return jsonify([row_to_dict(r) for r in rows])


@app.route("/api/loans/issue", methods=["POST"])
@auth_required(roles=["admin", "librarian"])
def issue_loan():
    body = request.get_json(force=True) or {}
    book_id, student_number = body.get("book_id"), body.get("student_number")
    db = get_db()
    book = db.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
    student = db.execute("SELECT * FROM students WHERE student_number = ?", (student_number,)).fetchone()
    if not book or not student:
        return jsonify({"error": "Book or student not found"}), 404
    if student["status"] == "blocked":
        return jsonify({"error": f"{student['name']} is currently blocked: {student['reason'] or 'see admin'}"}), 400
    if book["copies_available"] < 1:
        return jsonify({"error": "No copies available"}), 400

    days = LOAN_DAYS.get(student["type"], 7)
    now = datetime.datetime.utcnow()
    due = now + datetime.timedelta(days=days)
    db.execute(
        "INSERT INTO loans (book_id, student_id, borrow_date, due_date, status) VALUES (?,?,?,?, 'active')",
        (book["id"], student["id"], now.isoformat(), due.isoformat()),
    )
    db.execute("UPDATE books SET copies_available = copies_available - 1 WHERE id = ?", (book["id"],))
    db.commit()
    return jsonify({"ok": True, "due_date": due.isoformat()}), 201


@app.route("/api/loans/<int:loan_id>/return", methods=["POST"])
@auth_required(roles=["admin", "librarian"])
def return_loan(loan_id):
    db = get_db()
    loan = db.execute("SELECT * FROM loans WHERE id = ?", (loan_id,)).fetchone()
    if not loan or loan["status"] != "active":
        return jsonify({"error": "Active loan not found"}), 404
    now = datetime.datetime.utcnow()
    due = datetime.datetime.fromisoformat(loan["due_date"])
    late_days = max(0, (now - due).days)
    fine = late_days * FINE_RATE
    db.execute("UPDATE loans SET status='returned', return_date=?, fine_amount=? WHERE id=?",
               (now.isoformat(), fine, loan_id))
    db.execute("UPDATE books SET copies_available = copies_available + 1 WHERE id = ?", (loan["book_id"],))
    # bump earliest waiting reservation for this title to "ready"
    waiting = db.execute(
        "SELECT id FROM reservations WHERE book_id=? AND status='waiting' ORDER BY reserved_date LIMIT 1",
        (loan["book_id"],),
    ).fetchone()
    if waiting:
        db.execute("UPDATE reservations SET status='ready' WHERE id=?", (waiting["id"],))
    db.commit()
    return jsonify({"ok": True, "fine": fine})


@app.route("/api/loans/<int:loan_id>/renew", methods=["POST"])
@auth_required(roles=["admin", "librarian"])
def renew_loan(loan_id):
    db = get_db()
    loan = db.execute("SELECT * FROM loans WHERE id = ?", (loan_id,)).fetchone()
    if not loan or loan["status"] != "active":
        return jsonify({"error": "Active loan not found"}), 404
    if loan["renewals"] >= 2:
        return jsonify({"error": "Renewal limit reached"}), 400
    waiting = db.execute("SELECT 1 FROM reservations WHERE book_id=? AND status='waiting'", (loan["book_id"],)).fetchone()
    if waiting:
        return jsonify({"error": "Someone is waiting for this title"}), 400
    student = db.execute("SELECT * FROM students WHERE id=?", (loan["student_id"],)).fetchone()
    days = LOAN_DAYS.get(student["type"], 7)
    new_due = datetime.datetime.fromisoformat(loan["due_date"]) + datetime.timedelta(days=days)
    db.execute("UPDATE loans SET due_date=?, renewals=renewals+1 WHERE id=?", (new_due.isoformat(), loan_id))
    db.commit()
    return jsonify({"ok": True, "due_date": new_due.isoformat()})


@app.route("/api/loans/<int:loan_id>/fine", methods=["PUT"])
@auth_required(roles=["admin", "librarian"])
def update_fine(loan_id):
    body = request.get_json(force=True) or {}
    db = get_db()
    if "paid" in body:
        db.execute("UPDATE loans SET fine_paid=? WHERE id=?", (1 if body["paid"] else 0, loan_id))
    if body.get("waive"):
        db.execute("UPDATE loans SET fine_amount=0 WHERE id=?", (loan_id,))
    db.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------- reservations
@app.route("/api/reservations", methods=["GET"])
@auth_required()
def list_reservations():
    db = get_db()
    rows = db.execute("""
        SELECT r.*, b.title as book_title, s.student_number, s.name as student_name
        FROM reservations r JOIN books b ON b.id=r.book_id JOIN students s ON s.id=r.student_id
        ORDER BY r.reserved_date DESC
    """).fetchall()
    return jsonify([row_to_dict(r) for r in rows])


@app.route("/api/reservations", methods=["POST"])
@auth_required()
def create_reservation():
    body = request.get_json(force=True) or {}
    db = get_db()
    book = db.execute("SELECT * FROM books WHERE id=?", (body.get("book_id"),)).fetchone()
    student = db.execute("SELECT * FROM students WHERE student_number=?", (body.get("student_number"),)).fetchone()
    if not book or not student:
        return jsonify({"error": "Book or student not found"}), 404
    db.execute("INSERT INTO reservations (book_id, student_id, reserved_date, status) VALUES (?,?,?,'waiting')",
               (book["id"], student["id"], datetime.datetime.utcnow().isoformat()))
    db.commit()
    return jsonify({"ok": True}), 201


@app.route("/api/reservations/<int:res_id>", methods=["DELETE"])
@auth_required()
def cancel_reservation(res_id):
    db = get_db()
    db.execute("UPDATE reservations SET status='cancelled' WHERE id=?", (res_id,))
    db.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------- attendance
@app.route("/api/attendance/checkin", methods=["POST"])
@auth_required(roles=["admin", "librarian"])
def check_in():
    body = request.get_json(force=True) or {}
    db = get_db()
    student = db.execute("SELECT * FROM students WHERE student_number=?", (body.get("student_number"),)).fetchone()
    if not student:
        return jsonify({"error": "No record found for that student number"}), 404
    alert = student["reason"] if student["status"] == "blocked" else None
    db.execute("INSERT INTO attendance_log (student_id, time_in, alert) VALUES (?,?,?)",
               (student["id"], datetime.datetime.utcnow().isoformat(), alert))
    db.commit()
    return jsonify({"ok": True, "student": row_to_dict(student)}), 201


@app.route("/api/attendance", methods=["GET"])
@auth_required(roles=["admin", "librarian"])
def list_attendance():
    db = get_db()
    date = request.args.get("date")
    where, params = "", []
    if date:
        where = "WHERE DATE(a.time_in) = ?"
        params = [date]
    rows = db.execute(f"""
        SELECT a.*, s.student_number, s.name, s.course, s.year, s.section
        FROM attendance_log a JOIN students s ON s.id=a.student_id
        {where} ORDER BY a.time_in DESC LIMIT 500
    """, params).fetchall()
    return jsonify([row_to_dict(r) for r in rows])


# ---------------------------------------------------------------- dashboard
@app.route("/api/dashboard", methods=["GET"])
@auth_required()
def dashboard():
    db = get_db()
    books_total = db.execute("SELECT COUNT(*), SUM(copies_total), SUM(copies_available) FROM books").fetchone()
    active_loans = db.execute("SELECT COUNT(*) FROM loans WHERE status='active'").fetchone()[0]
    overdue = db.execute(
        "SELECT COUNT(*) FROM loans WHERE status='active' AND due_date < ?",
        (datetime.datetime.utcnow().isoformat(),),
    ).fetchone()[0]
    today_checkins = db.execute(
        "SELECT COUNT(*) FROM attendance_log WHERE DATE(time_in) = DATE('now')"
    ).fetchone()[0]
    return jsonify({
        "titles": books_total[0], "copies_total": books_total[1], "copies_available": books_total[2],
        "active_loans": active_loans, "overdue": overdue, "checked_in_today": today_checkins,
    })


# ---------------------------------------------------------------- digital resources
@app.route("/api/resources", methods=["GET"])
def list_resources():
    db = get_db()
    q = request.args.get("q", "").strip()
    where, params = "", []
    if q:
        where = "WHERE title LIKE ? OR author LIKE ? OR subject LIKE ?"
        params = [f"%{q}%"] * 3
    rows = db.execute(f"SELECT * FROM digital_resources {where} ORDER BY title", params).fetchall()
    return jsonify([row_to_dict(r) for r in rows])


@app.route("/api/resources", methods=["POST"])
@auth_required(roles=["admin", "librarian"])
def add_resource():
    b = request.get_json(force=True) or {}
    if not b.get("title"):
        return jsonify({"error": "Title is required"}), 400
    db = get_db()
    cur = db.execute(
        "INSERT INTO digital_resources (title, author, type, subject, year, size_label, downloads) VALUES (?,?,?,?,?,?,0)",
        (b["title"], b.get("author", "Unknown"), b.get("type", "E-book"), b.get("subject", "General"),
         b.get("year", ""), b.get("sizeLabel", "")),
    )
    db.commit()
    return jsonify({"id": cur.lastrowid}), 201


@app.route("/api/resources/<int:res_id>/download", methods=["POST"])
def download_resource(res_id):
    db = get_db()
    db.execute("UPDATE digital_resources SET downloads = downloads + 1 WHERE id = ?", (res_id,))
    db.commit()
    row = db.execute("SELECT * FROM digital_resources WHERE id = ?", (res_id,)).fetchone()
    return jsonify(row_to_dict(row))


@app.route("/api/bulk/resources", methods=["POST"])
@auth_required(roles=["admin", "librarian"])
def bulk_resources():
    rows = request.get_json(force=True) or []
    db = get_db()
    imported = 0
    for r in rows:
        if not r.get("title"):
            continue
        db.execute(
            "INSERT INTO digital_resources (title, author, type, subject, year, size_label, downloads) VALUES (?,?,?,?,?,?,0)",
            (r["title"], r.get("author", "Unknown"), r.get("type", "E-book"), r.get("subject", "General"),
             r.get("year", ""), r.get("sizeLabel", "")),
        )
        imported += 1
    db.commit()
    return jsonify({"imported": imported, "skipped": len(rows) - imported})


# ---------------------------------------------------------------- room bookings
ROOMS = ["Discussion Room 1", "Discussion Room 2", "AV Room", "Group Study Pod A", "Group Study Pod B"]


@app.route("/api/rooms/bookings", methods=["GET"])
@auth_required()
def list_room_bookings():
    db = get_db()
    student_number = request.args.get("student_number")
    where, params = "", []
    if student_number:
        where = "WHERE s.student_number = ?"
        params = [student_number]
    rows = db.execute(f"""
        SELECT rb.*, s.student_number, s.name as student_name
        FROM room_bookings rb JOIN students s ON s.id = rb.student_id
        {where} ORDER BY rb.date DESC, rb.slot
    """, params).fetchall()
    return jsonify([row_to_dict(r) for r in rows])


@app.route("/api/rooms/bookings", methods=["POST"])
@auth_required()
def create_room_booking():
    body = request.get_json(force=True) or {}
    db = get_db()
    student = db.execute("SELECT * FROM students WHERE student_number=?", (body.get("student_number"),)).fetchone()
    if not student:
        return jsonify({"error": "Student not found"}), 404
    clash = db.execute(
        "SELECT 1 FROM room_bookings WHERE room=? AND date=? AND slot=? AND status != 'cancelled'",
        (body.get("room"), body.get("date"), body.get("slot")),
    ).fetchone()
    if clash:
        return jsonify({"error": "That room and time slot is already booked"}), 409
    db.execute(
        "INSERT INTO room_bookings (room, date, slot, purpose, student_id, status) VALUES (?,?,?,?,?, 'pending')",
        (body.get("room"), body.get("date"), body.get("slot"), body.get("purpose", "Study session"), student["id"]),
    )
    db.commit()
    return jsonify({"ok": True}), 201


@app.route("/api/rooms/bookings/<int:booking_id>/status", methods=["PUT"])
@auth_required(roles=["admin", "librarian"])
def set_room_booking_status(booking_id):
    body = request.get_json(force=True) or {}
    status = body.get("status")
    if status not in ("pending", "approved", "cancelled"):
        return jsonify({"error": "Invalid status"}), 400
    db = get_db()
    db.execute("UPDATE room_bookings SET status=? WHERE id=?", (status, booking_id))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/rooms", methods=["GET"])
def list_rooms():
    return jsonify(ROOMS)


# ---------------------------------------------------------------- reference desk
@app.route("/api/reference", methods=["GET"])
@auth_required()
def list_reference_queries():
    db = get_db()
    student_number = request.args.get("student_number")
    where, params = "", []
    if student_number:
        where = "WHERE s.student_number = ?"
        params = [student_number]
    rows = db.execute(f"""
        SELECT rq.*, s.student_number, s.name as student_name
        FROM reference_queries rq JOIN students s ON s.id = rq.student_id
        {where} ORDER BY rq.created_at DESC
    """, params).fetchall()
    return jsonify([row_to_dict(r) for r in rows])


@app.route("/api/reference", methods=["POST"])
@auth_required()
def ask_reference_question():
    body = request.get_json(force=True) or {}
    db = get_db()
    student = db.execute("SELECT * FROM students WHERE student_number=?", (body.get("student_number"),)).fetchone()
    if not student:
        return jsonify({"error": "Student not found"}), 404
    db.execute(
        "INSERT INTO reference_queries (student_id, question, status) VALUES (?,?, 'open')",
        (student["id"], body.get("question", "")),
    )
    db.commit()
    return jsonify({"ok": True}), 201


@app.route("/api/reference/<int:query_id>/answer", methods=["PUT"])
@auth_required(roles=["admin", "librarian"])
def answer_reference_question(query_id):
    body = request.get_json(force=True) or {}
    db = get_db()
    db.execute("UPDATE reference_queries SET status='answered', answer=? WHERE id=?",
               (body.get("answer", ""), query_id))
    db.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------- lost & damaged
@app.route("/api/lost-damaged", methods=["GET"])
@auth_required()
def list_lost_damaged():
    db = get_db()
    student_number = request.args.get("student_number")
    where, params = "", []
    if student_number:
        where = "WHERE s.student_number = ?"
        params = [student_number]
    rows = db.execute(f"""
        SELECT ld.*, b.title as book_title, s.student_number, s.name as student_name
        FROM lost_damaged_reports ld JOIN books b ON b.id = ld.book_id JOIN students s ON s.id = ld.student_id
        {where} ORDER BY ld.created_at DESC
    """, params).fetchall()
    return jsonify([row_to_dict(r) for r in rows])


@app.route("/api/lost-damaged", methods=["POST"])
@auth_required()
def report_lost_damaged():
    body = request.get_json(force=True) or {}
    db = get_db()
    book = db.execute("SELECT * FROM books WHERE id=?", (body.get("book_id"),)).fetchone()
    student = db.execute("SELECT * FROM students WHERE student_number=?", (body.get("student_number"),)).fetchone()
    if not book or not student:
        return jsonify({"error": "Book or student not found"}), 404
    db.execute(
        "INSERT INTO lost_damaged_reports (book_id, student_id, type, description, status) VALUES (?,?,?,?, 'reported')",
        (book["id"], student["id"], body.get("type", "lost"), body.get("description", "")),
    )
    db.commit()
    return jsonify({"ok": True}), 201


@app.route("/api/lost-damaged/<int:report_id>/resolve", methods=["PUT"])
@auth_required(roles=["admin", "librarian"])
def resolve_lost_damaged(report_id):
    db = get_db()
    db.execute("UPDATE lost_damaged_reports SET status='resolved' WHERE id=?", (report_id,))
    db.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------- inter-branch transfers
BRANCHES = ["Main Campus", "Annex Campus", "Satellite Campus"]


@app.route("/api/branches", methods=["GET"])
def list_branches():
    return jsonify(BRANCHES)


@app.route("/api/transfers", methods=["GET"])
@auth_required(roles=["admin", "librarian"])
def list_transfers():
    db = get_db()
    rows = db.execute("""
        SELECT t.*, b.title as book_title FROM transfers t JOIN books b ON b.id = t.book_id
        ORDER BY t.requested_date DESC
    """).fetchall()
    return jsonify([row_to_dict(r) for r in rows])


@app.route("/api/transfers", methods=["POST"])
@auth_required(roles=["admin", "librarian"])
def request_transfer():
    body = request.get_json(force=True) or {}
    db = get_db()
    book = db.execute("SELECT * FROM books WHERE id=?", (body.get("book_id"),)).fetchone()
    if not book:
        return jsonify({"error": "Book not found"}), 404
    if body.get("from_branch") == body.get("to_branch"):
        return jsonify({"error": "Pick two different branches"}), 400
    db.execute(
        "INSERT INTO transfers (book_id, from_branch, to_branch, quantity, status, requested_date) VALUES (?,?,?,?,'requested',?)",
        (book["id"], body.get("from_branch"), body.get("to_branch"), max(1, int(body.get("quantity", 1))),
         datetime.datetime.utcnow().isoformat()),
    )
    db.commit()
    return jsonify({"ok": True}), 201


@app.route("/api/transfers/<int:transfer_id>/advance", methods=["PUT"])
@auth_required(roles=["admin", "librarian"])
def advance_transfer(transfer_id):
    db = get_db()
    order = ["requested", "in-transit", "completed"]
    row = db.execute("SELECT status FROM transfers WHERE id=?", (transfer_id,)).fetchone()
    if not row:
        return jsonify({"error": "Not found"}), 404
    idx = min(order.index(row["status"]) + 1, len(order) - 1)
    db.execute("UPDATE transfers SET status=? WHERE id=?", (order[idx], transfer_id))
    db.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------- notifications (derived, not stored)
@app.route("/api/notifications", methods=["GET"])
@auth_required(roles=["admin", "librarian"])
def notifications():
    db = get_db()
    now = datetime.datetime.utcnow()
    items = []
    active = db.execute("""
        SELECT l.*, b.title as book_title, s.name as student_name FROM loans l
        JOIN books b ON b.id=l.book_id JOIN students s ON s.id=l.student_id WHERE l.status='active'
    """).fetchall()
    for l in active:
        due = datetime.datetime.fromisoformat(l["due_date"])
        days = (due - now).days
        if days < 0:
            items.append({"type": "overdue", "text": f"{l['student_name']} is {-days} day(s) overdue for \"{l['book_title']}\"."})
        elif days <= 2:
            items.append({"type": "due-soon", "text": f"{l['student_name']}'s copy of \"{l['book_title']}\" is due in {days} day(s)."})
    ready = db.execute("""
        SELECT r.*, b.title as book_title, s.name as student_name FROM reservations r
        JOIN books b ON b.id=r.book_id JOIN students s ON s.id=r.student_id WHERE r.status='ready'
    """).fetchall()
    for r in ready:
        items.append({"type": "ready", "text": f"\"{r['book_title']}\" is ready for pickup for {r['student_name']}."})
    unpaid = db.execute("""
        SELECT l.*, s.name as student_name FROM loans l JOIN students s ON s.id=l.student_id
        WHERE l.fine_amount > 0 AND l.fine_paid = 0
    """).fetchall()
    for l in unpaid:
        items.append({"type": "fine", "text": f"{l['student_name']} has an unpaid fine of \u20b1{l['fine_amount']:.2f}."})
    return jsonify(items)


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
