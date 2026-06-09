"""
Migration script to set default location to Bangalore for all screens
Run with: python -m scripts.set_default_location_bangalore
"""
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pymongo import MongoClient
from app.config.config import Config
from datetime import datetime

# Bangalore default location
BANGALORE_LOCATION = {
    "street": "Bangalore",
    "city": "Bangalore",
    "state": "Karnataka",
    "country": "India",
    "latitude": 12.9716,
    "longitude": 77.5946,
    "address": {
        "full_address": "Bangalore, Karnataka, India"
    }
}


def run_migration():
    """Update all screens to have Bangalore as default location"""

    if not Config.MONGO_CONNECTION_STRING:
        print("Error: MONGO_CONNECTION_STRING is not set")
        return False

    database_name = Config.MONGO_DATABASE_NAME or "mark_ai"

    try:
        client = MongoClient(Config.MONGO_CONNECTION_STRING)
        db = client[database_name]
        print(f"Connected to MongoDB: {database_name}")

        # Count screens before update
        total_screens = db.screens.count_documents({})
        print(f"Total screens in database: {total_screens}")

        # Update all screens with default Bangalore location
        result = db.screens.update_many(
            {},  # Match all documents
            {
                "$set": {
                    "location": BANGALORE_LOCATION,
                    "updated_at": datetime.utcnow()
                }
            }
        )

        print(f"Updated {result.modified_count} screens with Bangalore location")
        print(f"Matched {result.matched_count} screens")

        # Verify the update
        sample_screen = db.screens.find_one({})
        if sample_screen:
            print(f"\nSample screen location after update:")
            print(f"  City: {sample_screen.get('location', {}).get('city')}")
            print(f"  State: {sample_screen.get('location', {}).get('state')}")
            print(f"  Country: {sample_screen.get('location', {}).get('country')}")

        client.close()
        return True

    except Exception as e:
        print(f"Error during migration: {e}")
        return False


if __name__ == "__main__":
    print("=" * 50)
    print("Setting default location to Bangalore for all screens")
    print("=" * 50)

    success = run_migration()

    if success:
        print("\nMigration completed successfully!")
    else:
        print("\nMigration failed!")
        sys.exit(1)
