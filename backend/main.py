
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import initialize_database

from routers import auth, tokens, counters, analytics


# Initialize QueuePulse API
app = FastAPI(title="QueuePulse API")


# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# Register API routers
app.include_router(auth.router)
app.include_router(tokens.router)
app.include_router(counters.router)
app.include_router(analytics.router)


# Initialize database when application starts
@app.on_event("startup")
def startup():
    initialize_database()


# Health check endpoint
@app.get("/health")
def health():
    return {"status": "ok"}
