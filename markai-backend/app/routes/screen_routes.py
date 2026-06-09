from fastapi import APIRouter, HTTPException, Header, File, UploadFile, Query, Form, Depends
from fastapi.responses import JSONResponse
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from app.services.screen_service import ScreenService
from app.services.gcs_service import GCSService
from app.services.xibo_service import xibo_service
from app.models.screen import Screen
from app.services.auth_service import AuthService
from bson import ObjectId
import app.config.db


router = APIRouter(prefix="/api/screens", tags=["screens"])


# Pydantic Models
class LocationModel(BaseModel):
    street: str
    city: str
    state: Optional[str] = None
    country: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    is_outdoor: Optional[bool] = None
    address: Optional[Dict[str, Any]] = None


class TechnicalDetailsModel(BaseModel):
    width: int
    height: int
    size: str
    orientation: str  # 'landscape' or 'portrait'
    display_type: Optional[str] = None
    resolution: Optional[str] = None


class FrequencyDiscountsModel(BaseModel):
    hourly: Optional[float] = 0
    daily: Optional[float] = 0
    weekly: Optional[float] = 0
    fortnightly: Optional[float] = 0
    monthly: Optional[float] = 0


class PricingModel(BaseModel):
    base_hourly_rate: Optional[float] = None
    frequency_discounts: Optional[FrequencyDiscountsModel] = None
    calculated_rates: Optional[Dict[str, Any]] = None
    price: Optional[float] = None
    unit: Optional[str] = None
    cost_per_play: Optional[float] = None
    currency: Optional[str] = None


class CreateScreenRequest(BaseModel):
    screen_owner_id: str
    screen_name: str
    description: Optional[str] = None
    cafe_name: Optional[str] = None
    screen_images: Optional[List[str]] = []
    location: Optional[LocationModel] = None
    technical_details: Optional[TechnicalDetailsModel] = None
    pricing: Optional[PricingModel] = None
    status: Optional[str] = "active"


class UpdateScreenRequest(BaseModel):
    screen_name: Optional[str] = None
    description: Optional[str] = None
    cafe_name: Optional[str] = None
    screen_images: Optional[List[str]] = None
    location: Optional[LocationModel] = None
    technical_details: Optional[TechnicalDetailsModel] = None
    pricing: Optional[PricingModel] = None
    status: Optional[str] = None
    venue_id: Optional[str] = None
    venue_name: Optional[str] = None
    display: Optional[Dict[str, Any]] = None
    frequency_pricing: Optional[Dict[str, Any]] = None
    campaign_insights: Optional[Dict[str, Any]] = None
    operational_info: Optional[Dict[str, Any]] = None
    media_gallery: Optional[List[Dict[str, Any]]] = None
    listing_metrics: Optional[Dict[str, Any]] = None


class MediaItemRequest(BaseModel):
    type: str
    url: str


class SyncScreenoxRequest(BaseModel):
    screen_owner_id: Optional[str] = "screenox"
    display_group_ids: Optional[List[int]] = None


class AssignOwnerRequest(BaseModel):
    screen_id: str
    screen_owner_id: str


# Dependency for token verification
async def verify_token(
    authorization: Optional[str] = Header(None),
    auth_token: Optional[str] = Header(None)
) -> Optional[Dict[str, Any]]:
    """Verify JWT token from request headers"""
    token = authorization or auth_token
    if token:
        if token.startswith('Bearer '):
            token = token[7:]
        payload = AuthService.verify_jwt_token(token)
        if payload:
            return payload
    return None


# Dependency for authenticated user
async def get_current_user(token_payload: Optional[Dict[str, Any]] = Depends(verify_token)) -> Dict[str, Any]:
    """Get current authenticated user or raise 401"""
    if not token_payload:
        raise HTTPException(status_code=401, detail="Authentication required")
    return token_payload


