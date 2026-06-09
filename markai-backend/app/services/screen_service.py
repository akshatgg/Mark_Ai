from typing import Optional, List, Dict, Any
from bson import ObjectId
from datetime import datetime
import app.config.db
from app.models.screen import Screen
from app.services.xibo_service import xibo_service


def get_db():
    """Get database instance - FastAPI compatible"""
    # Access the global db from the module (not a local reference)
    return app.config.db.db


class ScreenService:
    """Service for screen CRUD operations"""
    
    @staticmethod
    def create_screen(screen: Screen) -> Screen:
        """Create a new screen in database"""
        database = get_db()
        if database is None:
            raise ValueError("Database not initialized")
        
        screen_dict = screen.to_dict(for_db=True)
        result = database.screens.insert_one(screen_dict)
        screen._id = result.inserted_id
        return screen
    
    @staticmethod
    def get_screen_by_id(screen_id: str) -> Optional[Screen]:
        """Get screen by ID from database"""
        try:
            database = get_db()
            if database is None:
                raise ValueError("Database not initialized")
            screen_data = database.screens.find_one({"_id": ObjectId(screen_id)})
            if screen_data:
                return Screen.from_dict(screen_data)
        except Exception as e:
            print(f"Error getting screen by ID: {str(e)}")
        return None
    
    @staticmethod
    def get_all_screens(limit: int = 100, skip: int = 0, status: Optional[str] = None, has_xibo: Optional[bool] = None, search: Optional[str] = None) -> tuple:
        """Get all screens with optional filtering

        Args:
            limit: Maximum number of screens to return
            skip: Number of screens to skip (for pagination)
            status: Filter by status (e.g., 'active')
            has_xibo: If True, only return screens with xibo_display_id set
            search: Search term to filter screens by name, venue name, location, or street

        Returns:
            tuple: (list of screens, total count)
        """
        try:
            database = get_db()
            if database is None:
                raise ValueError("Database not initialized")

            query = {}
            if status:
                query["status"] = status

            # Add search filter if provided
            if search:
                search_lower = search.lower()
                query["$or"] = [
                    {"screen_name": {"$regex": search_lower, "$options": "i"}},
                    {"venue_name": {"$regex": search_lower, "$options": "i"}},
                    {"cafe_name": {"$regex": search_lower, "$options": "i"}},
                    {"location.city": {"$regex": search_lower, "$options": "i"}},
                    {"location.street": {"$regex": search_lower, "$options": "i"}},
                    {"location.address.full_address": {"$regex": search_lower, "$options": "i"}},
                    {"description": {"$regex": search_lower, "$options": "i"}}
                ]

            # Filter for screens with Xibo display ID (much faster than filtering in Python)
            if has_xibo is True:
                query["xibo_display_id"] = {"$exists": True, "$ne": None}
            elif has_xibo is False:
                query["$or"] = [
                    {"xibo_display_id": {"$exists": False}},
                    {"xibo_display_id": None}
                ]

            # Get total count
            total_count = database.screens.count_documents(query)

            # Get screens
            screens_data = database.screens.find(query).skip(skip).limit(limit)
            screens = [Screen.from_dict(screen) for screen in screens_data]

            return screens, total_count
        except Exception as e:
            print(f"Error getting all screens: {str(e)}")
            return [], 0
    
    @staticmethod
    def get_screens_by_owner(screen_owner_id: str, limit: int = 100, skip: int = 0, search: Optional[str] = None) -> tuple:
        """Get all screens by screen owner ID

        Args:
            screen_owner_id: The screen owner's ID
            limit: Maximum number of screens to return
            skip: Number of screens to skip (for pagination)
            search: Search term to filter screens by name, venue name, location, or street

        Returns:
            tuple: (list of screens, total count)
        """
        try:
            database = get_db()
            if database is None:
                raise ValueError("Database not initialized")

            query = {"screen_owner_id": screen_owner_id}

            # Add search filter if provided
            if search:
                search_lower = search.lower()
                query["$or"] = [
                    {"screen_name": {"$regex": search_lower, "$options": "i"}},
                    {"venue_name": {"$regex": search_lower, "$options": "i"}},
                    {"cafe_name": {"$regex": search_lower, "$options": "i"}},
                    {"location.city": {"$regex": search_lower, "$options": "i"}},
                    {"location.street": {"$regex": search_lower, "$options": "i"}},
                    {"location.address.full_address": {"$regex": search_lower, "$options": "i"}},
                    {"description": {"$regex": search_lower, "$options": "i"}}
                ]
                # Add screen_owner_id to the $or query to maintain owner filter
                query = {
                    "$and": [
                        {"screen_owner_id": screen_owner_id},
                        {
                            "$or": [
                                {"screen_name": {"$regex": search_lower, "$options": "i"}},
                                {"venue_name": {"$regex": search_lower, "$options": "i"}},
                                {"cafe_name": {"$regex": search_lower, "$options": "i"}},
                                {"location.city": {"$regex": search_lower, "$options": "i"}},
                                {"location.street": {"$regex": search_lower, "$options": "i"}},
                                {"location.address.full_address": {"$regex": search_lower, "$options": "i"}},
                                {"description": {"$regex": search_lower, "$options": "i"}}
                            ]
                        }
                    ]
                }

            # Get total count
            total_count = database.screens.count_documents(query)

            # Get screens with pagination
            screens_data = database.screens.find(query).skip(skip).limit(limit)
            screens = [Screen.from_dict(screen) for screen in screens_data]

            return screens, total_count
        except Exception as e:
            print(f"Error getting screens by owner: {str(e)}")
            return [], 0
    
    @staticmethod
    def update_screen(screen_id: str, update_data: dict) -> Optional[Screen]:
        """Update screen by ID"""
        try:
            database = get_db()
            if database is None:
                raise ValueError("Database not initialized")
            
            # Add updated_at timestamp
            update_data["updated_at"] = datetime.utcnow()
            
            result = database.screens.update_one(
                {"_id": ObjectId(screen_id)},
                {"$set": update_data}
            )
            
            if result.modified_count > 0:
                return ScreenService.get_screen_by_id(screen_id)
        except Exception as e:
            print(f"Error updating screen: {str(e)}")
        return None
    
    @staticmethod
    def delete_screen(screen_id: str) -> bool:
        """Delete screen by ID"""
        try:
            database = get_db()
            if database is None:
                raise ValueError("Database not initialized")
            
            result = database.screens.delete_one({"_id": ObjectId(screen_id)})
            return result.deleted_count > 0
        except Exception as e:
            print(f"Error deleting screen: {str(e)}")
            return False
    
    @staticmethod
    def add_media_to_screen(screen_id: str, media_item: dict) -> Optional[Screen]:
        """Add media item to screen's media gallery"""
        try:
            database = get_db()
            if database is None:
                raise ValueError("Database not initialized")

            result = database.screens.update_one(
                {"_id": ObjectId(screen_id)},
                {
                    "$push": {"media_gallery": media_item},
                    "$set": {"updated_at": datetime.utcnow()}
                }
            )

            if result.modified_count > 0:
                return ScreenService.get_screen_by_id(screen_id)
        except Exception as e:
            print(f"Error adding media to screen: {str(e)}")
        return None

    @staticmethod
    def get_screen_by_xibo_id(xibo_display_id: int) -> Optional[Screen]:
        """Get screen by Xibo display ID"""
        try:
            database = get_db()
            if database is None:
                raise ValueError("Database not initialized")

            screen_data = database.screens.find_one({"xibo_display_id": xibo_display_id})
            if screen_data:
                return Screen.from_dict(screen_data)
        except Exception as e:
            print(f"Error getting screen by Xibo ID: {str(e)}")
        return None

    @staticmethod
    def sync_screens_from_screenox(screen_owner_id: str = "screenox", display_group_ids: List[int] = None) -> Dict[str, Any]:
        """
        Sync displays from Screenox API to MongoDB.

        Args:
            screen_owner_id: Default owner ID for synced screens
            display_group_ids: Optional list of display group IDs to filter (e.g., [28])

        Returns:
            dict with sync results (created, updated, failed counts)
        """
        results = {
            "created": 0,
            "updated": 0,
            "failed": 0,
            "total": 0,
            "display_group_ids": display_group_ids,
            "errors": []
        }

        try:
            # Build params for filtering
            params = {}
            if display_group_ids:
                # Screenox API expects displayGroupIds[] format
                # For single group: displayGroupIds[]=28
                # For multiple groups: displayGroupIds[]=28&displayGroupIds[]=29
                # Since Python dicts can't have duplicate keys, we use indexed format
                for i, gid in enumerate(display_group_ids):
                    params[f"displayGroupIds[{i}]"] = gid
                print(f"[SYNC] Fetching displays for displayGroupIds: {display_group_ids}")

            # Fetch displays from Screenox (filtered if display_group_ids provided)
            # Using pagination to get up to 1000 displays
            displays = xibo_service.get_displays(params=params, start=0, length=1000)
            display_groups = xibo_service.get_display_groups()

            # Create group lookup map
            group_map = {g.get("displayGroupId"): g for g in display_groups}

            results["total"] = len(displays)

            for display in displays:
                try:
                    xibo_display_id = display.get("displayId")
                    display_group = group_map.get(display.get("displayGroupId"), {})

                    # Check if screen already exists in MongoDB
                    existing_screen = ScreenService.get_screen_by_xibo_id(xibo_display_id)

                    # Get pricing from Screenox (costPerPlay)
                    cost_per_play = display.get("costPerPlay", 0) or 0
                    impressions_per_play = display.get("impressionsPerPlay", 0) or 0

                    # Calculate pricing
                    plays_per_day = 120  # 10 plays/hour × 12 hours
                    daily_price = cost_per_play * plays_per_day if cost_per_play else 5000

                    # Calculate metrics
                    plays_per_week = plays_per_day * 7
                    weekly_footfall = int(impressions_per_play * plays_per_week) if impressions_per_play else 15000

                    is_outdoor = display.get("isOutdoor") == 1
                    is_online = display.get("loggedIn") == 1
                    is_licensed = display.get("licensed") == 1

                    # Build screen data matching MongoDB model
                    screen_data = {
                        "screen_owner_id": screen_owner_id,
                        "screen_name": display.get("display", "Unknown Display"),
                        "description": display.get("description", "") or f"Digital display at {display_group.get('displayGroup', 'venue')}",
                        "screen_images": [],  # Can be updated later via admin
                        "location": {
                            "street": display.get("address", "") or display.get("description", ""),
                            "city": display_group.get("displayGroup", "Unknown"),
                            "country": "India",
                            "latitude": display.get("latitude"),
                            "longitude": display.get("longitude"),
                            "is_outdoor": is_outdoor,
                            "address": {
                                "full_address": display.get("address", "") or display.get("description", "")
                            }
                        },
                        "technical_details": {
                            "width": display.get("screenWidth", 1920),
                            "height": display.get("screenHeight", 1080),
                            "size": f"{display.get('screenSize', 55)} inch",
                            "orientation": "landscape" if display.get("screenWidth", 1920) > display.get("screenHeight", 1080) else "portrait",
                            "display_type": display.get("displayType", "LED"),
                            "resolution": f"{display.get('screenWidth', 1920)}x{display.get('screenHeight', 1080)}",
                            "mac_address": display.get("macAddress"),
                            "client_address": display.get("clientAddress")
                        },
                        "pricing": {
                            "price": daily_price,
                            "cost_per_play": cost_per_play,
                            "currency": "INR",
                            "unit": "per day"
                        },
                        "xibo_display_id": xibo_display_id,
                        "xibo_display_group_id": display.get("displayGroupId"),
                        "xibo_sync_data": {
                            "licensed": is_licensed,
                            "logged_in": is_online,
                            "last_accessed": display.get("lastAccessed"),
                            "media_inventory_status": display.get("mediaInventoryStatus"),
                            "client_version": display.get("clientVersion"),
                            "cost_per_play": cost_per_play,
                            "impressions_per_play": impressions_per_play,
                            "last_synced": datetime.utcnow().isoformat()
                        },
                        "venue_name": display.get("display", "Unknown Display"),
                        "campaign_insights": {
                            "audience_type": "Outdoor Audience" if is_outdoor else "Indoor Audience",
                            "weekly_footfall": weekly_footfall,
                            "impressions_per_play": impressions_per_play,
                            "average_dwell_min": 5 if is_outdoor else 20
                        },
                        "operational_info": {
                            "operating_hours": "8:00 AM - 10:00 PM",
                            "days_open": "Monday - Sunday",
                            "is_mobile": display.get("isMobile") == 1
                        },
                        "listing_metrics": {
                            "views": 0,
                            "inquiries": 0
                        },
                        "status": "active" if is_licensed else "inactive",
                        "online": is_online
                    }

                    if existing_screen:
                        # Update existing screen (preserve screen_owner_id if already set differently)
                        if existing_screen.screen_owner_id != screen_owner_id:
                            screen_data["screen_owner_id"] = existing_screen.screen_owner_id

                        # Preserve manually set pricing if exists and is different from default
                        if existing_screen.pricing and existing_screen.pricing.get("price", 0) > 0:
                            # Only update xibo_sync_data, keep manual pricing
                            existing_pricing = existing_screen.pricing
                            if existing_pricing.get("manually_set"):
                                screen_data["pricing"] = existing_pricing

                        # Preserve screen_images if they exist
                        if existing_screen.screen_images:
                            screen_data["screen_images"] = existing_screen.screen_images

                        ScreenService.update_screen(str(existing_screen._id), screen_data)
                        results["updated"] += 1
                    else:
                        # Create new screen
                        new_screen = Screen.from_dict(screen_data)
                        ScreenService.create_screen(new_screen)
                        results["created"] += 1

                except Exception as e:
                    results["failed"] += 1
                    results["errors"].append(f"Display {display.get('displayId')}: {str(e)}")

        except Exception as e:
            results["errors"].append(f"Sync failed: {str(e)}")

        return results

    @staticmethod
    def update_screen_online_status() -> Dict[str, Any]:
        """
        Update online status for all Xibo screens from Screenox API.
        Quick sync - only updates status, not full data.
        """
        results = {"updated": 0, "errors": []}

        try:
            displays = xibo_service.get_displays()

            for display in displays:
                try:
                    xibo_display_id = display.get("displayId")
                    existing_screen = ScreenService.get_screen_by_xibo_id(xibo_display_id)

                    if existing_screen:
                        update_data = {
                            "online": display.get("loggedIn") == 1,
                            "status": "active" if display.get("licensed") == 1 else "inactive",
                            "xibo_sync_data.logged_in": display.get("loggedIn") == 1,
                            "xibo_sync_data.last_accessed": display.get("lastAccessed"),
                            "xibo_sync_data.last_synced": datetime.utcnow().isoformat()
                        }
                        ScreenService.update_screen(str(existing_screen._id), update_data)
                        results["updated"] += 1
                except Exception as e:
                    results["errors"].append(str(e))

        except Exception as e:
            results["errors"].append(f"Status sync failed: {str(e)}")

        return results

