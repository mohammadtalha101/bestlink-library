PRAGMA foreign_keys = ON;

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    role TEXT NOT NULL CHECK(role IN ('admin','librarian')),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_number TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    course TEXT,
    year TEXT,
    section TEXT,
    type TEXT NOT NULL DEFAULT 'student' CHECK(type IN ('student','faculty')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','blocked')),
    reason TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT,
    isbn TEXT,
    publisher TEXT,
    year TEXT,
    ddc TEXT,
    shelf_location TEXT,
    copies_total INTEGER NOT NULL DEFAULT 1,
    copies_available INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_books_ddc ON books(ddc);
CREATE INDEX idx_books_title ON books(title);

CREATE TABLE book_copies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    accession_number TEXT UNIQUE,
    collection TEXT,
    status TEXT NOT NULL DEFAULT 'on_shelf' CHECK(status IN ('on_shelf','borrowed','lost','damaged')),
    remarks TEXT
);
CREATE INDEX idx_copies_book ON book_copies(book_id);

CREATE TABLE loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL REFERENCES books(id),
    student_id INTEGER NOT NULL REFERENCES students(id),
    borrow_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    return_date TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','returned')),
    renewals INTEGER NOT NULL DEFAULT 0,
    fine_amount REAL NOT NULL DEFAULT 0,
    fine_paid INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_loans_student ON loans(student_id);
CREATE INDEX idx_loans_status ON loans(status);

CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL REFERENCES books(id),
    student_id INTEGER NOT NULL REFERENCES students(id),
    reserved_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','ready','cancelled'))
);

CREATE TABLE attendance_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    time_in TEXT NOT NULL,
    time_out TEXT,
    alert TEXT
);
CREATE INDEX idx_attendance_student ON attendance_log(student_id);

CREATE TABLE digital_resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT,
    type TEXT,
    subject TEXT,
    year TEXT,
    size_label TEXT,
    downloads INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE room_bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room TEXT NOT NULL,
    date TEXT NOT NULL,
    slot TEXT NOT NULL,
    purpose TEXT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','cancelled')),
    UNIQUE(room, date, slot, status)
);

CREATE TABLE reference_queries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    question TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','answered')),
    answer TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE lost_damaged_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL REFERENCES books(id),
    student_id INTEGER NOT NULL REFERENCES students(id),
    type TEXT NOT NULL CHECK(type IN ('lost','damaged')),
    description TEXT,
    status TEXT NOT NULL DEFAULT 'reported' CHECK(status IN ('reported','resolved')),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL REFERENCES books(id),
    from_branch TEXT NOT NULL,
    to_branch TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','in-transit','completed')),
    requested_date TEXT NOT NULL
);
