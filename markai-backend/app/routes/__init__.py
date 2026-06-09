"""
Global Router
Consolidates all API routers into a single import point
"""
from fastapi import APIRouter

# Import all individual routers
from app.routes.auth_routes import router as auth_router
from app.routes.screen_routes import router as screen_router
from app.routes.xibo_routes import router as xibo_router
from app.routes.booking_routes import router as booking_router
from app.routes.media_routes import router as media_router
from app.routes.stats_routes import router as stats_router

# Create a global router that includes all sub-routers
api_router = APIRouter()

# Include all routers (they already have their prefixes defined)
api_router.include_router(auth_router)
api_router.include_router(screen_router)
api_router.include_router(xibo_router)
api_router.include_router(booking_router)
api_router.include_router(media_router)
api_router.include_router(stats_router)

__all__ = ['api_router']
