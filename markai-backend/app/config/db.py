"""
FastAPI Database Connection
MongoDB connection management for FastAPI application
"""
from typing import Optional
from pymongo import MongoClient
from pymongo.database import Database
from app.config.config import settings

# Global MongoDB client and database instances
mongo_client: Optional[MongoClient] = None
db: Optional[Database] = None


def init_db(app=None) -> Database:
    """
    Initialize the shared MongoDB client.
    For FastAPI, app parameter is optional (kept for compatibility).

    Returns:
        The connected `Database` instance.

    Raises:
        ValueError: If MONGO_CONNECTION_STRING is not configured
        Exception: If connection fails
    """
    global mongo_client, db

    # Return existing connection if already initialized
    if mongo_client and db:
        if app:
            _register_app_state(app, mongo_client, db)
        return db

    # Validate configuration
    if not settings.MONGO_CONNECTION_STRING:
        raise ValueError("MONGO_CONNECTION_STRING is not set in the environment.")

    database_name = settings.MONGO_DATABASE_NAME or "mark_ai"

    try:
        # Create MongoDB client
        client = MongoClient(settings.MONGO_CONNECTION_STRING)

        # Get database
        database = client[database_name]

        # Test connection
        client.admin.command('ping')

        print(f"MongoDB Connected Successfully: {database_name}")
        print(f"Collections: {database.list_collection_names()}")

    except Exception as exc:
        print(f"MongoDB Connection Failed: {exc}")
        raise

    # Store global instances
    mongo_client = client
    db = database

    # Register with FastAPI app state if provided
    if app:
        _register_app_state(app, mongo_client, db)

    return database


def _register_app_state(app, client: MongoClient, database: Database) -> None:
    """
    Register MongoDB instances on FastAPI app state.

    For FastAPI, we use app.state instead of direct attributes.
    This is accessible in routes via request.app.state.db
    """
    if hasattr(app, 'state'):
        # FastAPI app
        app.state.mongo_client = client
        app.state.mongo_db = database
        app.state.db = database
    else:
        # Flask app (for compatibility during migration)
        app.mongo_client = client  # type: ignore[attr-defined]
        app.mongo_db = database  # type: ignore[attr-defined]
        app.db = database  # type: ignore[attr-defined]


def get_database() -> Database:
    """
    Get the database instance.
    Can be used as a dependency in FastAPI routes.

    Usage:
        from fastapi import Depends
        from app.config.db import get_database

        @router.get("/")
        async def my_route(db: Database = Depends(get_database)):
            users = db.users.find()
    """
    if db is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")
    return db


async def get_db_dependency():
    """
    FastAPI dependency for getting database.
    Async version for FastAPI routes.
    """
    return get_database()


def close_db():
    """Close MongoDB connection"""
    global mongo_client, db
    if mongo_client:
        mongo_client.close()
        print("MongoDB connection closed")
        mongo_client = None
        db = None
