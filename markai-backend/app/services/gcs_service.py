import os
import json
import uuid
from typing import Optional, Dict, Any
from datetime import datetime
from werkzeug.utils import secure_filename
from werkzeug.datastructures import FileStorage
from google.cloud import storage
from google.oauth2 import service_account
from app.config.config import settings
from PIL import Image
import io

# Import FastAPI's UploadFile for type checking
try:
    from fastapi import UploadFile
    HAS_FASTAPI = True
except ImportError:
    HAS_FASTAPI = False
    UploadFile = None


class GCSService:
    """Service for Google Cloud Storage operations"""

    _client: Optional[storage.Client] = None
    _configured = False

    @classmethod
    def get_client(cls) -> storage.Client:
        """Get or create GCS client"""
        if cls._client is None:
            # Define required scopes for GCS operations
            SCOPES = [
                'https://www.googleapis.com/auth/devstorage.read_write',
                'https://www.googleapis.com/auth/devstorage.full_control'
            ]

            print("[GCS] Initializing GCS client...")
            print(f"[GCS] Project ID: {settings.GCS_PROJECT_ID}")
            print(f"[GCS] Bucket Name: {settings.GCS_BUCKET_NAME}")

            try:
                # Option 1: Load from JSON string in environment variable
                gcs_credentials_json = os.getenv("GCS_CREDENTIALS_JSON")
                if gcs_credentials_json:
                    print("[GCS] Loading credentials from GCS_CREDENTIALS_JSON environment variable")
                    credentials_info = json.loads(gcs_credentials_json)
                    print(f"[GCS] Service account email: {credentials_info.get('client_email', 'N/A')}")

                    credentials = service_account.Credentials.from_service_account_info(
                        credentials_info,
                        scopes=SCOPES
                    )
                    print(f"[GCS] Credentials scopes: {SCOPES}")

                    cls._client = storage.Client(
                        credentials=credentials,
                        project=settings.GCS_PROJECT_ID
                    )
                    print("[GCS] ✓ GCS client created from env credentials with proper scopes")

                # Option 2: Load from file path
                elif os.path.exists(settings.GCS_SERVICE_ACCOUNT_PATH):
                    print(f"[GCS] Loading credentials from file: {settings.GCS_SERVICE_ACCOUNT_PATH}")

                    # Read and display service account info
                    with open(settings.GCS_SERVICE_ACCOUNT_PATH, 'r') as f:
                        sa_info = json.load(f)
                        print(f"[GCS] Service account email: {sa_info.get('client_email', 'N/A')}")

                    credentials = service_account.Credentials.from_service_account_file(
                        settings.GCS_SERVICE_ACCOUNT_PATH,
                        scopes=SCOPES
                    )
                    print(f"[GCS] Credentials scopes: {SCOPES}")

                    cls._client = storage.Client(
                        credentials=credentials,
                        project=settings.GCS_PROJECT_ID
                    )
                    print("[GCS] ✓ GCS client created from file with proper scopes")

                else:
                    # Option 3: Use default credentials (e.g., on GCP)
                    print("[GCS] No credentials file or env var found")
                    print("[GCS] Using default credentials (Application Default Credentials)")
                    cls._client = storage.Client(project=settings.GCS_PROJECT_ID)
                    print("[GCS] ✓ GCS client created with default credentials")

                cls._configured = True
                print("[GCS] Client initialization complete")

            except Exception as e:
                print(f"[GCS] ERROR during client initialization: {str(e)}")
                import traceback
                traceback.print_exc()
                raise

        return cls._client

    @classmethod
    def is_configured(cls) -> bool:
        """Check if GCS is configured"""
        return bool(settings.GCS_BUCKET_NAME and settings.GCS_PROJECT_ID)

    @staticmethod
    def _extract_file_metadata(file, blob_path: str) -> Dict[str, Any]:
        """Extract metadata from file (supports both Flask FileStorage and FastAPI UploadFile)"""
        metadata = {
            "format": os.path.splitext(blob_path)[1].lstrip('.').lower(),
            "width": None,
            "height": None,
            "duration": None,
            "bytes": None
        }

        try:
            file_type = type(file).__name__
            print(f"[GCS] Extracting metadata for file type: {file_type}")

            # Handle FastAPI UploadFile - check by type name to avoid import issues
            if file_type == 'UploadFile' or (HAS_FASTAPI and UploadFile and isinstance(file, UploadFile)):
                print(f"[GCS] Detected FastAPI UploadFile")
                # UploadFile doesn't support tell(), so we read the file to get size
                file_content = file.file.read()
                metadata["bytes"] = len(file_content)
                file.file.seek(0)  # Reset file pointer

                # Try to get image dimensions
                if metadata["format"] in ['jpg', 'jpeg', 'png', 'gif', 'webp']:
                    try:
                        image = Image.open(io.BytesIO(file_content))
                        metadata["width"] = image.width
                        metadata["height"] = image.height
                    except Exception as e:
                        print(f"Could not extract image dimensions: {e}")

            # Handle Flask FileStorage or file-like objects with .tell()
            elif hasattr(file, 'tell') and hasattr(file, 'seek'):
                print(f"[GCS] Detected file with tell/seek methods")
                file.seek(0, os.SEEK_END)
                metadata["bytes"] = file.tell()
                file.seek(0)

                # Try to get image dimensions
                if metadata["format"] in ['jpg', 'jpeg', 'png', 'gif', 'webp']:
                    try:
                        file.seek(0)
                        image = Image.open(file)
                        metadata["width"] = image.width
                        metadata["height"] = image.height
                        file.seek(0)
                    except Exception as e:
                        print(f"Could not extract image dimensions: {e}")
            else:
                print(f"[GCS] Unknown file type, skipping metadata extraction")

        except Exception as e:
            print(f"Error extracting file metadata: {e}")
            import traceback
            traceback.print_exc()

        return metadata

    @staticmethod
    def upload_file(file, folder: str = "screens") -> Optional[str]:
        """Upload file to Google Cloud Storage

        Args:
            file: File object from request
            folder: Folder path in bucket (default: "screens")

        Returns:
            Public URL of uploaded file or None if failed
        """
        try:
            if not settings.GCS_BUCKET_NAME:
                print("Error: GCS_BUCKET_NAME not configured")
                return None

            client = GCSService.get_client()
            bucket = client.bucket(settings.GCS_BUCKET_NAME)

            print("bucket", bucket)

            # Generate unique filename
            filename = secure_filename(file.filename)
            file_extension = os.path.splitext(filename)[1]
            unique_filename = f"{uuid.uuid4()}{file_extension}"
            blob_path = f"{folder}/{unique_filename}"
            print("blob_path", blob_path)

            # Upload file - handle both Flask and FastAPI
            blob = bucket.blob(blob_path)
            file_type = type(file).__name__
            if file_type == 'UploadFile' or (HAS_FASTAPI and UploadFile and isinstance(file, UploadFile)):
                blob.upload_from_file(file.file, content_type=file.content_type)
            else:
                blob.upload_from_file(file, content_type=file.content_type)

            # For uniform bucket-level access, we can't use blob.make_public()
            # Use signed URLs if configured, otherwise construct public URL
            if settings.GCS_USE_SIGNED_URLS:
                # Generate signed URL (works regardless of bucket access settings)
                url = blob.generate_signed_url(
                    expiration=settings.GCS_SIGNED_URL_EXPIRATION,
                    method='GET'
                )
                print("url", url)
            else:
                url = f"https://storage.googleapis.com/{settings.GCS_BUCKET_NAME}/{blob_path}"

            return url

        except Exception as e:
            print(f"Error uploading file to GCS: {str(e)}")
            import traceback
            traceback.print_exc()
            return None

    @staticmethod
    def upload_image(
        file,
        folder: str = "markai/ads",
        public_id: Optional[str] = None,
        transformation: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """
        Upload an image to GCS (Cloudinary-compatible API)

        Args:
            file: File object or URL or base64 string
            folder: Folder path in GCS bucket
            public_id: Custom public ID for the asset (used as filename)
            transformation: Optional transformations (not implemented for GCS)

        Returns:
            Dict with upload result including url, public_id, etc.
        """
        if not GCSService.is_configured():
            raise Exception("GCS not configured")

        try:
            client = GCSService.get_client()
            bucket = client.bucket(settings.GCS_BUCKET_NAME)

            # Generate filename
            if public_id:
                filename = secure_filename(public_id)
            else:
                original_filename = getattr(file, 'filename', 'image.jpg')
                filename = secure_filename(original_filename)

            file_extension = os.path.splitext(filename)[1] or '.jpg'
            unique_filename = f"{uuid.uuid4()}{file_extension}"
            blob_path = f"{folder}/{unique_filename}"

            # Extract metadata before upload
            metadata = GCSService._extract_file_metadata(file, blob_path)

            # Upload file - handle both Flask FileStorage and FastAPI UploadFile
            blob = bucket.blob(blob_path)
            content_type = getattr(file, 'content_type', f'image/{metadata["format"]}')

            # Check by type name for better compatibility
            file_type = type(file).__name__
            if file_type == 'UploadFile' or (HAS_FASTAPI and UploadFile and isinstance(file, UploadFile)):
                blob.upload_from_file(file.file, content_type=content_type)
            else:
                blob.upload_from_file(file, content_type=content_type)

            # Generate URL
            if settings.GCS_USE_SIGNED_URLS:
                url = blob.generate_signed_url(
                    expiration=settings.GCS_SIGNED_URL_EXPIRATION,
                    method='GET'
                )
            else:
                url = f"https://storage.googleapis.com/{settings.GCS_BUCKET_NAME}/{blob_path}"

            return {
                "public_id": blob_path,
                "url": url,
                "format": metadata["format"],
                "width": metadata["width"],
                "height": metadata["height"],
                "bytes": metadata["bytes"],
                "resource_type": "image",
                "created_at": datetime.utcnow().isoformat()
            }

        except Exception as e:
            print(f"Error uploading image to GCS: {str(e)}")
            raise

    @staticmethod
    def upload_video(
        file,
        folder: str = "markai/ads",
        public_id: Optional[str] = None,
        transformation: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """
        Upload a video to GCS (Cloudinary-compatible API)

        Args:
            file: File object or URL or base64 string
            folder: Folder path in GCS bucket
            public_id: Custom public ID for the asset
            transformation: Optional transformations (not implemented for GCS)

        Returns:
            Dict with upload result including url, public_id, etc.
        """
        if not GCSService.is_configured():
            raise Exception("GCS not configured")

        try:
            client = GCSService.get_client()
            bucket = client.bucket(settings.GCS_BUCKET_NAME)

            # Generate filename
            if public_id:
                filename = secure_filename(public_id)
            else:
                original_filename = getattr(file, 'filename', 'video.mp4')
                filename = secure_filename(original_filename)

            file_extension = os.path.splitext(filename)[1] or '.mp4'
            unique_filename = f"{uuid.uuid4()}{file_extension}"
            blob_path = f"{folder}/{unique_filename}"

            # Extract metadata before upload
            metadata = GCSService._extract_file_metadata(file, blob_path)

            # Upload file - handle both Flask and FastAPI
            blob = bucket.blob(blob_path)
            content_type = getattr(file, 'content_type', f'video/{metadata["format"]}')

            file_type = type(file).__name__
            if file_type == 'UploadFile' or (HAS_FASTAPI and UploadFile and isinstance(file, UploadFile)):
                blob.upload_from_file(file.file, content_type=content_type)
            else:
                blob.upload_from_file(file, content_type=content_type)

            # Generate URL
            if settings.GCS_USE_SIGNED_URLS:
                url = blob.generate_signed_url(
                    expiration=settings.GCS_SIGNED_URL_EXPIRATION,
                    method='GET'
                )
            else:
                url = f"https://storage.googleapis.com/{settings.GCS_BUCKET_NAME}/{blob_path}"

            return {
                "public_id": blob_path,
                "url": url,
                "format": metadata["format"],
                "width": metadata["width"],
                "height": metadata["height"],
                "duration": metadata["duration"],
                "bytes": metadata["bytes"],
                "resource_type": "video",
                "created_at": datetime.utcnow().isoformat()
            }

        except Exception as e:
            print(f"Error uploading video to GCS: {str(e)}")
            raise

    @staticmethod
    def upload_media(
        file,
        media_type: str = "auto",
        folder: str = "markai/ads",
        public_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Upload media (image or video) to GCS (Cloudinary-compatible API)

        Args:
            file: File object or URL or base64 string
            media_type: "image", "video", "raw", or "auto"
            folder: Folder path in GCS bucket
            public_id: Custom public ID for the asset

        Returns:
            Dict with upload result
        """
        if not GCSService.is_configured():
            print("[GCS] ERROR: GCS not configured")
            raise Exception("GCS not configured")

        try:
            print(f"[GCS] Starting upload_media process")
            print(f"[GCS] Media type: {media_type}, Folder: {folder}")

            client = GCSService.get_client()
            bucket = client.bucket(settings.GCS_BUCKET_NAME)
            print(f"[GCS] Using bucket: {settings.GCS_BUCKET_NAME}")

            # Generate filename
            if public_id:
                filename = secure_filename(public_id)
                print(f"[GCS] Using custom public_id: {filename}")
            else:
                original_filename = getattr(file, 'filename', 'file')
                filename = secure_filename(original_filename)
                print(f"[GCS] Using original filename: {filename}")

            file_extension = os.path.splitext(filename)[1]
            if not file_extension:
                file_extension = '.bin'
                print(f"[GCS] No extension found, using default: {file_extension}")

            unique_filename = f"{uuid.uuid4()}{file_extension}"
            blob_path = f"{folder}/{unique_filename}"
            print(f"[GCS] Generated blob path: {blob_path}")

            # Determine resource type
            ext = file_extension.lower()
            if media_type == "auto":
                if ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']:
                    resource_type = "image"
                elif ext in ['.mp4', '.mov', '.avi', '.webm']:
                    resource_type = "video"
                else:
                    resource_type = "raw"
                print(f"[GCS] Auto-detected resource type: {resource_type}")
            else:
                resource_type = media_type
                print(f"[GCS] Using provided resource type: {resource_type}")

            # Extract metadata before upload
            print(f"[GCS] Extracting file metadata...")
            metadata = GCSService._extract_file_metadata(file, blob_path)
            print(f"[GCS] Metadata: format={metadata['format']}, width={metadata['width']}, height={metadata['height']}, bytes={metadata['bytes']}")

            # Upload file - handle both Flask and FastAPI
            blob = bucket.blob(blob_path)
            content_type = getattr(file, 'content_type', 'application/octet-stream')
            print(f"[GCS] Content type: {content_type}")

            file_type = type(file).__name__
            print(f"[GCS] File type: {file_type}")

            print(f"[GCS] Starting blob upload...")
            if file_type == 'UploadFile' or (HAS_FASTAPI and UploadFile and isinstance(file, UploadFile)):
                blob.upload_from_file(file.file, content_type=content_type)
            else:
                blob.upload_from_file(file, content_type=content_type)
            print(f"[GCS] ✓ Blob uploaded successfully")

            # Generate URL
            if settings.GCS_USE_SIGNED_URLS:
                print(f"[GCS] Generating signed URL (expiration: {settings.GCS_SIGNED_URL_EXPIRATION})")
                url = blob.generate_signed_url(
                    expiration=settings.GCS_SIGNED_URL_EXPIRATION,
                    method='GET'
                )
            else:
                url = f"https://storage.googleapis.com/{settings.GCS_BUCKET_NAME}/{blob_path}"
                print(f"[GCS] Generated public URL")

            print(f"[GCS] Final URL: {url[:80]}...")

            result = {
                "public_id": blob_path,
                "url": url,
                "format": metadata["format"],
                "width": metadata["width"],
                "height": metadata["height"],
                "duration": metadata["duration"],
                "bytes": metadata["bytes"],
                "resource_type": resource_type,
                "created_at": datetime.utcnow().isoformat()
            }

            print(f"[GCS] ✓ Upload completed successfully")
            return result

        except Exception as e:
            print(f"[GCS] ERROR uploading media: {str(e)}")
            import traceback
            traceback.print_exc()
            raise

    @staticmethod
    def delete_file(file_url: str) -> bool:
        """Delete file from Google Cloud Storage

        Args:
            file_url: Public URL of the file to delete

        Returns:
            True if deleted, False otherwise
        """
        try:
            if not settings.GCS_BUCKET_NAME:
                return False

            client = GCSService.get_client()
            bucket = client.bucket(settings.GCS_BUCKET_NAME)

            # Extract blob name from URL
            # URL format: https://storage.googleapis.com/bucket-name/path/to/file
            if f"{settings.GCS_BUCKET_NAME}/" in file_url:
                blob_name = file_url.split(f"{settings.GCS_BUCKET_NAME}/")[-1]
            elif f"storage.googleapis.com/{settings.GCS_BUCKET_NAME}/" in file_url:
                blob_name = file_url.split(f"storage.googleapis.com/{settings.GCS_BUCKET_NAME}/")[-1]
            else:
                print(f"Could not extract blob name from URL: {file_url}")
                return False

            blob = bucket.blob(blob_name)
            blob.delete()
            return True

        except Exception as e:
            print(f"Error deleting file from GCS: {str(e)}")
            return False

    @staticmethod
    def delete_media(public_id: str, resource_type: str = "image") -> bool:
        """
        Delete media from GCS (Cloudinary-compatible API)

        Args:
            public_id: The blob path (public ID) of the asset to delete
            resource_type: "image" or "video" (ignored for GCS)

        Returns:
            True if deleted successfully
        """
        if not GCSService.is_configured():
            print("[GCS] ERROR: GCS not configured")
            raise Exception("GCS not configured")

        try:
            print(f"[GCS] Starting delete_media process")
            print(f"[GCS] Public ID: {public_id}")
            print(f"[GCS] Resource type: {resource_type}")

            client = GCSService.get_client()
            bucket = client.bucket(settings.GCS_BUCKET_NAME)
            print(f"[GCS] Using bucket: {settings.GCS_BUCKET_NAME}")

            print(f"[GCS] Deleting blob...")
            blob = bucket.blob(public_id)
            blob.delete()
            print(f"[GCS] ✓ Blob deleted successfully")
            return True

        except Exception as e:
            print(f"[GCS] ERROR deleting media: {str(e)}")
            import traceback
            traceback.print_exc()
            return False

    @staticmethod
    def get_url(
        public_id: str,
        resource_type: str = "image",
        transformation: Optional[Dict] = None
    ) -> str:
        """
        Get URL for a GCS asset (Cloudinary-compatible API)

        Args:
            public_id: The blob path (public ID) of the asset
            resource_type: "image" or "video" (ignored for GCS)
            transformation: Optional transformations (not implemented for GCS)

        Returns:
            URL string
        """
        if settings.GCS_USE_SIGNED_URLS:
            client = GCSService.get_client()
            bucket = client.bucket(settings.GCS_BUCKET_NAME)
            blob = bucket.blob(public_id)
            return blob.generate_signed_url(
                expiration=settings.GCS_SIGNED_URL_EXPIRATION,
                method='GET'
            )
        else:
            return f"https://storage.googleapis.com/{settings.GCS_BUCKET_NAME}/{public_id}"

    @staticmethod
    def get_optimized_url(
        public_id: str,
        width: int = 1920,
        height: int = 1080,
        resource_type: str = "image"
    ) -> str:
        """
        Get optimized URL for display screens (Cloudinary-compatible API)
        Note: GCS doesn't support on-the-fly transformations like Cloudinary
        This method returns the original URL

        Args:
            public_id: The blob path (public ID) of the asset
            width: Target width (not used for GCS)
            height: Target height (not used for GCS)
            resource_type: "image" or "video"

        Returns:
            URL string
        """
        return GCSService.get_url(public_id, resource_type)

    @staticmethod
    def get_allowed_extensions() -> list:
        """Get allowed file extensions for uploads"""
        return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg']


# Singleton instance
gcs_service = GCSService()

