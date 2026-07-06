"""
FastAPI Main Application
Converted from Flask to FastAPI while maintaining all API routes and URLs
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from datetime import datetime
import socketio

from app.config.config import settings
from app.config.db import init_db, close_db

# Import consolidated API router
from app.routes import api_router

# Create FastAPI app
app = FastAPI(
    title="Mark AI Backend API",
    description="FastAPI backend for Mark AI digital signage platform",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_tags=[
        {"name": "Authentication", "description": "User authentication and management"},
        {"name": "Screens", "description": "Screen management and operations"},
        {"name": "Xibo/ScreenOx", "description": "Xibo CMS integration for digital signage"},
        {"name": "Bookings", "description": "Booking management and payment processing"},
        {"name": "Media", "description": "Media upload and management"},
        {"name": "Statistics", "description": "Analytics and statistics"},
    ]
)

# Socket.IO setup
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins='*',
    logger=True,
    engineio_logger=True
)

# Wrap FastAPI app with Socket.IO
socket_app = socketio.ASGIApp(sio, app)

# Initialize database
@app.on_event("startup")
async def startup_event():
    """Initialize database connection on startup"""
    init_db(app)
    print("Database initialized")
    print("FastAPI server started successfully")

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    close_db()
    print("FastAPI server shutting down...")

# CORS Configuration
allowed_origins = [
    settings.FRONTEND_URL,
    "http://localhost:3000",
    "http://172.30.72.250:3000",
    "https://mississippi-pledge-expanding-moderator.trycloudflare.com",
    "https://mainbackend.mark-ai.tech"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=[
        "Content-Type",
        "Authorization",
        "auth_token",
        "X-Requested-With",
        "Accept",
        "Origin"
    ],
    expose_headers=["Authorization"],
    max_age=3600
)

# Include consolidated API router
# IMPORTANT: Register API routes BEFORE static files to prioritize them
app.include_router(api_router)

# API Routes listing endpoint
@app.get("/api/routes")
async def list_api_routes():
    """
    List all available API routes
    Useful for API discovery and debugging
    """
    routes_info = {
        "total_routes": 0,
        "api_routes": {},
        "documentation": {
            "swagger_ui": "/docs",
            "redoc": "/redoc",
            "openapi_json": "/openapi.json"
        }
    }

    # Group routes by prefix
    for route in app.routes:
        if hasattr(route, 'path') and route.path.startswith('/api/'):
            routes_info["total_routes"] += 1

            # Extract prefix (e.g., /api/auth, /api/screens)
            parts = route.path.split('/')
            if len(parts) >= 3:
                prefix = f"/{parts[1]}/{parts[2]}"  # /api/auth

                if prefix not in routes_info["api_routes"]:
                    routes_info["api_routes"][prefix] = []

                methods = list(route.methods) if hasattr(route, 'methods') else []
                routes_info["api_routes"][prefix].append({
                    "path": route.path,
                    "methods": methods,
                    "name": route.name if hasattr(route, 'name') else None
                })

    # Sort each group's routes
    for prefix in routes_info["api_routes"]:
        routes_info["api_routes"][prefix].sort(key=lambda x: (x['path'], str(x['methods'])))

    return routes_info

# Health check endpoint with service status
@app.get("/health")
async def health_check(request: Request):
    """
    Comprehensive health check endpoint
    Returns status of all services: MongoDB, SMTP, GCS, etc.
    """
    import app.config.db as db_module
    from app.services.gcs_service import GCSService
    import smtplib

    # Get the FastAPI app from request
    fastapi_app = request.app

    health_status = {
        "status": "healthy",
        "framework": "FastAPI",
        "timestamp": datetime.utcnow().isoformat(),
        "services": {},
        "api": {
            "swagger_ui": f"{settings.FRONTEND_URL}/docs" if settings.FRONTEND_URL else "http://localhost:5000/docs",
            "redoc": f"{settings.FRONTEND_URL}/redoc" if settings.FRONTEND_URL else "http://localhost:5000/redoc",
            "total_routes": len([r for r in fastapi_app.routes if hasattr(r, 'path')]),
            "api_routes": len([r for r in fastapi_app.routes if hasattr(r, 'path') and r.path.startswith('/api/')])
        }
    }

    # Check MongoDB
    try:
        if db_module.db is not None:
            # Test MongoDB connection
            db_module.mongo_client.admin.command('ping')
            collections = db_module.db.list_collection_names()
            health_status["services"]["mongodb"] = {
                "status": "connected",
                "database": settings.MONGO_DATABASE_NAME,
                "collections": len(collections),
                "collection_names": collections
            }
        else:
            health_status["services"]["mongodb"] = {
                "status": "not_initialized",
                "error": "Database not initialized"
            }
    except Exception as e:
        health_status["services"]["mongodb"] = {
            "status": "error",
            "error": str(e)
        }
        health_status["status"] = "degraded"

    # Check GCS
    try:
        gcs_configured = GCSService.is_configured()
        health_status["services"]["gcs"] = {
            "status": "configured" if gcs_configured else "not_configured",
            "bucket": settings.GCS_BUCKET_NAME if gcs_configured else None,
            "project": settings.GCS_PROJECT_ID if gcs_configured else None,
            "using_signed_urls": settings.GCS_USE_SIGNED_URLS
        }

        if not gcs_configured:
            health_status["status"] = "degraded"
    except Exception as e:
        health_status["services"]["gcs"] = {
            "status": "error",
            "error": str(e)
        }
        health_status["status"] = "degraded"

    # Check SMTP
    try:
        if settings.SMTP_USERNAME and settings.SMTP_PASSWORD:
            # Quick SMTP connection test (don't send email)
            try:
                server = smtplib.SMTP(settings.SMTP_SERVER, settings.SMTP_PORT, timeout=5)
                server.starttls()
                server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
                server.quit()

                health_status["services"]["smtp"] = {
                    "status": "connected",
                    "server": settings.SMTP_SERVER,
                    "port": settings.SMTP_PORT,
                    "username": settings.SMTP_USERNAME,
                    "from_email": settings.SMTP_FROM_EMAIL
                }
            except smtplib.SMTPAuthenticationError as e:
                health_status["services"]["smtp"] = {
                    "status": "authentication_failed",
                    "server": settings.SMTP_SERVER,
                    "error": "Invalid credentials or App Password needed",
                    "details": str(e)
                }
                health_status["status"] = "degraded"
            except Exception as e:
                health_status["services"]["smtp"] = {
                    "status": "connection_failed",
                    "server": settings.SMTP_SERVER,
                    "error": str(e)
                }
                health_status["status"] = "degraded"
        else:
            health_status["services"]["smtp"] = {
                "status": "not_configured",
                "error": "SMTP credentials not provided"
            }
            health_status["status"] = "degraded"
    except Exception as e:
        health_status["services"]["smtp"] = {
            "status": "error",
            "error": str(e)
        }
        health_status["status"] = "degraded"

    # Check Socket.IO
    health_status["services"]["socketio"] = {
        "status": "enabled",
        "mode": "asgi",
        "cors": "*"
    }

    # Check Razorpay
    health_status["services"]["razorpay"] = {
        "status": "configured" if settings.RAZORPAY_KEY_ID and settings.RAZORPAY_KEY_SECRET else "not_configured",
        "key_id": settings.RAZORPAY_KEY_ID[:10] + "..." if settings.RAZORPAY_KEY_ID else None
    }

    # Check Xibo/ScreenOx
    health_status["services"]["xibo"] = {
        "status": "configured" if settings.XIBO_CLIENT_ID and settings.XIBO_CLIENT_SECRET else "not_configured",
        "url": settings.XIBO_URL
    }

    return health_status

# Mount static files at root to serve CSS, images, etc.
# This must be done AFTER defining all API routes
base_dir = Path(__file__).resolve().parent
public_dir = base_dir / "public"

if public_dir.exists():
    # Mount static files to serve from root (like Flask did)
    # This allows /style.css and /server_running.gif to work
    app.mount("/", StaticFiles(directory=str(public_dir), html=True), name="static")

# Exception handlers
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Global exception handler"""
    return JSONResponse(
        status_code=500,
        content={"error": str(exc), "type": type(exc).__name__}
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:socket_app",
        host="0.0.0.0",
        port=5000,
        reload=False,
        log_level="info"
    )
