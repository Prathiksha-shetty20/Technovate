
import secrets
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Header

from database import connect_db
from models.schemas import RegisterRequest, LoginRequest
from utils.security import hash_password, verify_password
from utils.helpers import current_user, sessions


router = APIRouter()


# Customer registration
@router.post("/auth/register")
def register(request: RegisterRequest):

    email = request.email.strip().lower()

    if "@" not in email:
        raise HTTPException(
            status_code=400,
            detail="Enter a valid email address"
        )

    salt, password_hash = hash_password(request.password)

    try:
        with connect_db() as connection:

            cursor = connection.execute(
                """
                INSERT INTO users
                (name, email, password_salt, password_hash, role)
                VALUES (?, ?, ?, ?, 'customer')
                """,
                (
                    request.name.strip(),
                    email,
                    salt,
                    password_hash
                ),
            )

            user_id = cursor.lastrowid

    except sqlite3.IntegrityError:

        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists"
        )

    user = {
        "id": user_id,
        "name": request.name.strip(),
        "email": email,
        "role": "customer",
    }

    session_key = secrets.token_urlsafe(32)

    sessions[session_key] = user

    return {
        "token": session_key,
        "user": user
    }


# User login
@router.post("/auth/login")
def login(request: LoginRequest):

    email = request.email.strip().lower()

    with connect_db() as connection:

        row = connection.execute(
            "SELECT * FROM users WHERE email = ?",
            (email,),
        ).fetchone()

    if row is None or not verify_password(
        request.password,
        row["password_salt"],
        row["password_hash"]
    ):

        raise HTTPException(
            status_code=401,
            detail="Email or password is incorrect"
        )

    user = {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "role": row["role"],
    }

    session_key = secrets.token_urlsafe(32)

    sessions[session_key] = user

    return {
        "token": session_key,
        "user": user
    }


# Get currently logged-in user
@router.get("/auth/me")
def get_current_user(user=Depends(current_user)):

    return user


# User logout
@router.post("/auth/logout")
def logout(authorization: str = Header(default=None)):

    if authorization and authorization.startswith("Bearer "):
        sessions.pop(
            authorization.removeprefix("Bearer ").strip(),
            None
        )

    return {"status": "signed out"}
