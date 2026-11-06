
from fastapi import APIRouter, Depends, HTTPException, Query

from database import connect_db

from utils.helpers import (
    require_staff,
    check_service,
    capacity_for,
    counter_names_for,
    active_counter_names,
    break_states_for_service,
)


router = APIRouter()


# Get counters for a particular service
@router.get("/counters")
def get_counters(
    service: str = Query(...),
    user=Depends(require_staff)
):
    check_service(service)

    with connect_db() as connection:
        busy = active_counter_names(connection, service)
        states = break_states_for_service(connection, service)
        names = counter_names_for(service)

        on_break_count = sum(
            1 for value in states.values()
            if value["state"] == "on_break"
        )

    return {
        "service": service,
        "capacity": capacity_for(service),
        "busy": len(busy),
        "on_break": on_break_count,
        "available": capacity_for(service) - len(busy) - on_break_count,
        "counters": [
            {
                "name": name,
                "status": (
                    "busy" if name in busy
                    else "on_break" if states[name]["state"] == "on_break"
                    else "available"
                ),
                "break_state": states[name]["state"],
                "break_remaining": states[name]["remaining_customers"],
            }
            for name in names
        ],
    }


# Get counter summary for all services
@router.get("/counters/all")
def get_all_counters(user=Depends(require_staff)):

    result = []

    with connect_db() as connection:

        for service, capacity in {
            "General": 3,
            "Account Services": 4,
            "Customer Support": 5,
        }.items():

            busy = active_counter_names(connection, service)

            states = break_states_for_service(connection, service)

            on_break_count = sum(
                1 for value in states.values()
                if value["state"] == "on_break"
            )

            result.append(
                {
                    "service": service,
                    "capacity": capacity,
                    "busy": len(busy),
                    "on_break": on_break_count,
                    "available": capacity - len(busy) - on_break_count,
                }
            )

    return result


# Request a counter break
@router.post("/counters/{counter_name}/break")
def request_counter_break(
    counter_name: str,
    service: str = Query(...),
    user=Depends(require_staff),
):

    check_service(service)

    if counter_name not in counter_names_for(service):
        raise HTTPException(
            status_code=404,
            detail="Counter not found in this service"
        )

    next_token = None

    with connect_db() as connection:

        connection.execute("BEGIN IMMEDIATE")

        state = connection.execute(
            """
            SELECT state FROM counter_breaks
            WHERE service = ? AND counter_name = ?
            """,
            (service, counter_name),
        ).fetchone()

        if state and state["state"] in ("break_pending", "on_break"):
            raise HTTPException(
                status_code=409,
                detail=f"{counter_name} already has a break scheduled or in progress"
            )

        current = connection.execute(
            """
            SELECT id FROM tokens
            WHERE service = ? AND counter_name = ? AND status = 'called'
            """,
            (service, counter_name),
        ).fetchone()

        exempt_token_id = current["id"] if current else None

        connection.execute(
            """
            INSERT INTO counter_breaks
            (service, counter_name, state, remaining_customers, exempt_token_id)
            VALUES (?, ?, 'break_pending', 2, ?)
            ON CONFLICT(service, counter_name) DO UPDATE SET
                state = 'break_pending',
                remaining_customers = 2,
                exempt_token_id = excluded.exempt_token_id
            """,
            (service, counter_name, exempt_token_id),
        )

        # If the counter is idle, call the first waiting customer there now
        if current is None:

            waiting = connection.execute(
                """
                SELECT id, token FROM tokens
                WHERE service = ? AND status = 'waiting'
                ORDER BY id LIMIT 1
                """,
                (service,),
            ).fetchone()

            if waiting:

                connection.execute(
                    """
                    UPDATE tokens
                    SET status = 'called',
                        called_at = CURRENT_TIMESTAMP,
                        counter_name = ?
                    WHERE id = ? AND status = 'waiting'
                    """,
                    (counter_name, waiting["id"]),
                )

                next_token = {
                    "id": waiting["id"],
                    "token": waiting["token"],
                    "counter": counter_name,
                }

    return {
        "status": "break_pending",
        "counter": counter_name,
        "remaining_customers": 2,
        "next_token": next_token,
    }


# Resume a counter from break
@router.post("/counters/{counter_name}/resume")
def resume_counter(
    counter_name: str,
    service: str = Query(...),
    user=Depends(require_staff),
):

    check_service(service)

    if counter_name not in counter_names_for(service):
        raise HTTPException(
            status_code=404,
            detail="Counter not found in this service"
        )

    with connect_db() as connection:

        connection.execute(
            """
            INSERT INTO counter_breaks
            (service, counter_name, state, remaining_customers, exempt_token_id)
            VALUES (?, ?, 'working', 0, NULL)
            ON CONFLICT(service, counter_name) DO UPDATE SET
                state = 'working',
                remaining_customers = 0,
                exempt_token_id = NULL
            """,
            (service, counter_name),
        )

    return {
        "status": "working",
        "counter": counter_name
    }
