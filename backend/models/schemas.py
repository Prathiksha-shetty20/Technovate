
from pydantic import BaseModel, Field


# Customer registration request
class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: str
    password: str = Field(min_length=8, max_length=128)


# User login request
class LoginRequest(BaseModel):
    email: str
    password: str


# Queue token generation request
class TokenRequest(BaseModel):
    service: str = Field(min_length=1, max_length=80)
