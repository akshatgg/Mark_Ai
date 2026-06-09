"""
Media Routes - FastAPI Version
Handles media upload to Google Cloud Storage (GCS)
"""
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Form, Header
from typing import Optional, Annotated
from datetime import datetime
from bson import ObjectId
from pydantic import BaseModel

from app.services.gcs_service import gcs_service
from app.services.auth_service import AuthService
import app.config.db


router = APIRouter(prefix="/api/media", tags=["media"])


# Pydantic Models
class MediaUploadJSON(BaseModel):
    """Model for JSON-based media upload"""
    file: str  # base64 or URL
    media_type: str = "auto"
    folder: Optional[str] = None


class MediaResponse(BaseModel):
    """Media information response"""
    public_id: Optional[str]
    url: str
    resource_type: Optional[str] = None
    format: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None


class MediaUploadResponse(BaseModel):
    """Response for media upload"""
    message: str
    media: MediaResponse


class MediaListItem(BaseModel):
    """Individual media item in list"""
    id: str
    public_id: Optional[str]
    url: Optional[str]
    resource_type: Optional[str]
    format: Optional[str]
    width: Optional[int]
    height: Optional[int]
    created_at: Optional[str]


class MediaListResponse(BaseModel):
    """Response for media list"""
    media: list[MediaListItem]
    count: int


class DeleteResponse(BaseModel):
    """Response for delete operation"""
    message: str


class ErrorResponse(BaseModel):
    """Error response"""
    error: str


# Dependency Functions
def get_db():
    """Get database instance"""
    database = app.config.db.db
    if database is None:
        raise RuntimeError("Database not initialized")
    return database


async def verify_token(authorization: Annotated[Optional[str], Header()] = None) -> dict:
    """
    Verify JWT token from request header

    Args:
        authorization: Authorization header value

    Returns:
        Token payload dictionary

    Raises:
        HTTPException: If authentication fails
    """
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(status_code=401, detail="Authentication required")

    token = authorization.split(' ')[1]
    token_payload = AuthService.verify_jwt_token(token)

    if not token_payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return token_payload


# Helper Functions
def determine_media_type(filename: str) -> str:
    """Determine media type from filename"""
    filename_lower = filename.lower()

    if filename_lower.endswith(('.mp4', '.mov', '.avi', '.webm')):
        return "video"
    elif filename_lower.endswith(('.jpg', '.jpeg', '.png', '.gif', '.webp')):
        return "image"

    return "auto"


