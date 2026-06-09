from datetime import datetime
from typing import Optional, List, Dict
from bson import ObjectId


class Screen:
    """Screen model for digital display screens"""
    
    def __init__(
        self,
        screen_owner_id: str,
        screen_name: str,
        description: Optional[str] = None,
        cafe_name: Optional[str] = None,
        screen_images: Optional[List[str]] = None,
        location: Optional[Dict] = None,
        technical_details: Optional[Dict] = None,
        pricing: Optional[Dict] = None,
        # Xibo CMS integration fields
        xibo_display_id: Optional[int] = None,
        xibo_display_group_id: Optional[int] = None,
        xibo_sync_data: Optional[Dict] = None,
        # Legacy fields for backward compatibility
        venue_name: Optional[str] = None,
        venue_id: Optional[str] = None,
        display: Optional[Dict] = None,
        frequency_pricing: Optional[List[Dict]] = None,
        campaign_insights: Optional[Dict] = None,
        operational_info: Optional[Dict] = None,
        media_gallery: Optional[List[Dict]] = None,
        listing_metrics: Optional[Dict] = None,
        status: str = "active",
        _id: Optional[ObjectId] = None,
        created_at: Optional[datetime] = None,
        updated_at: Optional[datetime] = None
    ):
        self._id = _id or ObjectId()
        self.screen_owner_id = screen_owner_id
        self.screen_name = screen_name
        self.description = description
        self.cafe_name = cafe_name
        self.screen_images = screen_images or []
        self.location = location or {}
        self.technical_details = technical_details or {}
        self.pricing = pricing or {}
        # Xibo CMS integration fields
        self.xibo_display_id = xibo_display_id
        self.xibo_display_group_id = xibo_display_group_id
        self.xibo_sync_data = xibo_sync_data or {}
        # Legacy fields
        self.venue_id = venue_id
        self.venue_name = venue_name or screen_name  # Fallback to screen_name
        self.display = display or {}
        self.frequency_pricing = frequency_pricing or []
        self.campaign_insights = campaign_insights or {}
        self.operational_info = operational_info or {}
        self.media_gallery = media_gallery or []
        self.listing_metrics = listing_metrics or {}
        self.status = status
        self.created_at = created_at or datetime.utcnow()
        self.updated_at = updated_at or datetime.utcnow()
    
    def to_dict(self, for_db: bool = False) -> dict:
        """Convert screen to dictionary"""
        if for_db:
            data = {
                "_id": self._id,
                "screen_owner_id": self.screen_owner_id,
                "screen_name": self.screen_name,
                "description": self.description,
                "cafe_name": self.cafe_name,
                "screen_images": self.screen_images,
                "location": self.location,
                "technical_details": self.technical_details,
                "pricing": self.pricing,
                # Xibo CMS integration fields
                "xibo_display_id": self.xibo_display_id,
                "xibo_display_group_id": self.xibo_display_group_id,
                "xibo_sync_data": self.xibo_sync_data,
                # Legacy fields
                "venue_id": self.venue_id,
                "venue_name": self.venue_name,
                "display": self.display,
                "frequency_pricing": self.frequency_pricing,
                "campaign_insights": self.campaign_insights,
                "operational_info": self.operational_info,
                "media_gallery": self.media_gallery,
                "listing_metrics": self.listing_metrics,
                "status": self.status,
                "created_at": self.created_at,
                "updated_at": self.updated_at
            }
        else:
            data = {
                "_id": str(self._id),
                "screen_owner_id": self.screen_owner_id,
                "screen_name": self.screen_name,
                "description": self.description,
                "cafe_name": self.cafe_name,
                "screen_images": self.screen_images,
                "location": self.location,
                "technical_details": self.technical_details,
                "pricing": self.pricing,
                # Xibo CMS integration fields
                "xibo_display_id": self.xibo_display_id,
                "xibo_display_group_id": self.xibo_display_group_id,
                "xibo_sync_data": self.xibo_sync_data,
                # Legacy fields
                "venue_id": self.venue_id,
                "venue_name": self.venue_name,
                "display": self.display,
                "frequency_pricing": self.frequency_pricing,
                "campaign_insights": self.campaign_insights,
                "operational_info": self.operational_info,
                "media_gallery": self.media_gallery,
                "listing_metrics": self.listing_metrics,
                "status": self.status,
                "created_at": self.created_at.isoformat() if self.created_at else None,
                "updated_at": self.updated_at.isoformat() if self.updated_at else None
            }
        return data
    
    @staticmethod
    def from_dict(data: dict) -> 'Screen':
        """Create Screen instance from dictionary"""
        # Handle _id conversion
        screen_id = data.get("_id")
        if screen_id:
            if not isinstance(screen_id, ObjectId):
                try:
                    screen_id = ObjectId(screen_id)
                except:
                    screen_id = None
        else:
            screen_id = None
        
        # Handle datetime conversion
        created_at = data.get("created_at")
        updated_at = data.get("updated_at")
        
        return Screen(
            _id=screen_id,
            screen_owner_id=data.get("screen_owner_id", ""),
            screen_name=data.get("screen_name", data.get("venue_name", "")),  # Fallback to venue_name for backward compatibility
            description=data.get("description"),
            cafe_name=data.get("cafe_name"),
            screen_images=data.get("screen_images", []),
            location=data.get("location", {}),
            technical_details=data.get("technical_details", {}),
            pricing=data.get("pricing", {}),
            # Xibo CMS integration fields
            xibo_display_id=data.get("xibo_display_id"),
            xibo_display_group_id=data.get("xibo_display_group_id"),
            xibo_sync_data=data.get("xibo_sync_data", {}),
            # Legacy fields
            venue_id=data.get("venue_id"),
            venue_name=data.get("venue_name"),
            display=data.get("display", {}),
            frequency_pricing=data.get("frequency_pricing", []),
            campaign_insights=data.get("campaign_insights", {}),
            operational_info=data.get("operational_info", {}),
            media_gallery=data.get("media_gallery", []),
            listing_metrics=data.get("listing_metrics", {}),
            status=data.get("status", "active"),
            created_at=created_at,
            updated_at=updated_at
        )

