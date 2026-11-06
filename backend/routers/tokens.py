
from fastapi import APIRouter, Depends, HTTPException, Query

from database import connect_db
from models.schemas import TokenRequest
from utils.helpers import (
    current_user,
    require_staff,
    check_service,
    token_status_for_customer,
    find_free_counter,
)


router = APIRouter()


# Generate a new queue token
@router.post("/tokens")
def create_token(request: TokenRequest, user=Depends(current_user)):

    service = request.service.strip()
    check_service(service)

    with connect_db() as connection:
        connection.execute("BEGIN IMMEDIATE")

        existing = connection.execute(
            """
            SELECT token FROM tokens
            WHERE user_id = ? AND service = ?
              AND status IN ('waiting', 'called')
            ORDER BY id DESC LIMIT 1
            """,
            (user["id"], service),
        ).fetchone()

        if existing is not None:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"You already have active token {existing['token']} for {service}. "
                    "Complete it before joining this service again."
                ),
            )

        cursor = connection.execute(
            "INSERT INTO tokens (user_id, token, service) VALUES (?, ?, ?)",
            (user["id"], "PENDING", service),
        )

        token_id = cursor.lastrowid
        token_label = f"A{token_id:03}"

        connection.execute(
            "UPDATE tokens SET token = ? WHERE id = ?",
            (token_label, token_id),
        )

        return token_status_for_customer(
            connection, token_id, user["id"]
        )


# Get token status for a customer
@router.get("/tokens/{token_id}/status")
def get_token_status(token_id: int, user=Depends(current_user)):

    if user["role"] != "customer":
        raise HTTPException(
            status_code=403,
            detail="Customer access required"
        )

    with connect_db() as connection:
        return token_status_for_customer(
            connection, token_id, user["id"]
        )


# Get active queue for staff
@router.get("/tokens")
def get_tokens(
    service: str = Query(...),
    user=Depends(require_staff)
):

    check_service(service)

    with connect_db() as connection:

        rows = connection.execute(
            """
            SELECT tokens.id, tokens.token, users.name, tokens.service,
                   tokens.status, tokens.counter_name
            FROM tokens
            JOIN users ON users.id = tokens.user_id
            WHERE tokens.service = ?
              AND tokens.status IN ('waiting', 'called')
            ORDER BY tokens.id
            """,
            (service,),
        ).fetchall()

    return [dict(row) for row in rows]


# Get completed tokens for staff
@router.get("/tokens/completed")
def get_completed_tokens(
    service: str = Query(...),
    user=Depends(require_staff)
):

    check_service(service)

    with connect_db() as connection:

        rows = connection.execute(
            """
            SELECT
                tokens.id,
                tokens.token,
                users.name,
                users.email,
                tokens.service,
                tokens.counter_name,
                tokens.created_at,
                tokens.called_at,
                tokens.completed_at,
                ROUND(
                    (julianday(tokens.called_at) - julianday(tokens.created_at)) * 1440.0,
                    1
                ) AS wait_minutes,
                ROUND(
                    (julianday(tokens.completed_at) - julianday(tokens.called_at)) * 1440.0,
                    1
                ) AS service_minutes
            FROM tokens
            JOIN users ON users.id = tokens.user_id
            WHERE tokens.service = ? AND tokens.status = 'completed'
            ORDER BY tokens.completed_at DESC, tokens.id DESC
            """,
            (service,),
        ).fetchall()

    return [dict(row) for row in rows]


# Call the next waiting customer
@router.post("/tokens/call-next")
def call_next_token(
    service: str = Query(...),
    user=Depends(require_staff)
):

    check_service(service)

    with connect_db() as connection:

        waiting = connection.execute(
            """
            SELECT id, token FROM tokens
            WHERE service = ? AND status = 'waiting'
            ORDER BY id LIMIT 1
            """,
            (service,),
        ).fetchone()

        if waiting is None:
            raise HTTPException(
                status_code=404,
                detail=f"No waiting customers in {service}"
            )

        free_counter = find_free_counter(connection, service)

        if free_counter is None:
            raise HTTPException(
                status_code=409,
                detail=f"All {service} counters are busy."
            )

        connection.execute(
            """
            UPDATE tokens
            SET status = 'called',
                called_at = CURRENT_TIMESTAMP,
                counter_name = ?
            WHERE id = ? AND status = 'waiting'
            """,
            (free_counter, waiting["id"]),
        )

    return {
        "status": "called",
        "token_id": waiting["id"],
        "token": waiting["token"],
        "service": service,
        "counter": free_counter,
    }


