
import math
from datetime import datetime
from typing import Optional

from fastapi import Depends, Header, HTTPException

from config import (
    COUNTER_CAPACITY,
    COUNTER_PREFIX,
    DEFAULT_SERVICE_MINUTES,
    REPORT_TIMEZONE,
)

from database import connect_db


# Active user sessions
sessions = {}


# Get current authenticated user
def current_user(authorization: Optional[str] = Header(default=None)):

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Please sign in")

    session_key = authorization.removeprefix("Bearer ").strip()

    user = sessions.get(session_key)

    if user is None:
        raise HTTPException(
            status_code=401,
            detail="Session expired. Please sign in again",
        )

    return user


# Check whether user has staff access
def require_staff(user=Depends(current_user)):

    if user["role"] != "staff":
        raise HTTPException(status_code=403, detail="Staff access required")

    return user


# Validate service name
def check_service(service: str):

    if service not in COUNTER_CAPACITY:
        raise HTTPException(status_code=400, detail="Unknown service area")


# Get counter capacity for a service
def capacity_for(service: str):
    return COUNTER_CAPACITY.get(service, 1)


# Generate counter names for a service
def counter_names_for(service: str):

    prefix = COUNTER_PREFIX.get(service, "CTR")

    return [
        f"{prefix}-{number}"
        for number in range(1, capacity_for(service) + 1)
    ]


# Get counters currently serving customers
def active_counter_names(connection, service: str):

    rows = connection.execute(
        """
        SELECT counter_name FROM tokens
        WHERE service = ? AND status = 'called' AND counter_name IS NOT NULL
        """,
        (service,),
    ).fetchall()

    return {row["counter_name"] for row in rows}


# Get break states for all counters in a service
def break_states_for_service(connection, service: str):

    rows = connection.execute(
        """
        SELECT counter_name, state, remaining_customers
        FROM counter_breaks
        WHERE service = ?
        """,
        (service,),
    ).fetchall()

    states = {
        row["counter_name"]: {
            "state": row["state"],
            "remaining_customers": row["remaining_customers"],
        }
        for row in rows
    }

    return {
        name: states.get(
            name,
            {"state": "working", "remaining_customers": 0}
        )
        for name in counter_names_for(service)
    }


# Find an available counter
def find_free_counter(connection, service: str):

    busy = active_counter_names(connection, service)
    states = break_states_for_service(connection, service)

    candidates = [
        name
        for name in counter_names_for(service)
        if name not in busy and states[name]["state"] != "on_break"
    ]

    # Give priority to counters with pending breaks
    candidates.sort(
        key=lambda name: 0 if states[name]["state"] == "break_pending" else 1
    )

    return candidates[0] if candidates else None


# Calculate average service time
def estimate_service_minutes(connection, service: str):

    row = connection.execute(
        """
        SELECT AVG((julianday(completed_at) - julianday(called_at)) * 1440.0) AS avg_minutes
        FROM tokens
        WHERE service = ?
          AND status = 'completed'
          AND called_at IS NOT NULL
          AND completed_at IS NOT NULL
        """,
        (service,),
    ).fetchone()

    if row["avg_minutes"] is not None:
        return max(1, round(row["avg_minutes"]))

    return DEFAULT_SERVICE_MINUTES.get(service, 6)


# Get token status and estimated waiting time for a customer
def token_status_for_customer(connection, token_id: int, user_id: int):

    row = connection.execute(
        """
        SELECT id, user_id, token, service, status, counter_name
        FROM tokens
        WHERE id = ? AND user_id = ?
        """,
        (token_id, user_id),
    ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Token not found")

    service = row["service"]

    average_minutes = estimate_service_minutes(connection, service)

    states = break_states_for_service(connection, service)

    on_break = [
        name
        for name, value in states.items()
        if value["state"] == "on_break"
    ]

    working_capacity = max(
        0,
        capacity_for(service) - len(on_break)
    )

    if row["status"] == "waiting":

        waiting_ahead = connection.execute(
            """
            SELECT COUNT(*) AS count FROM tokens
            WHERE service = ? AND status = 'waiting' AND id < ?
            """,
            (service, token_id),
        ).fetchone()["count"]

        in_service = connection.execute(
            """
            SELECT COUNT(*) AS count
            FROM tokens
            WHERE service = ? AND status = 'called'
            """,
            (service,),
        ).fetchone()["count"]

        people_ahead = waiting_ahead + in_service

        wait_minutes = (
            math.ceil(people_ahead / working_capacity) * average_minutes
            if working_capacity > 0 else None
        )

    else:
        people_ahead = 0
        wait_minutes = 0

    if not on_break:
        service_notice = None

    elif len(on_break) == capacity_for(service):

        service_notice = (
            f"All {service} counters are on break. "
            "Your queue will move when a counter returns."
        )

    else:

        service_notice = (
            f"{', '.join(on_break)} is on break. "
            "Other counters remain open; estimated waits reflect current staffing."
        )

    return {
        "id": row["id"],
        "token": row["token"],
        "service": service,
        "status": row["status"],
        "counter_name": row["counter_name"],
        "people_ahead": people_ahead,
        "estimated_wait_minutes": wait_minutes,
        "average_service_minutes": average_minutes,
        "working_counters": working_capacity,
        "service_notice": service_notice,
    }


# Parse database timestamp
def parse_database_timestamp(value: Optional[str]):

    if not value:
        return None

    try:
        parsed = datetime.fromisoformat(value)

        if parsed.tzinfo is None:
            from datetime import timezone
            parsed = parsed.replace(tzinfo=timezone.utc)

        return parsed

    except (TypeError, ValueError):
        return None


# Generate hourly time labels
def hour_label(hour: int):

    start_hour = hour % 24
    end_hour = (hour + 1) % 24

    start = datetime(
        2000, 1, 1, start_hour
    ).strftime("%I %p").lstrip("0")

    end = datetime(
        2000, 1, 1, end_hour
    ).strftime("%I %p").lstrip("0")

    return f"{start}–{end}"