# Route Handlers
@router.post('/upload', response_model=MediaUploadResponse, status_code=201)
async def upload_media(
    token_payload: Annotated[dict, Depends(verify_token)],
    file: Optional[UploadFile] = File(None),
    folder: Optional[str] = Form(None),
    json_data: Optional[MediaUploadJSON] = None
):
    """
    Upload media (image/video) to GCS

    Accepts:
    - multipart/form-data with 'file' field
    - JSON with 'file' as base64 or URL

    Returns:
    - GCS URL and public_id
    """
    try:
        print("\n" + "="*60)
        print("[MEDIA UPLOAD] Starting media upload process")
        print("="*60)

        if not gcs_service.is_configured():
            print("[MEDIA UPLOAD] ERROR: GCS not configured")
            raise HTTPException(status_code=500, detail="GCS not configured")

        user_id = token_payload.get('user_id')
        print(f"[MEDIA UPLOAD] User ID: {user_id}")

        default_folder = f"markai/ads/{user_id}"

        # Handle multipart form data (file upload)
        if file:
            print(f"[MEDIA UPLOAD] Processing multipart file upload")
            print(f"[MEDIA UPLOAD] Filename: {file.filename}")
            print(f"[MEDIA UPLOAD] Content Type: {file.content_type}")
            print(f"[MEDIA UPLOAD] File size: {file.size if hasattr(file, 'size') else 'Unknown'}")

            if file.filename == '':
                print("[MEDIA UPLOAD] ERROR: No file selected")
                raise HTTPException(status_code=400, detail="No file selected")

            # Determine media type from filename
            media_type = determine_media_type(file.filename)
            print(f"[MEDIA UPLOAD] Detected media type: {media_type}")

            # Use provided folder or default
            upload_folder = folder if folder else default_folder
            print(f"[MEDIA UPLOAD] Upload folder: {upload_folder}")

            # Upload to GCS
            print("[MEDIA UPLOAD] Uploading to GCS...")
            result = gcs_service.upload_media(
                file=file,
                media_type=media_type,
                folder=upload_folder
            )
            print(f"[MEDIA UPLOAD] GCS upload successful!")
            print(f"[MEDIA UPLOAD] Public ID: {result.get('public_id')}")
            print(f"[MEDIA UPLOAD] URL: {result.get('url')}")

        # Handle JSON data (base64 or URL)
        elif json_data:
            print(f"[MEDIA UPLOAD] Processing JSON data upload")
            print(f"[MEDIA UPLOAD] Media type: {json_data.media_type}")

            if not json_data.file:
                print("[MEDIA UPLOAD] ERROR: No file data provided")
                raise HTTPException(status_code=400, detail="No file data provided")

            upload_folder = json_data.folder if json_data.folder else default_folder
            print(f"[MEDIA UPLOAD] Upload folder: {upload_folder}")

            # Upload to GCS
            print("[MEDIA UPLOAD] Uploading to GCS...")
            result = gcs_service.upload_media(
                file=json_data.file,
                media_type=json_data.media_type,
                folder=upload_folder
            )
            print(f"[MEDIA UPLOAD] GCS upload successful!")
            print(f"[MEDIA UPLOAD] Public ID: {result.get('public_id')}")

        else:
            print("[MEDIA UPLOAD] ERROR: No file provided")
            raise HTTPException(status_code=400, detail="No file provided")

        # Save media reference to database
        print("[MEDIA UPLOAD] Saving media reference to database...")
        database = get_db()
        media_doc = {
            "user_id": user_id,
            "public_id": result.get("public_id"),
            "url": result.get("url"),
            "resource_type": result.get("resource_type"),
            "format": result.get("format"),
            "width": result.get("width"),
            "height": result.get("height"),
            "bytes": result.get("bytes"),
            "duration": result.get("duration"),
            "created_at": datetime.utcnow()
        }
        insert_result = database.media.insert_one(media_doc)
        print(f"[MEDIA UPLOAD] Media saved to database with ID: {insert_result.inserted_id}")

        print("[MEDIA UPLOAD] ✓ Upload completed successfully")
        print("="*60 + "\n")

        return {
            "message": "Media uploaded successfully",
            "media": {
                "public_id": result.get("public_id"),
                "url": result.get("url"),
                "resource_type": result.get("resource_type"),
                "format": result.get("format"),
                "width": result.get("width"),
                "height": result.get("height")
            }
        }

    except HTTPException:
        print("[MEDIA UPLOAD] HTTPException raised")
        raise
    except Exception as e:
        print(f"[MEDIA UPLOAD] ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/upload-for-booking', response_model=MediaUploadResponse, status_code=201)
async def upload_media_for_booking(
    token_payload: Annotated[dict, Depends(verify_token)],
    file: UploadFile = File(...),
    booking_id: Optional[str] = Form(None),
    screen_id: Optional[str] = Form(None)
):
    """
    Upload media for a specific booking

    This endpoint is used when advertiser uploads ad content during booking
    """
    try:
        print("\n" + "="*60)
        print("[BOOKING MEDIA] Starting booking media upload")
        print("="*60)

        if not gcs_service.is_configured():
            print("[BOOKING MEDIA] ERROR: GCS not configured")
            raise HTTPException(status_code=500, detail="GCS not configured")

        user_id = token_payload.get('user_id')
        print(f"[BOOKING MEDIA] User ID: {user_id}")
        print(f"[BOOKING MEDIA] Booking ID: {booking_id or 'pending'}")
        print(f"[BOOKING MEDIA] Screen ID: {screen_id or 'N/A'}")

        if file.filename == '':
            print("[BOOKING MEDIA] ERROR: No file selected")
            raise HTTPException(status_code=400, detail="No file selected")

        print(f"[BOOKING MEDIA] Filename: {file.filename}")
        print(f"[BOOKING MEDIA] Content Type: {file.content_type}")

        # Determine media type
        media_type = determine_media_type(file.filename)
        print(f"[BOOKING MEDIA] Detected media type: {media_type}")

        # Create folder structure
        folder = f"markai/bookings/{booking_id or 'pending'}"
        print(f"[BOOKING MEDIA] Upload folder: {folder}")

        # Upload to GCS
        print("[BOOKING MEDIA] Uploading to GCS...")
        result = gcs_service.upload_media(
            file=file,
            media_type=media_type,
            folder=folder
        )
        print(f"[BOOKING MEDIA] GCS upload successful!")
        print(f"[BOOKING MEDIA] Public ID: {result.get('public_id')}")
        print(f"[BOOKING MEDIA] URL: {result.get('url')}")

        # If booking_id provided, update the booking
        if booking_id:
            print(f"[BOOKING MEDIA] Updating booking document: {booking_id}")
            database = get_db()
            update_result = database.bookings.update_one(
                {"_id": ObjectId(booking_id)},
                {
                    "$set": {
                        "media_url": result.get("url"),
                        "media_type": media_type,
                        "cloudinary_public_id": result.get("public_id"),
                        "updated_at": datetime.utcnow()
                    }
                }
            )
            print(f"[BOOKING MEDIA] Booking updated (matched: {update_result.matched_count}, modified: {update_result.modified_count})")
        else:
            print("[BOOKING MEDIA] No booking ID provided, skipping booking update")

        print("[BOOKING MEDIA] ✓ Booking media upload completed successfully")
        print("="*60 + "\n")

        return {
            "message": "Media uploaded successfully",
            "media": {
                "public_id": result.get("public_id"),
                "url": result.get("url"),
                "media_type": media_type,
                "format": result.get("format"),
                "width": result.get("width"),
                "height": result.get("height"),
                "duration": result.get("duration")
            }
        }

    except HTTPException:
        print("[BOOKING MEDIA] HTTPException raised")
        raise
    except Exception as e:
        print(f"[BOOKING MEDIA] ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete('/{media_id}', response_model=DeleteResponse)
async def delete_media(
    media_id: str,
    token_payload: Annotated[dict, Depends(verify_token)]
):
    """Delete media from GCS"""
    try:
        print("\n" + "="*60)
        print(f"[MEDIA DELETE] Starting media deletion: {media_id}")
        print("="*60)

        database = get_db()
        user_id = token_payload.get("user_id")
        print(f"[MEDIA DELETE] User ID: {user_id}")

        # Get media from database
        print(f"[MEDIA DELETE] Fetching media from database...")
        media = database.media.find_one({"_id": ObjectId(media_id)})
        if not media:
            print(f"[MEDIA DELETE] ERROR: Media not found with ID: {media_id}")
            raise HTTPException(status_code=404, detail="Media not found")

        print(f"[MEDIA DELETE] Media found: {media.get('public_id')}")

        # Check ownership
        if media.get("user_id") != user_id:
            print(f"[MEDIA DELETE] ERROR: Unauthorized deletion attempt by user {user_id}")
            raise HTTPException(status_code=403, detail="Not authorized")

        print("[MEDIA DELETE] Ownership verified")

        # Delete from GCS
        public_id = media.get("public_id")
        resource_type = media.get("resource_type", "image")

        if public_id:
            print(f"[MEDIA DELETE] Deleting from GCS: {public_id} ({resource_type})")
            delete_result = gcs_service.delete_media(public_id, resource_type)
            if delete_result:
                print("[MEDIA DELETE] ✓ Deleted from GCS successfully")
            else:
                print("[MEDIA DELETE] WARNING: GCS deletion returned False")
        else:
            print("[MEDIA DELETE] No public_id found, skipping GCS deletion")

        # Delete from database
        print("[MEDIA DELETE] Deleting from database...")
        db_result = database.media.delete_one({"_id": ObjectId(media_id)})
        print(f"[MEDIA DELETE] Database deletion count: {db_result.deleted_count}")

        print("[MEDIA DELETE] ✓ Media deleted successfully")
        print("="*60 + "\n")

        return {"message": "Media deleted successfully"}

    except HTTPException:
        print("[MEDIA DELETE] HTTPException raised")
        raise
    except Exception as e:
        print(f"[MEDIA DELETE] ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/user', response_model=MediaListResponse)
async def get_user_media(token_payload: Annotated[dict, Depends(verify_token)]):
    """Get all media uploaded by the current user"""
    try:
        print("\n" + "="*60)
        print("[MEDIA LIST] Fetching user media")
        print("="*60)

        database = get_db()
        user_id = token_payload.get('user_id')
        print(f"[MEDIA LIST] User ID: {user_id}")

        print("[MEDIA LIST] Querying database...")
        media_cursor = database.media.find({"user_id": user_id}).sort("created_at", -1)
        media_list = []

        for m in media_cursor:
            media_list.append({
                "id": str(m["_id"]),
                "public_id": m.get("public_id"),
                "url": m.get("url"),
                "resource_type": m.get("resource_type"),
                "format": m.get("format"),
                "width": m.get("width"),
                "height": m.get("height"),
                "created_at": m.get("created_at").isoformat() if m.get("created_at") else None
            })

        print(f"[MEDIA LIST] Found {len(media_list)} media items")
        print("[MEDIA LIST] ✓ Media list retrieved successfully")
        print("="*60 + "\n")

        return {
            "media": media_list,
            "count": len(media_list)
        }

    except Exception as e:
        print(f"[MEDIA LIST] ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