# Complete a currently serving token
@router.post("/tokens/{token_id}/complete")
def complete_token(
    token_id: int,
    user=Depends(require_staff)
):

    assigned_next = None
    counter_state = "working"
    remaining_customers = 0

    with connect_db() as connection:

        connection.execute("BEGIN IMMEDIATE")

        current = connection.execute(
            """
            SELECT id, token, service, counter_name
            FROM tokens
            WHERE id = ? AND status = 'called'
            """,
            (token_id,),
        ).fetchone()

        if current is None:
            raise HTTPException(
                status_code=404,
                detail="Called token not found"
            )

        connection.execute(
            """
            UPDATE tokens
            SET status = 'completed',
                completed_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (token_id,),
        )

        break_row = connection.execute(
            """
            SELECT state, remaining_customers, exempt_token_id
            FROM counter_breaks
            WHERE service = ? AND counter_name = ?
            """,
            (current["service"], current["counter_name"]),
        ).fetchone()

        should_pause = False

        if break_row and break_row["state"] == "break_pending":

            counter_state = "break_pending"
            remaining_customers = break_row["remaining_customers"]

            if break_row["exempt_token_id"] == current["id"]:

                # Existing customer is additional to the two promised visits
                connection.execute(
                    """
                    UPDATE counter_breaks
                    SET exempt_token_id = NULL
                    WHERE service = ? AND counter_name = ?
                    """,
                    (current["service"], current["counter_name"]),
                )

            else:

                remaining_customers = max(0, remaining_customers - 1)

                if remaining_customers == 0:

                    counter_state = "on_break"
                    should_pause = True

                    connection.execute(
                        """
                        UPDATE counter_breaks
                        SET state = 'on_break',
                            remaining_customers = 0,
                            exempt_token_id = NULL
                        WHERE service = ? AND counter_name = ?
                        """,
                        (current["service"], current["counter_name"]),
                    )

                else:

                    connection.execute(
                        """
                        UPDATE counter_breaks
                        SET remaining_customers = ?
                        WHERE service = ? AND counter_name = ?
                        """,
                        (
                            remaining_customers,
                            current["service"],
                            current["counter_name"],
                        ),
                    )

        next_token = None

        if not should_pause:

            next_token = connection.execute(
                """
                SELECT id, token FROM tokens
                WHERE service = ? AND status = 'waiting'
                ORDER BY id LIMIT 1
                """,
                (current["service"],),
            ).fetchone()

        if next_token is not None:

            connection.execute(
                """
                UPDATE tokens
                SET status = 'called',
                    called_at = CURRENT_TIMESTAMP,
                    counter_name = ?
                WHERE id = ? AND status = 'waiting'
                """,
                (current["counter_name"], next_token["id"]),
            )

            assigned_next = {
                "id": next_token["id"],
                "token": next_token["token"],
                "counter": current["counter_name"],
            }

    return {
        "status": "completed",
        "completed_token": current["token"],
        "counter": current["counter_name"],
        "next_token": assigned_next,
        "break_state": counter_state,
        "break_remaining": remaining_customers,
        "counter_on_break": counter_state == "on_break",
    }
# Get completed visits for the signed-in customer
@router.get("/tokens/mine/completed")
def get_customer_history(user=Depends(current_user)):
    if user["role"] != "customer":
        raise HTTPException(
            status_code=403,
            detail="Customer access required",
        )

    with connect_db() as connection:
        rows = connection.execute(
            """
            SELECT id, token, service, status, created_at, completed_at, counter_name
            FROM tokens
            WHERE user_id = ? AND status = 'completed'
            ORDER BY completed_at DESC, id DESC
            """,
            (user["id"],),
        ).fetchall()

    return [dict(row) for row in rows]