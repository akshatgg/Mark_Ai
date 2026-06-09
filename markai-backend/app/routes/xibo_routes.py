"""
Xibo CMS API Routes - FastAPI Version
Provides endpoints for interacting with Xibo CMS
"""
from fastapi import APIRouter, Query, Depends, HTTPException, Header
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta
from pydantic import BaseModel, Field
from app.services.xibo_service import xibo_service
from app.services.auth_service import AuthService

router = APIRouter(prefix="/api/xibo", tags=["xibo"])


# ============ PYDANTIC MODELS ============

class CampaignCreate(BaseModel):
    name: str
    folderId: Optional[int] = None
    cyclePlaybackEnabled: Optional[bool] = None
    playCount: Optional[int] = None


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    folderId: Optional[int] = None
    cyclePlaybackEnabled: Optional[bool] = None
    playCount: Optional[int] = None


class AssignLayout(BaseModel):
    layoutId: int
    displayOrder: int = 1


class ScheduleCreate(BaseModel):
    eventTypeId: int
    displayGroupIds: str
    fromDt: str
    toDt: str
    campaignId: Optional[int] = None
    layoutId: Optional[int] = None
    isPriority: Optional[bool] = None
    displayOrder: Optional[int] = None
    dayPartId: Optional[int] = None


# ============ DEPENDENCIES ============

async def verify_token(
    authorization: Optional[str] = Header(None),
    auth_token: Optional[str] = Header(None)
) -> Dict[str, Any]:
    """Verify JWT token from request headers"""
    token = authorization or auth_token
    if token:
        if token.startswith('Bearer '):
            token = token[7:]
        payload = AuthService.verify_jwt_token(token)
        if payload:
            return payload
    raise HTTPException(status_code=401, detail="Authentication required")


# ============ CONNECTION TEST ============

@router.get("/test")
async def test_connection():
    """Test connection to Xibo CMS"""
    try:
        result = xibo_service.test_connection()
        status_code = 200 if result.get("connected") else 503
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/time")
async def get_cms_time():
    """Get CMS server time"""
    try:
        result = xibo_service.get_cms_time()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ DISPLAY ENDPOINTS ============

