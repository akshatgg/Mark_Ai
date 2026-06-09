"""
Migration Script: Cloudinary to Google Cloud Storage (GCS)

This script:
1. Fetches all media records from MongoDB that have Cloudinary URLs
2. Downloads each file from Cloudinary
3. Uploads to Google Cloud Storage
4. Updates the database with new GCS URLs and public_ids

Usage:
    python scripts/migrate_cloudinary_to_gcs.py [--dry-run] [--limit N]

Options:
    --dry-run    : Show what would be migrated without actually doing it
    --limit N    : Limit migration to N records (useful for testing)
"""

import os
import sys
import argparse
import requests
import tempfile
import json
import uuid
from datetime import datetime
from pathlib import Path

# Add parent directory to path to import app modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
from pymongo import MongoClient
from werkzeug.utils import secure_filename
from google.cloud import storage
from google.oauth2 import service_account

# Load environment variables
load_dotenv()


class Config:
    """Configuration from environment"""
    MONGO_CONNECTION_STRING = os.getenv("MONGO_CONNECTION_STRING")
    MONGO_DATABASE_NAME = os.getenv("MONGO_DATABASE_NAME")
    GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME")
    # Resolve service account path relative to project root
    _service_account_path = os.getenv("GCS_SERVICE_ACCOUNT_PATH", "service-account.json")
    if not os.path.isabs(_service_account_path):
        # If relative path, resolve from project root (parent of scripts folder)
        project_root = Path(__file__).parent.parent
        GCS_SERVICE_ACCOUNT_PATH = str(project_root / _service_account_path)
    else:
        GCS_SERVICE_ACCOUNT_PATH = _service_account_path
    GCS_PROJECT_ID = os.getenv("GCS_PROJECT_ID")
    GCS_USE_SIGNED_URLS = os.getenv("GCS_USE_SIGNED_URLS", "false").lower() == "true"
    GCS_SIGNED_URL_EXPIRATION = int(os.getenv("GCS_SIGNED_URL_EXPIRATION", "31536000"))


class SimpleGCSService:
    """Simplified GCS service for migration"""

    def __init__(self):
        self._client = None
        self._configured = False
        self._setup()

    def _setup(self):
        """Setup GCS client"""
        try:
            # Option 1: Load from JSON string in environment variable
            gcs_credentials_json = os.getenv("GCS_CREDENTIALS_JSON")
            if gcs_credentials_json:
                credentials_info = json.loads(gcs_credentials_json)
                credentials = service_account.Credentials.from_service_account_info(credentials_info)
                self._client = storage.Client(
                    credentials=credentials,
                    project=Config.GCS_PROJECT_ID
                )
                print("  OK GCS client created from GCS_CREDENTIALS_JSON environment variable")
                self._configured = True
            # Option 2: Load from file path
            elif Config.GCS_SERVICE_ACCOUNT_PATH and os.path.exists(Config.GCS_SERVICE_ACCOUNT_PATH):
                self._client = storage.Client.from_service_account_json(
                    Config.GCS_SERVICE_ACCOUNT_PATH,
                    project=Config.GCS_PROJECT_ID
                )
                print(f"  OK GCS client created from service account file: {Config.GCS_SERVICE_ACCOUNT_PATH}")
                self._configured = True
            else:
                # Show error - service account file not found
                print("\n" + "="*80)
                print("ERROR: GCS Service Account File Not Found!")
                print("="*80)
                print(f"Looking for file: {Config.GCS_SERVICE_ACCOUNT_PATH}")
                print(f"File exists: {os.path.exists(Config.GCS_SERVICE_ACCOUNT_PATH) if Config.GCS_SERVICE_ACCOUNT_PATH else 'N/A'}")
                print("\nPlease either:")
                print("1. Place your service account JSON file at the path specified in GCS_SERVICE_ACCOUNT_PATH")
                print(f"   Current value: {Config.GCS_SERVICE_ACCOUNT_PATH}")
                print("2. OR set GCS_CREDENTIALS_JSON environment variable with the JSON content")
                print("3. OR run: gcloud auth application-default login")
                print("="*80 + "\n")
                self._configured = False
        except Exception as e:
            print(f"  ERROR: Could not setup GCS client: {e}")
            import traceback
            traceback.print_exc()
            self._configured = False

    def is_configured(self):
        """Check if GCS is configured"""
        return self._configured and bool(Config.GCS_BUCKET_NAME and Config.GCS_PROJECT_ID)

    def upload_from_file(self, file_path, folder, original_filename):
        """Upload file to GCS"""
        if not self.is_configured():
            raise Exception("GCS not configured")

        bucket = self._client.bucket(Config.GCS_BUCKET_NAME)

        # Generate unique filename
        filename = secure_filename(original_filename)
        file_extension = os.path.splitext(filename)[1]
        unique_filename = f"{uuid.uuid4()}{file_extension}"
        blob_path = f"{folder}/{unique_filename}"

        # Upload file
        blob = bucket.blob(blob_path)
        blob.upload_from_filename(file_path)

        # Generate URL
        if Config.GCS_USE_SIGNED_URLS:
            url = blob.generate_signed_url(
                expiration=Config.GCS_SIGNED_URL_EXPIRATION,
                method='GET'
            )
        else:
            url = f"https://storage.googleapis.com/{Config.GCS_BUCKET_NAME}/{blob_path}"

        return {
            "public_id": blob_path,
            "url": url
        }


