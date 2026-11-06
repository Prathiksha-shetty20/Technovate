
import sqlite3
from pathlib import Path

from config import DEMO_STAFF, DEMO_PASSWORD
from utils.security import hash_password


# Database file path
DATABASE_PATH = Path(__file__).with_name("queuepulse.db")


# Database connection
def connect_db():
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


# Initialize database and create required tables
def initialize_database():

    with connect_db() as connection:

        # Users table
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('customer', 'staff')),
                staff_service TEXT,
                counter_name TEXT
            )
            """
        )

        # Tokens table
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                token TEXT NOT NULL UNIQUE,
                service TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'waiting',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                called_at DATETIME,
                completed_at DATETIME,
                counter_name TEXT,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """
        )

        # Counter breaks table
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS counter_breaks (
                service TEXT NOT NULL,
                counter_name TEXT NOT NULL,
                state TEXT NOT NULL DEFAULT 'working',
                remaining_customers INTEGER NOT NULL DEFAULT 0,
                exempt_token_id INTEGER,
                PRIMARY KEY (service, counter_name)
            )
            """
        )

        # Check existing user columns
        user_columns = {
            row["name"]
            for row in connection.execute(
                "PRAGMA table_info(users)"
            ).fetchall()
        }

        # Add missing user columns
        for column in ("staff_service", "counter_name"):
            if column not in user_columns:
                connection.execute(
                    f"ALTER TABLE users ADD COLUMN {column} TEXT"
                )

        # Check existing token columns
        token_columns = {
            row["name"]
            for row in connection.execute(
                "PRAGMA table_info(tokens)"
            ).fetchall()
        }

        # Add missing token columns
    
        for column in ("user_id", "called_at", "completed_at", "counter_name"):
            if column not in token_columns:
                if column == "user_id":
                    connection.execute(
                        "ALTER TABLE tokens ADD COLUMN user_id INTEGER REFERENCES users(id)"
                )
                else:
                    connection.execute(
                        f"ALTER TABLE tokens ADD COLUMN {column} TEXT"
            )

        # Reset staff service and counter assignments
        connection.execute(
            """
            UPDATE users
            SET staff_service = NULL, counter_name = NULL
            WHERE role = 'staff'
            """
        )

        # Initialize demo staff accounts
        for display_name, email in DEMO_STAFF:

            existing = connection.execute(
                "SELECT id FROM users WHERE email = ?",
                (email,),
            ).fetchone()

            if existing is None:

                salt, password_hash = hash_password(DEMO_PASSWORD)

                connection.execute(
                    """
                    INSERT INTO users
                    (name, email, password_salt, password_hash, role)
                    VALUES (?, ?, ?, ?, 'staff')
                    """,
                    (display_name, email, salt, password_hash),
                )

            else:

                connection.execute(
                    "UPDATE users SET role = 'staff' WHERE email = ?",
                    (email,),
                )