@router.get("/displays")
async def get_displays(
    displayId: Optional[str] = Query(None),
    display: Optional[str] = Query(None),
    displayGroupId: Optional[str] = Query(None),
    licensed: Optional[str] = Query(None)
):
    """Get all displays"""
    try:
        params = {}
        if displayId:
            params["displayId"] = displayId
        if display:
            params["display"] = display
        if displayGroupId:
            params["displayGroupId"] = displayGroupId
        if licensed:
            params["licensed"] = licensed

        displays = xibo_service.get_displays(params if params else None)
        return {
            "displays": displays,
            "count": len(displays)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/displays/{display_id}")
async def get_display(display_id: int):
    """Get display by ID"""
    try:
        display = xibo_service.get_display_by_id(display_id)
        return display
    except Exception as e:
        status_code = 404 if "not found" in str(e).lower() else 500
        raise HTTPException(status_code=status_code, detail=str(e))


@router.get("/displays/{display_id}/status")
async def get_display_status(display_id: int):
    """Get display status/health"""
    try:
        status = xibo_service.get_display_status(display_id)
        return status
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/displays/{display_id}/screenshot")
async def request_screenshot(display_id: int, token_payload: dict = Depends(verify_token)):
    """Request screenshot from display (requires authentication)"""
    try:
        result = xibo_service.request_screenshot(display_id)
        return {"message": "Screenshot requested", "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ DISPLAY GROUPS ENDPOINTS ============

@router.get("/display-groups")
async def get_display_groups():
    """Get all display groups"""
    try:
        groups = xibo_service.get_display_groups()
        return {
            "displayGroups": groups,
            "count": len(groups)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ CAMPAIGN ENDPOINTS ============

@router.get("/campaigns")
async def get_campaigns(
    campaignId: Optional[str] = Query(None),
    name: Optional[str] = Query(None)
):
    """Get all campaigns"""
    try:
        params = {}
        if campaignId:
            params["campaignId"] = campaignId
        if name:
            params["name"] = name

        campaigns = xibo_service.get_campaigns(params if params else None)
        return {
            "campaigns": campaigns,
            "count": len(campaigns)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/campaigns/{campaign_id}")
async def get_campaign(campaign_id: int):
    """Get campaign by ID"""
    try:
        campaign = xibo_service.get_campaign_by_id(campaign_id)
        return campaign
    except Exception as e:
        status_code = 404 if "not found" in str(e).lower() else 500
        raise HTTPException(status_code=status_code, detail=str(e))


@router.post("/campaigns", status_code=201)
async def create_campaign(
    campaign_data: CampaignCreate,
    token_payload: dict = Depends(verify_token)
):
    """Create a new campaign (requires authentication)"""
    try:
        campaign = xibo_service.create_campaign(
            name=campaign_data.name,
            folderId=campaign_data.folderId,
            cyclePlaybackEnabled=campaign_data.cyclePlaybackEnabled,
            playCount=campaign_data.playCount
        )
        return campaign
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/campaigns/{campaign_id}")
async def update_campaign(
    campaign_id: int,
    campaign_data: CampaignUpdate,
    token_payload: dict = Depends(verify_token)
):
    """Update a campaign (requires authentication)"""
    try:
        data = campaign_data.dict(exclude_unset=True)
        campaign = xibo_service.update_campaign(campaign_id, **data)
        return campaign
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/campaigns/{campaign_id}")
async def delete_campaign(
    campaign_id: int,
    token_payload: dict = Depends(verify_token)
):
    """Delete a campaign (requires authentication)"""
    try:
        xibo_service.delete_campaign(campaign_id)
        return {"message": "Campaign deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/campaigns/{campaign_id}/assign-layout")
async def assign_layout_to_campaign(
    campaign_id: int,
    layout_data: AssignLayout,
    token_payload: dict = Depends(verify_token)
):
    """Assign a layout to a campaign"""
    try:
        result = xibo_service.assign_layout_to_campaign(
            campaign_id,
            layout_data.layoutId,
            layout_data.displayOrder
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ LAYOUT ENDPOINTS ============

@router.get("/layouts")
async def get_layouts(
    layoutId: Optional[str] = Query(None),
    layout: Optional[str] = Query(None)
):
    """Get all layouts"""
    try:
        params = {}
        if layoutId:
            params["layoutId"] = layoutId
        if layout:
            params["layout"] = layout

        layouts = xibo_service.get_layouts(params if params else None)
        return {
            "layouts": layouts,
            "count": len(layouts)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/layouts/{layout_id}")
async def get_layout(layout_id: int):
    """Get layout by ID"""
    try:
        layout = xibo_service.get_layout_by_id(layout_id)
        return layout
    except Exception as e:
        status_code = 404 if "not found" in str(e).lower() else 500
        raise HTTPException(status_code=status_code, detail=str(e))


# ============ SCHEDULE ENDPOINTS ============

@router.get("/schedules")
async def get_schedules(
    displayGroupIds: Optional[str] = Query(None),
    fromDt: Optional[str] = Query(None),
    toDt: Optional[str] = Query(None)
):
    """Get all schedule events"""
    try:
        params = {}
        if displayGroupIds:
            params["displayGroupIds"] = displayGroupIds
        if fromDt:
            params["fromDt"] = fromDt
        if toDt:
            params["toDt"] = toDt

        schedules = xibo_service.get_schedules(params if params else None)
        return {
            "schedules": schedules,
            "count": len(schedules)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/schedules/display/{display_group_id}")
async def get_schedule_by_display(
    display_group_id: int,
    fromDt: Optional[str] = Query(None),
    toDt: Optional[str] = Query(None)
):
    """Get schedules for a specific display group"""
    try:
        schedules = xibo_service.get_schedule_by_display(display_group_id, fromDt, toDt)
        return {
            "schedules": schedules,
            "count": len(schedules)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def generate_hourly_slots(from_dt: datetime, to_dt: datetime) -> list:
    """Generate hourly time slots between two dates"""
    slots = []
    current = from_dt.replace(minute=0, second=0, microsecond=0)

    while current < to_dt:
        slot_end = current + timedelta(hours=1)

        slots.append({
            "id": f"{current.isoformat()}-{current.hour}",
            "start": current.isoformat(),
            "end": slot_end.isoformat(),
            "hour": current.hour,
            "label": f"{current.hour}:00 - {slot_end.hour}:00"
        })

        current = slot_end

    return slots


# REMOVED: Slot availability checking endpoint - no longer needed
# @router.get("/schedules/availability")
# async def get_schedule_availability(
#     displayGroupId: int = Query(...),
#     fromDt: str = Query(...),
#     toDt: str = Query(...)
# ):
#     """Get slot availability with capacity information from Screenox"""
#     # This endpoint has been removed as availability checking is no longer required
#     pass


@router.post("/schedules", status_code=201)
async def create_schedule(
    schedule_data: ScheduleCreate,
    token_payload: dict = Depends(verify_token)
):
    """Create a new schedule event (requires authentication)"""
    try:
        schedule = xibo_service.create_schedule(
            event_type_id=schedule_data.eventTypeId,
            display_group_ids=schedule_data.displayGroupIds,
            from_dt=schedule_data.fromDt,
            to_dt=schedule_data.toDt,
            campaign_id=schedule_data.campaignId,
            layout_id=schedule_data.layoutId,
            isPriority=schedule_data.isPriority,
            displayOrder=schedule_data.displayOrder,
            dayPartId=schedule_data.dayPartId
        )
        return schedule
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/schedules/{event_id}")
async def delete_schedule(
    event_id: int,
    token_payload: dict = Depends(verify_token)
):
    """Delete a schedule event (requires authentication)"""
    try:
        xibo_service.delete_schedule(event_id)
        return {"message": "Schedule event deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ STATISTICS ENDPOINTS ============

@router.get("/stats")
async def get_stats(
    fromDt: Optional[str] = Query(None),
    toDt: Optional[str] = Query(None),
    displayId: Optional[int] = Query(None),
    layoutId: Optional[int] = Query(None),
    mediaId: Optional[int] = Query(None),
    type: Optional[str] = Query(None)
):
    """Get statistics/analytics data"""
    try:
        stats = xibo_service.get_stats(
            from_dt=fromDt,
            to_dt=toDt,
            display_id=displayId,
            layout_id=layoutId,
            media_id=mediaId,
            stat_type=type
        )
        return {
            "stats": stats,
            "count": len(stats)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats/proof-of-play")
async def get_proof_of_play(
    fromDt: str = Query(...),
    toDt: str = Query(...),
    displayId: Optional[int] = Query(None),
    layoutId: Optional[int] = Query(None)
):
    """Get proof of play report"""
    try:
        report = xibo_service.get_proof_of_play(
            from_dt=fromDt,
            to_dt=toDt,
            display_id=displayId,
            layout_id=layoutId
        )
        return {
            "report": report,
            "count": len(report)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats/export-count")
async def get_export_stats_count(
    fromDt: Optional[str] = Query(None),
    toDt: Optional[str] = Query(None),
    displayId: Optional[int] = Query(None)
):
    """Get export stats count - Total count of stats for proof of play"""
    try:
        stats_count = xibo_service.get_export_stats_count(
            from_dt=fromDt,
            to_dt=toDt,
            display_id=displayId
        )
        return stats_count
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats/detailed")
async def get_detailed_stats(
    fromDt: str = Query(..., description="Start date in format: YYYY-MM-DD HH:MM:SS"),
    toDt: str = Query(..., description="End date in format: YYYY-MM-DD HH:MM:SS"),
    displayId: Optional[int] = Query(None, description="Optional display ID to filter"),
    layoutId: Optional[List[int]] = Query(None, description="Optional layout IDs to filter (can specify multiple)"),
    start: Optional[int] = Query(0, description="Pagination start offset"),
    length: Optional[int] = Query(1000, description="Number of records to return")
):
    """Get detailed proof of play stats - shows every play record with all details"""
    try:
        detailed_stats = xibo_service.get_detailed_stats(
            from_dt=fromDt,
            to_dt=toDt,
            display_id=displayId,
            layout_ids=layoutId,
            start=start,
            length=length
        )
        return {
            "stats": detailed_stats,
            "count": len(detailed_stats),
            "fromDt": fromDt,
            "toDt": toDt,
            "displayId": displayId,
            "layoutIds": layoutId,
            "start": start,
            "length": length
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ DATASET ENDPOINTS ============

@router.get("/datasets")
async def get_datasets():
    """Get all datasets"""
    try:
        datasets = xibo_service.get_datasets()
        return {
            "datasets": datasets,
            "count": len(datasets)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ FEATURED SCREENS (COMBINED DATA) ============

@router.get("/featured-screens")
async def get_featured_screens():
    """
    Get featured screens combining Xibo displays with internal screen data
    This endpoint provides dynamic screen data for the feature screen component
    """
    try:
        # Get displays from Xibo
        displays = xibo_service.get_displays()

        # Get display groups
        display_groups = xibo_service.get_display_groups()
        group_map = {g.get("displayGroupId"): g for g in display_groups}

        # Enhance display data
        featured = []
        for display in displays:
            display_group = group_map.get(display.get("displayGroupId"), {})

            featured.append({
                "id": display.get("displayId"),
                "name": display.get("display", "Unknown Display"),
                "description": display.get("description", ""),
                "location": {
                    "latitude": display.get("latitude"),
                    "longitude": display.get("longitude"),
                    "address": display.get("description", "")
                },
                "status": {
                    "online": display.get("loggedIn") == 1,
                    "licensed": display.get("licensed") == 1,
                    "lastAccessed": display.get("lastAccessed"),
                    "mediaInventoryStatus": display.get("mediaInventoryStatus")
                },
                "technical": {
                    "macAddress": display.get("macAddress"),
                    "clientAddress": display.get("clientAddress"),
                    "currentLayoutId": display.get("currentLayoutId"),
                    "defaultLayoutId": display.get("defaultLayoutId")
                },
                "group": {
                    "id": display.get("displayGroupId"),
                    "name": display_group.get("displayGroup", "")
                },
                "source": "xibo"
            })

        return {
            "screens": featured,
            "count": len(featured),
            "source": "xibo"
        }
    except Exception as e:
        return {
            "error": str(e),
            "screens": [],
            "count": 0
        }


@router.post("/sync-displays")
async def sync_displays(token_payload: dict = Depends(verify_token)):
    """
    Sync Xibo displays with internal screen database
    This creates/updates internal screen records based on Xibo displays
    """
    try:
        # Get displays from Xibo
        displays = xibo_service.get_displays()

        synced = []
        for display in displays:
            # Check if screen exists with this xibo_display_id
            # For now, just return the display data
            synced.append({
                "displayId": display.get("displayId"),
                "name": display.get("display"),
                "status": "found"
            })

        return {
            "message": f"Found {len(synced)} displays from Xibo",
            "displays": synced
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
