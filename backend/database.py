import sqlite3
from pathlib import Path

DATABASE_PATH = Path(__file__).with_name("queuepulse.db")

SERVICES = {
    "General": {
        "counters": 3,
        "default_service_minutes": 6,
    },
    "Account Services": {
        "counters": 4,
        "default_service_minutes": 8,
    },
    "Customer Support": {
        "counters": 5,
        "default_service_minutes": 5,
    },
}


def connect_db():
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_database():
    with connect_db() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT NOT NULL UNIQUE,
                customer_name TEXT NOT NULL,
                customer_email TEXT NOT NULL,
                service TEXT NOT NULL
                    CHECK(service IN (
                        'General',
                        'Account Services',
                        'Customer Support'
                    )),
                status TEXT NOT NULL DEFAULT 'waiting'
                    CHECK(status IN ('waiting', 'called', 'completed')),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                called_at TEXT,
                completed_at TEXT,
                counter_name TEXT
            )
            """
        )

        connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS
                one_active_token_per_customer_service
            ON tokens(customer_email, service)
            WHERE status IN ('waiting', 'called')
            """
        )