class CloudinaryToGCSMigration:
    """Handles migration from Cloudinary to GCS"""

    def __init__(self, dry_run=False, limit=None):
        self.dry_run = dry_run
        self.limit = limit
        self.gcs_service = SimpleGCSService()

        # Connect to MongoDB
        self.db = self._connect_to_db()

        # Statistics
        self.stats = {
            'total': 0,
            'migrated': 0,
            'failed': 0,
            'skipped': 0
        }

    def _connect_to_db(self):
        """Connect to MongoDB"""
        client = MongoClient(Config.MONGO_CONNECTION_STRING)
        return client[Config.MONGO_DATABASE_NAME]

    def _is_cloudinary_url(self, url):
        """Check if URL is from Cloudinary"""
        if not url:
            return False
        return 'cloudinary.com' in url or 'res.cloudinary.com' in url

    def _download_file(self, url):
        """Download file from URL to temporary file"""
        try:
            print(f"  Downloading from: {url}")
            response = requests.get(url, stream=True, timeout=60)
            response.raise_for_status()

            # Create temporary file
            suffix = os.path.splitext(url.split('?')[0])[1] or '.bin'
            temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)

            # Write content to temp file
            for chunk in response.iter_content(chunk_size=8192):
                temp_file.write(chunk)

            temp_file.close()
            return temp_file.name

        except Exception as e:
            print(f"  ERROR downloading file: {str(e)}")
            return None

    def _upload_to_gcs(self, temp_file_path, original_url, media_type, user_id):
        """Upload file to GCS"""
        try:
            # Determine folder based on user_id
            folder = f"markai/ads/{user_id}" if user_id else "markai/ads/migrated"

            # Get original filename from URL
            original_filename = os.path.basename(original_url.split('?')[0])

            # Upload to GCS
            print(f"  Uploading to GCS folder: {folder}")
            result = self.gcs_service.upload_from_file(
                file_path=temp_file_path,
                folder=folder,
                original_filename=original_filename
            )

            print(f"  Uploaded successfully to: {result['url']}")
            return result

        except Exception as e:
            print(f"  ERROR uploading to GCS: {str(e)}")
            import traceback
            traceback.print_exc()
            return None

    def _update_database(self, media_id, gcs_result):
        """Update database record with GCS information"""
        try:
            update_data = {
                'url': gcs_result['url'],
                'public_id': gcs_result['public_id'],
                'updated_at': datetime.utcnow(),
                'migrated_to_gcs': True,
                'migration_date': datetime.utcnow()
            }

            result = self.db.media.update_one(
                {'_id': media_id},
                {'$set': update_data}
            )

            return result.modified_count > 0

        except Exception as e:
            print(f"  ERROR updating database: {str(e)}")
            return False

    def migrate_media_record(self, media):
        """Migrate a single media record"""
        media_id = media['_id']
        url = media.get('url', '')
        user_id = media.get('user_id', '')
        resource_type = media.get('resource_type', 'image')

        print(f"\n[{self.stats['total'] + 1}] Migrating media ID: {media_id}")
        print(f"  User ID: {user_id}")
        print(f"  Current URL: {url}")
        print(f"  Resource Type: {resource_type}")

        if not self._is_cloudinary_url(url):
            print(f"  SKIPPED: Not a Cloudinary URL")
            self.stats['skipped'] += 1
            return False

        if self.dry_run:
            print(f"  DRY RUN: Would migrate this file")
            self.stats['migrated'] += 1
            return True

        # Download from Cloudinary
        temp_file = self._download_file(url)
        if not temp_file:
            print(f"  FAILED: Could not download file")
            self.stats['failed'] += 1
            return False

        try:
            # Upload to GCS
            gcs_result = self._upload_to_gcs(temp_file, url, resource_type, user_id)
            if not gcs_result:
                print(f"  FAILED: Could not upload to GCS")
                self.stats['failed'] += 1
                return False

            # Update database
            if self._update_database(media_id, gcs_result):
                print(f"  SUCCESS: Migrated and updated database")
                self.stats['migrated'] += 1
                return True
            else:
                print(f"  FAILED: Could not update database")
                self.stats['failed'] += 1
                return False

        finally:
            # Clean up temp file
            try:
                os.unlink(temp_file)
            except:
                pass

    def migrate_bookings(self):
        """Migrate media URLs in bookings collection"""
        print("\n" + "="*80)
        print("MIGRATING BOOKINGS COLLECTION")
        print("="*80)

        # Find bookings with Cloudinary URLs
        query = {
            '$or': [
                {'media_url': {'$regex': 'cloudinary.com'}},
                {'media_url': {'$regex': 'res.cloudinary.com'}}
            ]
        }

        bookings = list(self.db.bookings.find(query))
        print(f"\nFound {len(bookings)} bookings with Cloudinary URLs")

        if self.limit:
            bookings = bookings[:self.limit]
            print(f"Limited to {len(bookings)} bookings")

        booking_stats = {'migrated': 0, 'failed': 0, 'skipped': 0}

        for booking in bookings:
            booking_id = booking['_id']
            media_url = booking.get('media_url', '')
            media_type = booking.get('media_type', 'image')

            print(f"\nMigrating booking ID: {booking_id}")
            print(f"  Current URL: {media_url}")

            if not self._is_cloudinary_url(media_url):
                print(f"  SKIPPED: Not a Cloudinary URL")
                booking_stats['skipped'] += 1
                continue

            if self.dry_run:
                print(f"  DRY RUN: Would migrate this booking")
                booking_stats['migrated'] += 1
                continue

            # Download from Cloudinary
            temp_file = self._download_file(media_url)
            if not temp_file:
                print(f"  FAILED: Could not download file")
                booking_stats['failed'] += 1
                continue

            try:
                # Upload to GCS
                folder = f"markai/bookings/{booking_id}"
                gcs_result = self._upload_to_gcs(temp_file, media_url, media_type, None)
                if not gcs_result:
                    print(f"  FAILED: Could not upload to GCS")
                    booking_stats['failed'] += 1
                    continue

                # Update booking
                self.db.bookings.update_one(
                    {'_id': booking_id},
                    {
                        '$set': {
                            'media_url': gcs_result['url'],
                            'cloudinary_public_id': gcs_result['public_id'],
                            'updated_at': datetime.utcnow(),
                            'migrated_to_gcs': True
                        }
                    }
                )

                print(f"  SUCCESS: Migrated booking")
                booking_stats['migrated'] += 1

            finally:
                # Clean up temp file
                try:
                    os.unlink(temp_file)
                except:
                    pass

        print(f"\nBookings Migration Complete:")
        print(f"  Migrated: {booking_stats['migrated']}")
        print(f"  Failed: {booking_stats['failed']}")
        print(f"  Skipped: {booking_stats['skipped']}")

    def run(self):
        """Run the migration"""
        print("="*80)
        print("CLOUDINARY TO GCS MIGRATION")
        print("="*80)
        print(f"Mode: {'DRY RUN' if self.dry_run else 'LIVE'}")
        print(f"Limit: {self.limit if self.limit else 'None'}")
        print("="*80)

        # Check GCS configuration
        if not self.gcs_service.is_configured():
            print("\nERROR: GCS is not configured properly!")
            print("Please check your .env file for GCS settings:")
            print("  - GCS_BUCKET_NAME")
            print("  - GCS_PROJECT_ID")
            print("  - GCS_SERVICE_ACCOUNT_PATH or GCS_CREDENTIALS_JSON")
            return False

        print("\nGCS is configured correctly OK")

        # Find all media records with Cloudinary URLs
        query = {
            '$or': [
                {'url': {'$regex': 'cloudinary.com'}},
                {'url': {'$regex': 'res.cloudinary.com'}}
            ]
        }

        media_records = list(self.db.media.find(query))
        self.stats['total'] = len(media_records)

        print(f"\nFound {self.stats['total']} media records with Cloudinary URLs")

        if self.limit:
            media_records = media_records[:self.limit]
            print(f"Limited to {len(media_records)} records")

        if not media_records:
            print("\nNo Cloudinary URLs found in media collection!")
        else:
            # Migrate each record
            for media in media_records:
                try:
                    self.migrate_media_record(media)
                except Exception as e:
                    print(f"  ERROR: Unexpected error: {str(e)}")
                    self.stats['failed'] += 1

        # Also migrate bookings
        self.migrate_bookings()

        # Print summary
        print("\n" + "="*80)
        print("MIGRATION SUMMARY - MEDIA COLLECTION")
        print("="*80)
        print(f"Total Records Found: {self.stats['total']}")
        print(f"Successfully Migrated: {self.stats['migrated']}")
        print(f"Failed: {self.stats['failed']}")
        print(f"Skipped: {self.stats['skipped']}")
        print("="*80)

        return self.stats['failed'] == 0


def main():
    """Main function"""
    parser = argparse.ArgumentParser(
        description='Migrate media files from Cloudinary to Google Cloud Storage'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Run in dry-run mode (no actual changes)'
    )
    parser.add_argument(
        '--limit',
        type=int,
        help='Limit number of records to migrate (useful for testing)'
    )

    args = parser.parse_args()

    # Run migration
    migration = CloudinaryToGCSMigration(
        dry_run=args.dry_run,
        limit=args.limit
    )

    success = migration.run()

    # Exit with appropriate code
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
