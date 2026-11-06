
import hashlib
import secrets
from typing import Optional


# Hash password using PBKDF2 with SHA-256
def hash_password(password: str, salt: Optional[bytes] = None):
    salt = salt or secrets.token_bytes(16)

    password_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        200_000
    )

    return salt.hex(), password_hash.hex()


# Verify password against stored salt and hash
def verify_password(password: str, salt_hex: str, hash_hex: str):
    _, candidate_hash = hash_password(
        password,
        bytes.fromhex(salt_hex)
    )

    return secrets.compare_digest(candidate_hash, hash_hex)