# Dependency for admin user
async def get_admin_user(current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Verify user is admin or raise 403"""
    user_id = current_user.get('user_id')
    if not is_admin(user_id):
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


def is_admin(user_id: str) -> bool:
    """Check if user is admin"""
    try:
        user = AuthService.get_user_by_id(user_id)
        return user and user.is_admin
    except:
        return False


def calculate_frequency_rates(base_hourly_rate, frequency_discounts):
    """Calculate pricing for all frequencies based on base rate and discounts"""
    multipliers = {
        'hourly': 1,
        'daily': 24,
        'weekly': 168,  # 24 * 7
        'fortnightly': 336,  # 24 * 14
        'monthly': 720  # 24 * 30
    }

    calculated = {}
    for freq, multiplier in multipliers.items():
        discount_percent = frequency_discounts.get(freq, 0)
        price = base_hourly_rate * multiplier * (1 - discount_percent / 100)
        calculated[freq] = {
            'price': round(price, 2),
            'multiplier': multiplier,
            'discount_percent': discount_percent
        }

    return calculated


@router.post('', status_code=201)
async def create_screen(
    data: CreateScreenRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Create a new screen"""
    try:
        # Verify screen_owner_id exists and user is screen owner
        screen_owner = AuthService.get_user_by_id(data.screen_owner_id)
        if not screen_owner:
            raise HTTPException(status_code=404, detail="Screen owner not found")

        if not screen_owner.is_screen_owner:
            raise HTTPException(status_code=400, detail="User is not a screen owner")

        # Validate technical_details orientation if provided
        if data.technical_details:
            if data.technical_details.orientation not in ['landscape', 'portrait']:
                raise HTTPException(
                    status_code=400,
                    detail="technical_details.orientation must be 'landscape' or 'portrait'"
                )

        # Validate pricing
        pricing_dict = None
        if data.pricing:
            pricing_dict = data.pricing.model_dump(exclude_none=True)

            # Check if using new frequency-based pricing or old single-price structure
            if data.pricing.base_hourly_rate is not None:
                # New frequency-based pricing validation
                if data.pricing.base_hourly_rate <= 0:
                    raise HTTPException(
                        status_code=400,
                        detail="pricing.base_hourly_rate must be positive"
                    )

                # Validate frequency_discounts if provided
                if data.pricing.frequency_discounts:
                    discounts = data.pricing.frequency_discounts.model_dump()
                    for key, value in discounts.items():
                        if not (0 <= value <= 100):
                            raise HTTPException(
                                status_code=400,
                                detail=f"Discount for {key} must be between 0-100"
                            )

                    # Auto-calculate rates
                    pricing_dict['calculated_rates'] = calculate_frequency_rates(
                        data.pricing.base_hourly_rate,
                        discounts
                    )
                else:
                    # No discounts provided, use default (all 0%)
                    default_discounts = {
                        'hourly': 0,
                        'daily': 0,
                        'weekly': 0,
                        'fortnightly': 0,
                        'monthly': 0
                    }
                    pricing_dict['frequency_discounts'] = default_discounts
                    pricing_dict['calculated_rates'] = calculate_frequency_rates(
                        data.pricing.base_hourly_rate,
                        default_discounts
                    )
            elif data.pricing.price is not None:
                # Old pricing structure (backward compatibility)
                if not data.pricing.unit:
                    raise HTTPException(
                        status_code=400,
                        detail="pricing.unit is required (e.g., 'per day', 'per week', 'per month')"
                    )

        # Create screen
        screen = Screen(
            screen_owner_id=data.screen_owner_id,
            screen_name=data.screen_name,
            description=data.description,
            screen_images=data.screen_images or [],
            location=data.location.model_dump() if data.location else None,
            technical_details=data.technical_details.model_dump() if data.technical_details else None,
            pricing=pricing_dict,
            status=data.status
        )

        screen = ScreenService.create_screen(screen)

        return {
            "message": "Screen created successfully",
            "screen": screen.to_dict()
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('')
async def get_all_screens(
    limit: int = Query(100, ge=1, le=1000),
    page: int = Query(1, ge=1),
    skip: int = Query(0, ge=0),
    status: Optional[str] = None,
    city: Optional[str] = None,
    search: Optional[str] = Query(None, description="Search by screen name, venue name, location, or street"),
    refresh_status: bool = Query(False)
):
    """Public API: Get all screens from MongoDB (synced from Screenox)"""
    try:
        # If page is provided, calculate skip
        if page > 1:
            skip = (page - 1) * limit

        # Optionally refresh online status from Xibo (quick sync)
        if refresh_status:
            try:
                ScreenService.update_screen_online_status()
            except Exception as e:
                print(f"Status refresh failed: {str(e)}")

        # Get screens from MongoDB
        screens, total_count = ScreenService.get_all_screens(limit=limit, skip=skip, status=status, search=search)

        # Filter by city if provided
        if city:
            city_lower = city.lower()
            city_variations = [city_lower]
            if city_lower == "bangalore":
                city_variations.append("bengaluru")
            elif city_lower == "bengaluru":
                city_variations.append("bangalore")

            filtered_screens = []
            for screen in screens:
                location = screen.location or {}
                screen_city = location.get("city", "").lower()
                screen_address = str(location.get("address", {}).get("full_address", "")).lower()
                screen_name = screen.screen_name.lower()

                search_text = f"{screen_city} {screen_address} {screen_name}"
                if any(variation in search_text for variation in city_variations):
                    filtered_screens.append(screen)

            screens = filtered_screens
            total_count = len(screens)

        # Convert to dict
        screens_data = [screen.to_dict() for screen in screens]

        # Calculate pagination metadata
        total_pages = (total_count + limit - 1) // limit if total_count > 0 else 0
        current_page = (skip // limit) + 1 if skip > 0 else 1

        return {
            "screens": screens_data,
            "pagination": {
                "total": total_count,
                "count": len(screens_data),
                "page": current_page,
                "pages": total_pages,
                "limit": limit,
                "skip": skip,
                "has_next": skip + len(screens_data) < total_count,
                "has_prev": skip > 0
            },
            "source": "mongodb"
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/{screen_id}')
async def get_screen(screen_id: str):
    """Get screen by ID from MongoDB (public, no authentication required)"""
    try:
        screen = None

        # Check if this is a Xibo display ID format (xibo-123)
        if screen_id.startswith('xibo-'):
            try:
                xibo_display_id = int(screen_id.replace('xibo-', ''))
                # Try to find in MongoDB first by xibo_display_id
                screen = ScreenService.get_screen_by_xibo_id(xibo_display_id)
            except ValueError:
                pass

        # If not found by xibo ID, try regular MongoDB ID
        if not screen:
            screen = ScreenService.get_screen_by_id(screen_id)

        if screen:
            # Update online status from Xibo if screen has xibo_display_id
            if screen.xibo_display_id:
                try:
                    display = xibo_service.get_display_by_id(screen.xibo_display_id)
                    # Update online status in response
                    screen_dict = screen.to_dict()
                    screen_dict['online'] = display.get("loggedIn") == 1
                    screen_dict['xibo_sync_data']['logged_in'] = display.get("loggedIn") == 1
                    screen_dict['xibo_sync_data']['last_accessed'] = display.get("lastAccessed")

                    return {
                        "screen": screen_dict,
                        "source": "mongodb"
                    }
                except Exception as e:
                    print(f"Failed to get live status from Xibo: {str(e)}")

            return {
                "screen": screen.to_dict(),
                "source": "mongodb"
            }

        # If still not found and has xibo- prefix, try fetching directly from Xibo (fallback)
        if screen_id.startswith('xibo-'):
            try:
                xibo_display_id = int(screen_id.replace('xibo-', ''))

                # Use enhanced method to get full display details
                display_details = xibo_service.get_display_full_details(xibo_display_id)
                display = display_details.get("raw_data", {})

                # Build screen images array
                screen_images = []
                screenshot_url = display_details.get("screenshot_url")
                if screenshot_url:
                    screen_images.append(screenshot_url)

                # Get pricing from Screenox API
                cost_per_play = display_details.get("cost_per_play", 0) or 0
                impressions_per_play = display_details.get("impressions_per_play", 0) or 0

                plays_per_day = 120
                daily_price = cost_per_play * plays_per_day if cost_per_play else 5000
                weekly_impressions = int(impressions_per_play * 840) if impressions_per_play else 15000

                is_outdoor = display_details.get("is_outdoor", False)

                screen_data = {
                    "_id": f"xibo-{display_details.get('displayId')}",
                    "screen_owner_id": "screenox",
                    "screen_name": display_details.get("display_name", "Unknown Display"),
                    "description": display_details.get("description") or f"Digital display at {display_details.get('display_group', 'venue')}",
                    "screen_images": screen_images,
                    "location": {
                        "street": display_details.get("address") or display_details.get("description", ""),
                        "city": display_details.get("display_group", "Unknown Location"),
                        "country": "India",
                        "latitude": display_details.get("latitude"),
                        "longitude": display_details.get("longitude"),
                        "is_outdoor": is_outdoor,
                        "address": {
                            "full_address": display_details.get("address") or display_details.get("description", "")
                        }
                    },
                    "technical_details": {
                        "width": display_details.get("screen_width", 1920),
                        "height": display_details.get("screen_height", 1080),
                        "size": f"{display_details.get('screen_size', 55)} inch",
                        "display_type": display_details.get("display_type", "LED"),
                        "orientation": display_details.get("orientation", "landscape"),
                        "resolution": f"{display_details.get('screen_width', 1920)}x{display_details.get('screen_height', 1080)}"
                    },
                    "pricing": {
                        "price": daily_price,
                        "cost_per_play": cost_per_play,
                        "currency": "INR",
                        "unit": "per day"
                    },
                    "campaign_insights": {
                        "audience_type": "Outdoor Audience" if is_outdoor else "Indoor Audience",
                        "weekly_footfall": weekly_impressions,
                        "impressions_per_play": impressions_per_play,
                        "average_dwell_min": 5 if is_outdoor else 20
                    },
                    "operational_info": {
                        "operating_hours": "8:00 AM - 10:00 PM",
                        "days_open": "Monday - Sunday"
                    },
                    "xibo_display_id": display_details.get("displayId"),
                    "xibo_display_group_id": display.get("displayGroupId"),
                    "xibo_sync_data": {
                        "licensed": display_details.get("is_licensed", False),
                        "logged_in": display_details.get("is_online", False),
                        "last_accessed": display_details.get("last_accessed")
                    },
                    "status": "active" if display_details.get("is_licensed") else "inactive",
                    "online": display_details.get("is_online", False),
                    "source": "xibo"
                }

                return {
                    "screen": screen_data,
                    "source": "xibo",
                    "real_time": True
                }

            except Exception as xibo_error:
                raise HTTPException(status_code=404, detail=f"Xibo display not found: {str(xibo_error)}")

        # Regular MongoDB screen lookup
        screen = ScreenService.get_screen_by_id(screen_id)
        if not screen:
            raise HTTPException(status_code=404, detail="Screen not found")

        return {
            "screen": screen.to_dict(),
            "source": "mongodb"
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class BatchScreenRequest(BaseModel):
    screen_ids: List[str] = Field(..., description="List of screen IDs to fetch")


@router.post('/batch')
async def get_screens_batch(request: BatchScreenRequest):
    """
    Get multiple screens by IDs in a single request (public, no authentication required)
    This is optimized for fetching multiple screens efficiently for advertisers
    """
    try:
        if not request.screen_ids:
            return {"screens": [], "count": 0}

        screens = []
        for screen_id in request.screen_ids:
            try:
                screen = ScreenService.get_screen_by_id(screen_id)
                if screen:
                    screens.append(screen.to_dict())
            except Exception as e:
                print(f"Error fetching screen {screen_id}: {str(e)}")
                # Continue with other screens even if one fails
                continue

        return {
            "screens": screens,
            "count": len(screens),
            "requested": len(request.screen_ids),
            "source": "mongodb"
        }

    except Exception as e:
        print(f"Error in batch screen fetch: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put('/{screen_id}')
async def update_screen(
    screen_id: str,
    data: UpdateScreenRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Update screen by ID"""
    try:
        screen = ScreenService.get_screen_by_id(screen_id)
        if not screen:
            raise HTTPException(status_code=404, detail="Screen not found")

        # Check if user is screen owner or admin
        user_id = current_user.get('user_id')
        if not is_admin(user_id) and screen.screen_owner_id != user_id:
            raise HTTPException(status_code=403, detail="Unauthorized to update this screen")

        # Validate technical_details if provided
        if data.technical_details:
            if data.technical_details.orientation not in ['landscape', 'portrait']:
                raise HTTPException(
                    status_code=400,
                    detail="technical_details.orientation must be 'landscape' or 'portrait'"
                )

        # Validate pricing if provided
        update_data = {}
        data_dict = data.model_dump(exclude_none=True)

        if 'pricing' in data_dict:
            pricing = data.pricing
            if pricing:
                pricing_dict = pricing.model_dump(exclude_none=True)

                # Check if using new frequency-based pricing or old single-price structure
                if pricing.base_hourly_rate is not None:
                    # New frequency-based pricing validation
                    if pricing.base_hourly_rate <= 0:
                        raise HTTPException(
                            status_code=400,
                            detail="pricing.base_hourly_rate must be positive"
                        )

                    # Validate frequency_discounts if provided
                    if pricing.frequency_discounts:
                        discounts = pricing.frequency_discounts.model_dump()
                        for key, value in discounts.items():
                            if not (0 <= value <= 100):
                                raise HTTPException(
                                    status_code=400,
                                    detail=f"Discount for {key} must be between 0-100"
                                )

                        # Auto-calculate rates
                        pricing_dict['calculated_rates'] = calculate_frequency_rates(
                            pricing.base_hourly_rate,
                            discounts
                        )
                    else:
                        # No discounts provided, use default (all 0%)
                        default_discounts = {
                            'hourly': 0,
                            'daily': 0,
                            'weekly': 0,
                            'fortnightly': 0,
                            'monthly': 0
                        }
                        pricing_dict['frequency_discounts'] = default_discounts
                        pricing_dict['calculated_rates'] = calculate_frequency_rates(
                            pricing.base_hourly_rate,
                            default_discounts
                        )

                    # Update the data with modified pricing
                    data_dict['pricing'] = pricing_dict
                elif pricing.price is not None:
                    # Old pricing structure (backward compatibility)
                    if not pricing.unit:
                        raise HTTPException(
                            status_code=400,
                            detail="pricing.unit is required (e.g., 'per day', 'per week', 'per month')"
                        )

        # Prepare update data
        allowed_fields = [
            'screen_name', 'description', 'cafe_name', 'screen_images', 'location',
            'technical_details', 'pricing', 'status',
            # Legacy fields for backward compatibility
            'venue_id', 'venue_name', 'display', 'frequency_pricing',
            'campaign_insights', 'operational_info', 'media_gallery', 'listing_metrics'
        ]

        for field in allowed_fields:
            if field in data_dict:
                value = data_dict[field]
                # Convert Pydantic models to dicts
                if hasattr(value, 'model_dump'):
                    update_data[field] = value.model_dump()
                else:
                    update_data[field] = value

        if not update_data:
            raise HTTPException(status_code=400, detail="No valid fields to update")

        updated_screen = ScreenService.update_screen(screen_id, update_data)

        if not updated_screen:
            raise HTTPException(status_code=500, detail="Failed to update screen")

        return {
            "message": "Screen updated successfully",
            "screen": updated_screen.to_dict()
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete('/{screen_id}')
async def delete_screen(
    screen_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Delete screen by ID"""
    try:
        screen = ScreenService.get_screen_by_id(screen_id)
        if not screen:
            raise HTTPException(status_code=404, detail="Screen not found")

        # Check if user is screen owner or admin
        user_id = current_user.get('user_id')
        if not is_admin(user_id) and screen.screen_owner_id != user_id:
            raise HTTPException(status_code=403, detail="Unauthorized to delete this screen")

        # Delete media files from GCS if any
        # Delete from screen_images
        if screen.screen_images:
            for image_url in screen.screen_images:
                if image_url:
                    try:
                        GCSService.delete_file(image_url)
                    except Exception as e:
                        print(f"Error deleting image {image_url}: {str(e)}")

        # Delete from media_gallery (legacy)
        if screen.media_gallery:
            for media in screen.media_gallery:
                if media.get('type') == 'image' and media.get('url'):
                    try:
                        GCSService.delete_file(media.get('url'))
                    except Exception as e:
                        print(f"Error deleting media {media.get('url')}: {str(e)}")

        success = ScreenService.delete_screen(screen_id)

        if not success:
            raise HTTPException(status_code=500, detail="Failed to delete screen")

        return {
            "message": "Screen deleted successfully"
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/admin/all')
async def get_all_screens_admin(
    limit: int = Query(100, ge=1, le=1000),
    page: int = Query(1, ge=1),
    skip: int = Query(0, ge=0),
    status: Optional[str] = None,
    has_xibo: Optional[bool] = Query(None, description="Filter screens with xibo_display_id"),
    search: Optional[str] = Query(None, description="Search by screen name, venue name, location, or street"),
    current_user: Dict[str, Any] = Depends(get_admin_user)
):
    """Admin API: Get all screens (from database, not ScreenOX)"""
    try:
        # If page is provided, calculate skip
        if page > 1:
            skip = (page - 1) * limit

        screens, total_count = ScreenService.get_all_screens(limit=limit, skip=skip, status=status, has_xibo=has_xibo, search=search)

        # Calculate pagination metadata
        total_pages = (total_count + limit - 1) // limit if total_count > 0 else 0
        current_page = (skip // limit) + 1 if skip > 0 else 1

        return {
            "screens": [screen.to_dict() for screen in screens],
            "pagination": {
                "total": total_count,
                "count": len(screens),
                "page": current_page,
                "pages": total_pages,
                "limit": limit,
                "skip": skip,
                "has_next": skip + len(screens) < total_count,
                "has_prev": skip > 0
            }
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/owner/{screen_owner_id}')
async def get_screens_by_owner(
    screen_owner_id: str,
    limit: int = Query(10, ge=1, le=100, description="Items per page"),
    skip: int = Query(0, ge=0, description="Number of items to skip"),
    page: int = Query(1, ge=1, description="Page number (alternative to skip)"),
    search: Optional[str] = Query(None, description="Search by screen name, venue name, location, or street"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Get all screens by screen owner ID with pagination metadata"""
    try:
        # Check if user is requesting their own screens or is admin
        user_id = current_user.get('user_id')
        if not is_admin(user_id) and screen_owner_id != user_id:
            raise HTTPException(status_code=403, detail="Unauthorized to view these screens")

        # If page is provided, calculate skip
        if page > 1:
            skip = (page - 1) * limit

        # Get screens with total count
        screens, total_count = ScreenService.get_screens_by_owner(screen_owner_id, limit=limit, skip=skip, search=search)

        # Calculate pagination metadata
        total_pages = (total_count + limit - 1) // limit if limit > 0 else 1  # Ceiling division
        current_page = (skip // limit) + 1 if limit > 0 else 1

        return {
            "screens": [screen.to_dict() for screen in screens],
            "pagination": {
                "total": total_count,
                "count": len(screens),
                "limit": limit,
                "skip": skip,
                "page": current_page,
                "total_pages": total_pages,
                "has_next": skip + limit < total_count,
                "has_prev": skip > 0
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/upload-image')
async def upload_image(
    file: UploadFile = File(...),
    folder: str = Form("screens"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Upload image to Google Cloud Storage"""
    try:
        if not file.filename:
            raise HTTPException(status_code=400, detail="No file selected")

        # Check file extension
        filename = file.filename
        file_extension = filename.rsplit('.', 1)[1].lower() if '.' in filename else ''
        if file_extension not in GCSService.get_allowed_extensions():
            raise HTTPException(
                status_code=400,
                detail=f"Invalid file type. Allowed types: {', '.join(GCSService.get_allowed_extensions())}"
            )

        # Upload to GCS
        file_url = GCSService.upload_file(file, folder=folder)

        if not file_url:
            raise HTTPException(status_code=500, detail="Failed to upload file")

        return {
            "message": "Image uploaded successfully",
            "url": file_url,
            "type": "image"
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/{screen_id}/media')
async def add_media_to_screen(
    screen_id: str,
    data: MediaItemRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Add media item to screen's media gallery"""
    try:
        screen = ScreenService.get_screen_by_id(screen_id)
        if not screen:
            raise HTTPException(status_code=404, detail="Screen not found")

        # Check if user is screen owner or admin
        user_id = current_user.get('user_id')
        if not is_admin(user_id) and screen.screen_owner_id != user_id:
            raise HTTPException(status_code=403, detail="Unauthorized to modify this screen")

        media_item = {
            "type": data.type,
            "url": data.url
        }

        updated_screen = ScreenService.add_media_to_screen(screen_id, media_item)

        if not updated_screen:
            raise HTTPException(status_code=500, detail="Failed to add media to screen")

        return {
            "message": "Media added successfully",
            "screen": updated_screen.to_dict()
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/admin/sync-screenox')
async def sync_screens_from_screenox(
    data: Optional[SyncScreenoxRequest] = None,
    current_user: Dict[str, Any] = Depends(get_admin_user)
):
    """
    Admin API: Sync screens from Screenox CMS to MongoDB.

    Request body (optional):
        - screen_owner_id: Default owner ID for synced screens (default: 'screenox')
        - display_group_ids: List of display group IDs to filter (e.g., [28])

    Example:
        POST /api/screens/admin/sync-screenox
        {"display_group_ids": [28]}
    """
    try:
        # Get optional parameters from request
        screen_owner_id = "screenox"
        display_group_ids = None

        if data:
            screen_owner_id = data.screen_owner_id or "screenox"
            display_group_ids = data.display_group_ids

        # Convert to list of ints if provided
        if display_group_ids:
            if isinstance(display_group_ids, int):
                display_group_ids = [display_group_ids]
            display_group_ids = [int(gid) for gid in display_group_ids]

        # Perform sync (with optional display group filter)
        results = ScreenService.sync_screens_from_screenox(screen_owner_id, display_group_ids)

        return {
            "message": "Sync completed",
            "results": results
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/admin/sync-status')
async def sync_screen_status(current_user: Dict[str, Any] = Depends(get_admin_user)):
    """Admin API: Quick sync - update online status for all screens"""
    try:
        # Perform status sync
        results = ScreenService.update_screen_online_status()

        return {
            "message": "Status sync completed",
            "results": results
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/admin/assign-owner')
async def assign_screen_owner(
    data: AssignOwnerRequest,
    current_user: Dict[str, Any] = Depends(get_admin_user)
):
    """Admin API: Assign a screen owner to a screen"""
    try:
        # Verify screen exists
        screen = ScreenService.get_screen_by_id(data.screen_id)
        if not screen:
            raise HTTPException(status_code=404, detail="Screen not found")

        # Verify new owner exists and is a screen owner
        new_owner = AuthService.get_user_by_id(data.screen_owner_id)
        if not new_owner:
            raise HTTPException(status_code=404, detail="User not found")

        if not new_owner.is_screen_owner:
            raise HTTPException(status_code=400, detail="User is not registered as a screen owner")

        # Update screen owner
        update_data = {"screen_owner_id": data.screen_owner_id}
        updated_screen = ScreenService.update_screen(data.screen_id, update_data)

        if not updated_screen:
            raise HTTPException(status_code=500, detail="Failed to assign screen owner")

        return {
            "message": "Screen owner assigned successfully",
            "screen": updated_screen.to_dict(),
            "new_owner": {
                "user_id": data.screen_owner_id,
                "email": new_owner.email,
                "name": new_owner.full_name
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/admin/screen-owners')
async def get_all_screen_owners(current_user: Dict[str, Any] = Depends(get_admin_user)):
    """Admin API: Get all users who are screen owners"""
    try:
        # Get database instance
        database = app.config.db.db
        if database is None:
            raise RuntimeError("Database not initialized")

        # Find all users who are screen owners
        screen_owners = list(database.users.find({"is_screen_owner": True}))

        # Format response
        owners_list = []
        for owner in screen_owners:
            owners_list.append({
                "user_id": str(owner["_id"]),
                "email": owner.get("email", ""),
                "name": owner.get("name", ""),
                "is_screen_owner": True,
                "is_admin": owner.get("is_admin", False),
                "created_at": owner.get("created_at").isoformat() if owner.get("created_at") else None
            })

        return {
            "screen_owners": owners_list,
            "total": len(owners_list)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/admin/make-screen-owner/{target_user_id}')
async def make_user_screen_owner(
    target_user_id: str,
    current_user: Dict[str, Any] = Depends(get_admin_user)
):
    """Admin API: Promote a user to screen owner role"""
    try:
        # Get database instance
        database = app.config.db.db
        if database is None:
            raise RuntimeError("Database not initialized")

        # Verify target user exists
        target_user = database.users.find_one({"_id": ObjectId(target_user_id)})
        if not target_user:
            raise HTTPException(status_code=404, detail="User not found")

        # Update user to be screen owner
        result = database.users.update_one(
            {"_id": ObjectId(target_user_id)},
            {"$set": {"is_screen_owner": True}}
        )

        if result.modified_count == 0 and not target_user.get("is_screen_owner"):
            raise HTTPException(status_code=500, detail="Failed to update user")

        return {
            "message": "User is now a screen owner",
            "user": {
                "user_id": target_user_id,
                "email": target_user.get("email", ""),
                "name": target_user.get("name", ""),
                "is_screen_owner": True
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/admin/remove-screen-owner/{target_user_id}')
async def remove_screen_owner_role(
    target_user_id: str,
    current_user: Dict[str, Any] = Depends(get_admin_user)
):
    """Admin API: Remove screen owner role from a user"""
    try:
        # Get database instance
        database = app.config.db.db
        if database is None:
            raise RuntimeError("Database not initialized")

        # Verify target user exists
        target_user = database.users.find_one({"_id": ObjectId(target_user_id)})
        if not target_user:
            raise HTTPException(status_code=404, detail="User not found")

        # Update user to remove screen owner role
        result = database.users.update_one(
            {"_id": ObjectId(target_user_id)},
            {"$set": {"is_screen_owner": False}}
        )

        return {
            "message": "Screen owner role removed",
            "user": {
                "user_id": target_user_id,
                "email": target_user.get("email", ""),
                "name": target_user.get("name", ""),
                "is_screen_owner": False
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
