"""
Xibo CMS API Service
Handles authentication and communication with the Xibo/Screenox CMS API
"""
import requests

import time
from typing import Optional, List, Dict, Any
from dataclasses import dataclass
from app.config.config import settings


@dataclass
class XiboToken:
    access_token: str
    token_type: str
    expires_at: float


class XiboService:
    """Service for interacting with Xibo CMS API"""

    _token: Optional[XiboToken] = None

    def __init__(self):
        self.base_url = settings.XIBO_URL.rstrip('/') if settings.XIBO_URL else "https://saas.screenox.in"
        self.client_id = settings.XIBO_CLIENT_ID
        self.client_secret = settings.XIBO_CLIENT_SECRET

    def _is_configured(self) -> bool:
        """Check if Xibo credentials are configured"""
        return bool(self.client_id and self.client_secret)

    def _get_token(self) -> str:
        """Get valid access token, refreshing if necessary"""
        # Check if we have a valid token
        if self._token and time.time() < self._token.expires_at:
            return self._token.access_token

        if not self._is_configured():
            raise ValueError("Xibo API credentials not configured")

        # Request new token
        response = requests.post(
            f"{self.base_url}/api/authorize/access_token",
            data={
                "grant_type": "client_credentials",
                "client_id": self.client_id,
                "client_secret": self.client_secret,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"}
        )

        if response.status_code != 200:
            raise Exception(f"Xibo authentication failed: {response.text}")

        data = response.json()

        # Store token with expiry (subtract 60 seconds for safety)
        self._token = XiboToken(
            access_token=data["access_token"],
            token_type=data.get("token_type", "Bearer"),
            expires_at=time.time() + data.get("expires_in", 3600) - 60
        )

        return self._token.access_token

    def _make_request(
        self,
        method: str,
        endpoint: str,
        params: Optional[Dict] = None,
        data: Optional[Dict] = None,
        json_data: Optional[Dict] = None
    ) -> Any:
        """Make authenticated request to Xibo API"""
        token = self._get_token()

        url = f"{self.base_url}/api{endpoint}"
        headers = {
            "Authorization": f"Bearer {token}",
        }

        if json_data:
            headers["Content-Type"] = "application/json"

        # Logging disabled for performance - uncomment for debugging
        # print(f"[XIBO API] {method} {url}")
        # print(f"[XIBO API] Params: {params}")
        # print(f"[XIBO API] Headers: {dict(headers)}")

        response = requests.request(
            method=method,
            url=url,
            headers=headers,
            params=params,
            data=data,
            json=json_data
        )

        # print(f"[XIBO API] Response Status: {response.status_code}")

        if not response.ok:
            error_msg = response.text
            try:
                error_data = response.json()
                # Get detailed error message
                if isinstance(error_data, dict):
                    error_msg = error_data.get("message") or error_data.get("error") or error_data.get("errors") or error_msg
                    # Check for validation errors
                    if "property" in str(error_data):
                        error_msg = str(error_data)
            except:
                pass
            print(f"Xibo API Error Details: {response.status_code} - {error_msg}")
            raise Exception(f"Xibo API error ({response.status_code}): {error_msg}")

        return response.json() if response.text else None

    # ============ DISPLAY ENDPOINTS ============

    def get_displays(self, params: Optional[Dict] = None, start: int = 0, length: int = 1000) -> List[Dict]:
        """
        Get all displays with optional filtering

        Args:
            params: Optional dictionary of filter parameters (e.g., displayGroupIds)
            start: Starting index for pagination (default: 0)
            length: Number of records to return (default: 1000)

        Returns:
            List of display objects
        """
        # Initialize params if not provided
        if params is None:
            params = {}

        # Add pagination parameters
        params["start"] = start
        params["length"] = length

        return self._make_request("GET", "/display", params=params) or []

    def get_display_by_id(self, display_id: int) -> Dict:
        """Get display by ID"""
        displays = self._make_request("GET", "/display", params={"displayId": display_id})
        if displays and len(displays) > 0:
            return displays[0]
        raise Exception(f"Display {display_id} not found")

    def request_screenshot(self, display_id: int) -> Dict:
        """Request screenshot from display"""
        return self._make_request("PUT", f"/display/requestscreenshot/{display_id}")

    def get_display_screenshot_url(self, display_id: int) -> Optional[str]:
        """Get the screenshot URL for a display"""
        try:
            # The screenshot URL format for Xibo CMS
            return f"{self.base_url}/display/screenshot/{display_id}"
        except:
            return None

    def get_display_full_details(self, display_id: int) -> Dict:
        """Get full display details including all available fields from Screenox API"""
        display = self.get_display_by_id(display_id)

        # Get display groups for location info
        display_groups = self.get_display_groups()
        group_map = {g.get("displayGroupId"): g for g in display_groups}
        display_group = group_map.get(display.get("displayGroupId"), {})

        # Build comprehensive display info with all Screenox fields
        return {
            "displayId": display.get("displayId"),
            "display_name": display.get("display", "Unknown Display"),
            "description": display.get("description", ""),
            "display_group": display_group.get("displayGroup", ""),
            "display_group_description": display_group.get("description", ""),
            "is_online": display.get("loggedIn") == 1,
            "is_licensed": display.get("licensed") == 1,
            "last_accessed": display.get("lastAccessed"),

            # Location data from Screenox
            "address": display.get("address", ""),
            "latitude": display.get("latitude"),
            "longitude": display.get("longitude"),
            "venue_id": display.get("venueId"),
            "is_outdoor": display.get("isOutdoor") == 1,
            "is_mobile": display.get("isMobile") == 1,
            "languages": display.get("languages", ""),

            # Pricing & Metrics from Screenox (DYNAMIC DATA)
            "cost_per_play": display.get("costPerPlay", 0),
            "impressions_per_play": display.get("impressionsPerPlay", 0),

            # Screen technical details
            "screen_size": display.get("screenSize", 55),
            "display_type": display.get("displayType", "LED"),
            "display_type_id": display.get("displayTypeId"),
            "screen_width": display.get("screenWidth", 1080),
            "screen_height": display.get("screenHeight", 1920),
            "orientation": "landscape" if display.get("screenWidth", 1080) > display.get("screenHeight", 1920) else "portrait",

            # Device info
            "mac_address": display.get("macAddress"),
            "client_address": display.get("clientAddress"),
            "client_type": display.get("clientType"),
            "version": display.get("clientVersion"),
            "current_layout_id": display.get("currentLayoutId"),
            "default_layout_id": display.get("defaultLayoutId"),
            "media_inventory_status": display.get("mediaInventoryStatus"),
            "storage_available": display.get("storageAvailableSpace"),
            "storage_total": display.get("storageTotalSpace"),

            # Custom references (can be used for additional metadata)
            "custom_id": display.get("customId", ""),
            "ref1": display.get("ref1", ""),
            "ref2": display.get("ref2", ""),
            "ref3": display.get("ref3", ""),
            "ref4": display.get("ref4", ""),
            "ref5": display.get("ref5", ""),

            "screenshot_url": self.get_display_screenshot_url(display.get("displayId")),
            "raw_data": display  # Include all raw data for debugging
        }

    def get_display_status(self, display_id: int) -> Dict:
        """Get display status/health"""
        display = self.get_display_by_id(display_id)
        return {
            "displayId": display.get("displayId"),
            "name": display.get("display"),
            "loggedIn": display.get("loggedIn") == 1,
            "licensed": display.get("licensed") == 1,
            "lastAccessed": display.get("lastAccessed"),
            "mediaInventoryStatus": display.get("mediaInventoryStatus"),
            "currentLayoutId": display.get("currentLayoutId"),
        }

    # ============ CAMPAIGN ENDPOINTS ============

    def get_campaigns(self, params: Optional[Dict] = None) -> List[Dict]:
        """Get all campaigns"""
        return self._make_request("GET", "/campaign", params=params) or []

    def get_campaign_by_id(self, campaign_id: int) -> Dict:
        """Get campaign by ID"""
        campaigns = self._make_request("GET", "/campaign", params={"campaignId": campaign_id})
        if campaigns and len(campaigns) > 0:
            return campaigns[0]
        raise Exception(f"Campaign {campaign_id} not found")

    def create_campaign(self, name: str, **kwargs) -> Dict:
        """Create a new campaign"""
        data = {"name": name, **kwargs}
        return self._make_request("POST", "/campaign", data=data)

    def update_campaign(self, campaign_id: int, **kwargs) -> Dict:
        """Update an existing campaign"""
        return self._make_request("PUT", f"/campaign/{campaign_id}", data=kwargs)

    def delete_campaign(self, campaign_id: int) -> None:
        """Delete a campaign"""
        self._make_request("DELETE", f"/campaign/{campaign_id}")

    def assign_layout_to_campaign(self, campaign_id: int, layout_id: int, display_order: int = 1) -> Dict:
        """Assign a layout to a campaign"""
        return self._make_request(
            "POST",
            f"/campaign/layout/assign/{campaign_id}",
            data={"layoutId": [layout_id], "displayOrder": [display_order]}
        )

    # ============ LAYOUT ENDPOINTS ============

    def get_layouts(self, params: Optional[Dict] = None) -> List[Dict]:
        """Get all layouts"""
        return self._make_request("GET", "/layout", params=params) or []

    def get_layout_by_id(self, layout_id: int, embed: str = None) -> Dict:
        """Get layout by ID with optional embedded data"""
        params = {"layoutId": layout_id}
        if embed:
            params["embed"] = embed
        layouts = self._make_request("GET", "/layout", params=params)
        if layouts and len(layouts) > 0:
            return layouts[0]
        raise Exception(f"Layout {layout_id} not found")

    def update_layout(
        self,
        layout_id: int,
        name: str = None,
        description: str = None,
        tags: str = None,
        retired: int = None,
        enable_stat: int = None,
        code: str = None,
        folder_id: int = None
    ) -> Dict:
        """
        Edit/update an existing layout

        Args:
            layout_id: Layout ID to update
            name: The Layout Name
            description: The Layout Description
            tags: A comma separated list of Tags
            retired: A flag indicating whether this Layout is retired
            enable_stat: Flag indicating whether the Layout stat is enabled (1=enabled, 0=disabled)
            code: Code identifier for this Layout
            folder_id: Folder ID to which this object should be assigned to

        Returns:
            Updated layout object
        """
        data = {}
        if name is not None:
            data["name"] = name
        if description is not None:
            data["description"] = description
        if tags is not None:
            data["tags"] = tags
        if retired is not None:
            data["retired"] = retired
        if enable_stat is not None:
            data["enableStat"] = enable_stat
        if code is not None:
            data["code"] = code
        if folder_id is not None:
            data["folderId"] = folder_id

        return self._make_request("PUT", f"/layout/{layout_id}", data=data)

    # ============ SCHEDULE ENDPOINTS ============

    def get_schedules(self, params: Optional[Dict] = None) -> List[Dict]:
        """Get all schedule events"""
        return self._make_request("GET", "/schedule", params=params) or []

    def get_schedule_by_display(self, display_group_id: int, from_dt: Optional[str] = None, to_dt: Optional[str] = None) -> List[Dict]:
        """Get schedules for a specific display group"""
        params = {"displayGroupIds": display_group_id}
        if from_dt:
            params["fromDt"] = from_dt
        if to_dt:
            params["toDt"] = to_dt
        return self.get_schedules(params)

    def create_schedule(
        self,
        event_type_id: int,
        display_group_ids: List[int],
        from_dt: str,
        to_dt: str,
        campaign_id: Optional[int] = None,
        layout_id: Optional[int] = None,
        # Recurrence settings
        recurrence_type: Optional[str] = None,
        recurrence_detail: Optional[int] = None,
        recurrence_range: Optional[str] = None,
        recurrence_repeats_on: Optional[str] = None,
        recurrence_monthly_repeats_on: Optional[int] = None,
        # Day part and display settings
        day_part_id: Optional[int] = None,
        is_always: Optional[int] = None,
        is_custom: Optional[int] = None,
        is_priority: Optional[int] = None,
        display_order: Optional[int] = None,
        **kwargs
    ) -> Dict:
        """
        Create a new schedule event with full Screenox/Xibo options

        Args:
            event_type_id: 1=Layout/Campaign, 2=Command, 3=Overlay
            display_group_ids: List of display group IDs
            from_dt: Start datetime (Y-m-d H:i:s format)
            to_dt: End datetime (Y-m-d H:i:s format)
            campaign_id: Campaign ID to schedule
            layout_id: Layout ID (alternative to campaign)
            recurrence_type: None, "Minute", "Hour", "Day", "Week", "Month", "Year"
            recurrence_detail: Repeat every N (e.g., 2 = every 2 days/weeks)
            recurrence_range: End date for recurrence (Y-m-d H:i:s format)
            recurrence_repeats_on: For weekly - comma separated "Mon,Tue,Wed,Thu,Fri,Sat,Sun"
            recurrence_monthly_repeats_on: For monthly - which day of month (1-31) or 0 for same day
            day_part_id: Day part ID for time restrictions
            is_always: 1 = always on display, 0 = follow schedule
            is_custom: 1 = custom schedule, 0 = use day part only
            is_priority: 1 = priority event (overrides others), 0 = normal
            display_order: Order in which to display (1, 2, 3...)
        """
        # Build data dict
        data = {
            "eventTypeId": event_type_id,
            "fromDt": from_dt,
            "toDt": to_dt,
        }

        # Add displayGroupIds as array format for form data
        for i, dgid in enumerate(display_group_ids):
            data[f"displayGroupIds[{i}]"] = dgid

        # Campaign or Layout
        if campaign_id:
            data["campaignId"] = campaign_id
        if layout_id:
            data["layoutId"] = layout_id

        # Add any additional kwargs (including 'name' if provided)
        data.update(kwargs)

        # Recurrence settings
        if recurrence_type:
            data["recurrenceType"] = recurrence_type
        if recurrence_detail is not None:
            data["recurrenceDetail"] = recurrence_detail
        if recurrence_range:
            data["recurrenceRange"] = recurrence_range
        if recurrence_repeats_on:
            data["recurrenceRepeatsOn"] = recurrence_repeats_on
        if recurrence_monthly_repeats_on is not None:
            data["recurrenceMonthlyRepeatsOn"] = recurrence_monthly_repeats_on

        # Day part and display settings
        if day_part_id is not None:
            data["dayPartId"] = day_part_id
        if is_always is not None:
            data["isAlways"] = is_always
        if is_custom is not None:
            data["isCustom"] = is_custom
        if is_priority is not None:
            data["isPriority"] = is_priority
        if display_order is not None:
            data["displayOrder"] = display_order

        # Logging disabled for performance
        # print(f"Schedule request data: {data}")
        return self._make_request("POST", "/schedule", data=data)

    def delete_schedule(self, event_id: int) -> None:
        """Delete a schedule event"""
        self._make_request("DELETE", f"/schedule/{event_id}")

    # ============ STATISTICS ENDPOINTS ============

    def get_stats(
        self,
        from_dt: Optional[str] = None,
        to_dt: Optional[str] = None,
        display_id: Optional[int] = None,
        layout_id: Optional[int] = None,
        media_id: Optional[int] = None,
        stat_type: Optional[str] = None
    ) -> List[Dict]:
        """Get statistics/analytics data"""
        params = {}
        if from_dt:
            params["fromDt"] = from_dt
        if to_dt:
            params["toDt"] = to_dt
        if display_id:
            params["displayId"] = display_id
        if layout_id:
            params["layoutId"] = layout_id
        if media_id:
            params["mediaId"] = media_id
        if stat_type:
            params["type"] = stat_type

        return self._make_request("GET", "/stats", params=params) or []

    def get_proof_of_play(
        self,
        from_dt: str,
        to_dt: str,
        display_id: Optional[int] = None,
        layout_id: Optional[int] = None
    ) -> List[Dict]:
        """Get proof of play report"""
        params = {"fromDt": from_dt, "toDt": to_dt}
        if display_id:
            params["displayId"] = display_id
        if layout_id:
            params["layoutId"] = layout_id

        return self._make_request("GET", "/stats/proofofplay", params=params) or []

    def get_detailed_stats(
        self,
        from_dt: str,
        to_dt: str,
        display_id: Optional[int] = None,
        layout_ids: Optional[List[int]] = None,
        start: int = 0,
        length: int = 1000
    ) -> List[Dict]:
        """
        Get detailed proof of play statistics - returns raw play-by-play records
        This calls the Xibo /stats endpoint directly which returns detailed records

        Args:
            from_dt: The start date for the filter (required)
            to_dt: The end date for the filter (required)
            display_id: An optional display Id to filter
            layout_ids: Optional list of layout IDs to filter
            start: Pagination start offset (default: 0)
            length: Number of records to return (default: 1000)

        Returns:
            List of detailed stat records with all fields
        """
        try:
            # Build params
            params = {}
            if from_dt:
                params["fromDt"] = from_dt
            if to_dt:
                params["toDt"] = to_dt
            if display_id:
                params["displayId"] = display_id

            # Add pagination
            params["start"] = start
            params["length"] = length

            # Add multiple layout IDs (Xibo uses layoutId[] for arrays)
            if layout_ids:
                for layout_id in layout_ids:
                    if "layoutId[]" not in params:
                        params["layoutId[]"] = []
                    if isinstance(params.get("layoutId[]"), list):
                        params["layoutId[]"].append(layout_id)

            # Call the Xibo stats endpoint with proper array parameter handling
            detailed_stats = self._make_request("GET", "/stats", params=params) or []
            return detailed_stats
        except Exception as e:
            print(f"Error getting detailed stats: {e}")
            return []

    def get_export_stats_count(
        self,
        from_dt: Optional[str] = None,
        to_dt: Optional[str] = None,
        display_id: Optional[int] = None
    ) -> Dict:
        """
        Get aggregated proof of play statistics using the detailed stats API
        This is much faster as it uses pagination and aggregates only what's needed

        Args:
            from_dt: The start date for the filter. Default = 24 hours ago
            to_dt: The end date for the filter. Default = now
            display_id: An optional display Id to filter

        Returns:
            Aggregated stats data
        """
        from datetime import datetime, timedelta

        # Set defaults if not provided
        if not to_dt:
            to_dt = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        if not from_dt:
            yesterday = datetime.utcnow() - timedelta(days=1)
            from_dt = yesterday.strftime("%Y-%m-%d %H:%M:%S")

        try:
            # Fetch only first 30 records for quick initial statistics
            # User can browse more records with pagination
            initial_batch_size = 30

            initial_stats = self.get_detailed_stats(
                from_dt=from_dt,
                to_dt=to_dt,
                display_id=display_id,
                start=0,
                length=initial_batch_size
            )

            # Aggregate statistics from initial batch
            stats = {
                "fromDt": from_dt,
                "toDt": to_dt,
                "totalRecords": len(initial_stats),  # Only shows initial batch
                "uniqueDisplays": len(set(item.get("displayId") for item in initial_stats if item.get("displayId"))),
                "uniqueLayouts": len(set(item.get("layoutId") for item in initial_stats if item.get("layoutId"))),
                "totalDuration": sum(item.get("duration", 0) for item in initial_stats),
                "totalPlays": sum(item.get("numberPlays", 0) for item in initial_stats),
            }

            # Group by display
            display_stats = {}
            for item in initial_stats:
                display_id_val = item.get("displayId")
                if display_id_val:
                    if display_id_val not in display_stats:
                        display_stats[display_id_val] = {
                            "displayId": display_id_val,
                            "displayName": item.get("display", f"Display {display_id_val}"),
                            "plays": 0,
                            "duration": 0
                        }
                    display_stats[display_id_val]["plays"] += item.get("numberPlays", 0)
                    display_stats[display_id_val]["duration"] += item.get("duration", 0)

            stats["displayBreakdown"] = list(display_stats.values())

            # Calculate average duration per play
            if stats["totalPlays"] > 0:
                stats["avgDurationPerPlay"] = round(stats["totalDuration"] / stats["totalPlays"], 2)
            else:
                stats["avgDurationPerPlay"] = 0

            return stats

        except Exception as e:
            print(f"Error getting proof of play stats: {e}")
            # Return empty stats on error
            return {
                "fromDt": from_dt,
                "toDt": to_dt,
                "totalRecords": 0,
                "uniqueDisplays": 0,
                "uniqueLayouts": 0,
                "totalDuration": 0,
                "totalPlays": 0,
                "avgDurationPerPlay": 0,
                "displayBreakdown": [],
                "error": str(e)
            }

    # ============ DISPLAY GROUPS ENDPOINTS ============

    def get_display_groups(self, params: Optional[Dict] = None) -> List[Dict]:
        """Get all display groups"""
        return self._make_request("GET", "/displaygroup", params=params) or []

    # ============ DAY PARTS ENDPOINTS ============

    def get_day_parts(self, params: Optional[Dict] = None) -> List[Dict]:
        """
        Get all day parts (time slots) from Screenox
        Day parts define specific time windows for scheduling (e.g., Morning 6AM-12PM)
        """
        return self._make_request("GET", "/daypart", params=params) or []

    def get_day_part_by_id(self, day_part_id: int) -> Dict:
        """Get a specific day part by ID"""
        day_parts = self._make_request("GET", "/daypart", params={"dayPartId": day_part_id})
        if day_parts and len(day_parts) > 0:
            return day_parts[0]
        raise Exception(f"Day part {day_part_id} not found")

    # ============ DATASETS ENDPOINTS ============

    def get_datasets(self, params: Optional[Dict] = None) -> List[Dict]:
        """Get all datasets"""
        return self._make_request("GET", "/dataset", params=params) or []

    # ============ MEDIA LIBRARY ENDPOINTS ============

    def get_library(self, params: Optional[Dict] = None) -> List[Dict]:
        """Get all media from library"""
        return self._make_request("GET", "/library", params=params) or []

    def upload_media_to_library(
        self,
        file_path: str,
        name: str,
        media_type: str = "image",
        duration: int = 10,
        expires: Optional[str] = None
    ) -> Dict:
        """
        Upload media file to Xibo library

        Args:
            file_path: Path to the file or URL
            name: Name for the media
            media_type: "image" or "video"
            duration: Duration in seconds (for images)
            expires: Expiry date in Y-m-d H:i:s format

        Returns:
            Media object from Xibo
        """
        import requests
        import os

        token = self._get_token()
        url = f"{self.base_url}/api/library"
        headers = {"Authorization": f"Bearer {token}"}

        # If it's a URL, download first
        if file_path.startswith("http"):
            print(f"Downloading media from URL: {file_path}")
            response = requests.get(file_path, timeout=30)

            if not response.ok:
                raise Exception(f"Failed to download media from URL: {response.status_code} - {response.text[:200]}")

            # Determine file extension based on media type
            if media_type == 'video':
                ext = 'mp4'
            elif media_type == 'image':
                ext = 'jpg'
            else:
                # Try to get extension from URL or default to jpg
                ext = file_path.split('.')[-1].split('?')[0] if '.' in file_path else 'jpg'

            # Sanitize filename
            safe_name = "".join(c if c.isalnum() or c in '-_' else '_' for c in name)
            temp_filename = f"/tmp/{safe_name}.{ext}"

            with open(temp_filename, 'wb') as f:
                f.write(response.content)

            file_size = len(response.content)
            print(f"Downloaded media to: {temp_filename} (size: {file_size} bytes)")

            if file_size == 0:
                raise Exception("Downloaded file is empty")

            file_path = temp_filename

        with open(file_path, 'rb') as f:
            files = {'files': (os.path.basename(file_path), f)}
            data = {
                'name': name,
                'duration': duration
            }
            if expires:
                data['expires'] = expires

            response = requests.post(url, headers=headers, data=data, files=files)

        if not response.ok:
            raise Exception(f"Failed to upload media: {response.text}")

        result = response.json()
        # Return the first file uploaded
        if 'files' in result and len(result['files']) > 0:
            return result['files'][0]
        return result

    def upload_media_from_url(
        self,
        media_url: str,
        name: str,
        media_type: str = "image",
        duration: int = 10
    ) -> Dict:
        """
        Upload media from URL to Xibo library

        Args:
            media_url: URL of the media file
            name: Name for the media
            media_type: "image" or "video"
            duration: Duration in seconds (for images)

        Returns:
            Media object from Xibo
        """
        return self.upload_media_to_library(
            file_path=media_url,
            name=name,
            media_type=media_type,
            duration=duration
        )

    def delete_library_media(self, media_id: int) -> None:
        """Delete media from library"""
        self._make_request("DELETE", f"/library/{media_id}")

    # ============ LAYOUT CREATION ENDPOINTS ============

    def get_resolutions(self) -> List[Dict]:
        """Get all available resolutions"""
        return self._make_request("GET", "/resolution") or []

    def get_default_resolution_id(self) -> int:
        """Get a valid resolution ID (preferably 1080x1920)"""
        try:
            resolutions = self.get_resolutions()
            # Try to find 1080x1920 (Full HD)
            for res in resolutions:
                if res.get("width") == 1080 and res.get("height") == 1920:
                    return res.get("resolutionId")
            # Fallback to first available resolution
            if resolutions:
                return resolutions[0].get("resolutionId")
        except Exception as e:
            print(f"Error getting resolutions: {e}")
        return 1  # Default fallback

    def create_layout(
        self,
        name: str,
        description: str = "",
        resolution_id: int = 3,
        layout_type: str = "",
        enable_stat: int = 1
    ) -> Dict:
        """
        Create a new layout

        Args:
            name: Layout name
            description: Layout description
            resolution_id: Resolution ID (default: 3 for standard resolution)
            layout_type: Layout type
            enable_stat: Enable statistics (1=enabled, 0=disabled, default=1)

        Returns:
            Created layout object (draft version)
        """
        print(f"Creating layout with resolution ID: {resolution_id}, enableStat: {enable_stat}")

        data = {
            "name": name,
            "description": description,
            "resolutionId": resolution_id,
            "enableStat": enable_stat
        }
        if layout_type:
            data["layoutType"] = layout_type

        return self._make_request("POST", "/layout", data=data)

    def publish_layout(self, layout_id: int, publish_now: bool = True) -> Dict:
        """Publish a layout to make it available for scheduling

        Args:
            layout_id: The layout ID to publish
            publish_now: Whether to publish immediately (default: True)
        """
        data = {
            "publishNow": 1 if publish_now else 0
        }
        return self._make_request("PUT", f"/layout/publish/{layout_id}", data=data)

    def checkout_layout(self, layout_id: int) -> Dict:
        """Checkout a layout for editing"""
        return self._make_request("PUT", f"/layout/checkout/{layout_id}")

    def get_draft_layout(self, parent_layout_id: int) -> Optional[Dict]:
        """Get the draft version of a layout by its parent ID"""
        try:
            layouts = self._make_request("GET", "/layout", params={
                "parentId": parent_layout_id
            })
            if layouts and len(layouts) > 0:
                return layouts[0]
        except Exception as e:
            print(f"Error getting draft layout: {e}")
        return None

    def discard_layout(self, layout_id: int) -> Dict:
        """Discard layout changes"""
        return self._make_request("PUT", f"/layout/discard/{layout_id}")

    def delete_layout(self, layout_id: int) -> None:
        """Delete a layout"""
        self._make_request("DELETE", f"/layout/{layout_id}")

    def get_layout_regions(self, layout_id: int) -> List[Dict]:
        """Get all regions in a layout using embed parameter"""
        try:
            # Get layout with embedded regions
            layout = self.get_layout_by_id(layout_id, embed="regions,playlists")
            regions = layout.get("regions", [])
            print(f"Layout {layout_id} has {len(regions)} regions")
            return regions
        except Exception as e:
            print(f"Error getting layout regions: {e}")
            return []

    def add_region_to_layout(
        self,
        layout_id: int,
        width: int = 1080,
        height: int = 1920,
        top: int = 0,
        left: int = 0
    ) -> Dict:
        """Add a region to a layout (1080x1920 for portrait)"""
        data = {
            "width": width,
            "height": height,
            "top": top,
            "left": left
        }
        return self._make_request("POST", f"/region/{layout_id}", data=data)

    # ============ PLAYLIST/WIDGET ENDPOINTS ============

    def get_region_playlist(self, region_id: int) -> Dict:
        """Get playlist for a region"""
        return self._make_request("GET", f"/playlist/region/{region_id}")

    def add_image_widget(
        self,
        playlist_id: int,
        media_id: int,
        duration: int = 10,
        left    : int = 0,
        top     : int = 0,
        width   : int = 1080,
        height  : int = 1920
    ) -> Dict:
        """
        Add an image widget to a playlist

        Args:
            playlist_id: Playlist ID to add to
            media_id: Media ID from library
            duration: Duration in seconds

        Returns:
            Widget object
        """
        data = {
            "mediaIds": [media_id],
            "duration": duration,
            "left": left,
            "top": top,
            "width": width,
            "height": height
        }
        return self._make_request("POST", f"/playlist/widget/image/{playlist_id}", data=data)

    def add_video_widget(
        self,
        playlist_id: int,
        media_id: int,
        duration: Optional[int] = None
    ) -> Dict:
        """
        Add a video widget to a playlist

        Args:
            playlist_id: Playlist ID to add to
            media_id: Media ID from library
            duration: Duration in seconds (None = use video duration)

        Returns:
            Widget object
        """
        data = {
            "mediaIds": [media_id],
            "useDuration": 0 if duration is None else 1
        }
        if duration:
            data["duration"] = duration

        return self._make_request("POST", f"/playlist/widget/video/{playlist_id}", data=data)

    def assign_media_to_playlist(
        self,
        playlist_id: int,
        media_ids: List[int],
        duration: int = 10
    ) -> Dict:
        """
        Assign media directly to a playlist

        Args:
            playlist_id: Playlist ID
            media_ids: List of media IDs to assign
            duration: Duration for each media

        Returns:
            Assignment result
        """
        # Xibo expects array parameters in indexed format: media[0], media[1], etc.
        data = {
            "duration": duration,
            "useDuration": 1  # Enable custom duration
        }
        for i, mid in enumerate(media_ids):
            data[f"media[{i}]"] = mid

        print(f"Assign media request: playlist={playlist_id}, data={data}")
        return self._make_request("POST", f"/playlist/library/assign/{playlist_id}", data=data)

    # ============ FULL WORKFLOW HELPERS ============

    def create_layout_with_media(
        self,
        name: str,
        media_url: str,
        media_type: str = "image",
        duration: int = 10,
        description: str = ""
    ) -> Dict:
        """
        Complete workflow: Upload media, create layout, publish, return campaign for scheduling.
        This version is resilient - it will complete even if some steps fail.

        Returns:
            Dict with layout_id, media_id, campaign_id, and status
        """
        import json
        import uuid
        import time

        # VERBOSE LOGGING DISABLED FOR PERFORMANCE
        # Set to True to enable detailed step-by-step logging (246 print statements!)
        DEBUG_VERBOSE = False

        # Make layout name unique to avoid conflicts
        # Use first 35 chars + short UUID
        base_layout_name = name[:35]
        unique_suffix = str(uuid.uuid4())[:8]
        unique_layout_name = f"{base_layout_name}_{unique_suffix}"

        if DEBUG_VERBOSE:
            if DEBUG_VERBOSE: print("\n" + "="*80)
            if DEBUG_VERBOSE: print("🚀 STARTING CREATE_LAYOUT_WITH_MEDIA WORKFLOW")
            if DEBUG_VERBOSE: print("="*80)
            if DEBUG_VERBOSE: print(f"📝 Original Name: {name}")
            if DEBUG_VERBOSE: print(f"📝 Unique Layout Name: {unique_layout_name}")
            if DEBUG_VERBOSE: print(f"🔗 Media URL: {media_url}")
            if DEBUG_VERBOSE: print(f"🎨 Media Type: {media_type}")
            if DEBUG_VERBOSE: print(f"⏱️  Duration: {duration}s")
            if DEBUG_VERBOSE: print(f"📄 Description: {description or 'N/A'}")
            if DEBUG_VERBOSE: print("="*80 + "\n")

        result = {
            "success": False,
            "layout_id": None,
            "media_id": None,
            "campaign_id": None,
            "error": None,
            "warnings": []
        }

        # Step 1: Upload media to library
        if DEBUG_VERBOSE: print("\n" + "▶"*40)
        if DEBUG_VERBOSE: print("📤 STEP 1: UPLOADING MEDIA TO LIBRARY")
        if DEBUG_VERBOSE: print("▶"*40)
        if DEBUG_VERBOSE: print(f"🔗 Media URL: {media_url}")
        if DEBUG_VERBOSE: print(f"📛 Media Name: media_{name}"[:50])
        if DEBUG_VERBOSE: print(f"🎨 Media Type: {media_type}")
        if DEBUG_VERBOSE: print(f"⏱️  Duration: {duration}s")
        if DEBUG_VERBOSE: print(f"🌐 API Endpoint: POST /api/library")

        try:
            import time
            import hashlib

            # Create a more unique media name to avoid conflicts
            # Use first 30 chars of name + hash of URL (to handle same media for different bookings)
            base_name = f"media_{name}"[:30]
            url_hash = hashlib.md5(media_url.encode()).hexdigest()[:8]
            timestamp = int(time.time())
            media_name = f"{base_name}_{url_hash}_{timestamp}"[:50]

            if DEBUG_VERBOSE: print(f"\n📡 Attempting to upload media...")
            if DEBUG_VERBOSE: print(f"📛 Generated unique media name: {media_name}")

            try:
                media = self.upload_media_from_url(
                    media_url=media_url,
                    name=media_name,
                    media_type=media_type,
                    duration=duration
                )
                if DEBUG_VERBOSE: print(f"\n✅ UPLOAD SUCCESS!")
                if DEBUG_VERBOSE: print(f"📦 Full Response:")
                if DEBUG_VERBOSE: print(json.dumps(media, indent=2, default=str))

                media_id = media.get("mediaId")
                if not media_id:
                    raise Exception(f"No mediaId in response: {media}")

            except Exception as upload_error:
                # Check if error is due to duplicate name
                error_str = str(upload_error).lower()
                if "already own media with this name" in error_str or "duplicate" in error_str:
                    if DEBUG_VERBOSE: print(f"\n⚠️  Media name conflict detected, searching for existing media...")

                    # Try to find existing media by searching the library
                    try:
                        if DEBUG_VERBOSE: print(f"🔍 Searching library for media with similar name...")
                        library = self.get_library(params={"media": base_name[:20]})

                        if library and len(library) > 0:
                            # Find media with matching URL or name
                            for existing_media in library:
                                existing_name = existing_media.get("name", "")
                                if base_name[:20] in existing_name:
                                    media_id = existing_media.get("mediaId")
                                    if DEBUG_VERBOSE: print(f"✅ Found existing media to reuse!")
                                    if DEBUG_VERBOSE: print(f"🆔 Media ID: {media_id}")
                                    if DEBUG_VERBOSE: print(f"📛 Media Name: {existing_name}")
                                    media = existing_media
                                    break

                        if not media_id:
                            # If still not found, try with a completely unique name
                            import uuid
                            unique_suffix = str(uuid.uuid4())[:8]
                            media_name = f"{base_name[:35]}_{unique_suffix}"
                            if DEBUG_VERBOSE: print(f"\n🔄 Retrying with UUID suffix: {media_name}")

                            media = self.upload_media_from_url(
                                media_url=media_url,
                                name=media_name,
                                media_type=media_type,
                                duration=duration
                            )
                            media_id = media.get("mediaId")
                            if not media_id:
                                raise Exception(f"No mediaId in response: {media}")

                    except Exception as search_error:
                        if DEBUG_VERBOSE: print(f"⚠️  Could not search/reuse existing media: {search_error}")
                        raise upload_error  # Re-raise original error
                else:
                    # Different error, re-raise it
                    raise upload_error

            result["media_id"] = media_id

            if DEBUG_VERBOSE: print(f"\n✅ STEP 1 COMPLETE")
            if DEBUG_VERBOSE: print(f"🆔 Media ID: {media_id}")
            if DEBUG_VERBOSE: print(f"📛 Media Name: {media.get('name', 'N/A')}")
            if DEBUG_VERBOSE: print(f"📏 File Size: {media.get('fileSize', 'N/A')} bytes")
            if DEBUG_VERBOSE: print(f"🔧 Media Type: {media.get('mediaType', 'N/A')}")

        except Exception as e:
            if DEBUG_VERBOSE: print(f"\n❌ STEP 1 FAILED!")
            if DEBUG_VERBOSE: print(f"⚠️  Error: {e}")
            result["error"] = f"Media upload failed: {e}"
            result["warnings"].append(f"Media upload failed: {e}")
            if DEBUG_VERBOSE:
                import traceback
                if DEBUG_VERBOSE: print("\n🔍 Full Traceback:")
                traceback.print_exc()
            return result

        # Step 2: Create layout with resolutionId=3
        if DEBUG_VERBOSE: print("\n" + "▶"*40)
        if DEBUG_VERBOSE: print("🎨 STEP 2: CREATING LAYOUT")
        if DEBUG_VERBOSE: print("▶"*40)
        if DEBUG_VERBOSE: print(f"📛 Layout Name: {unique_layout_name}")
        if DEBUG_VERBOSE: print(f"📄 Description: {description or f'Ad layout for {name}'}")
        if DEBUG_VERBOSE: print(f"📐 Resolution ID: 3")
        if DEBUG_VERBOSE: print(f"🌐 API Endpoint: POST /api/layout")

        try:
            if DEBUG_VERBOSE: print(f"\n📡 Calling create_layout()...")
            layout = self.create_layout(
                name=unique_layout_name,
                description=description or f"Ad layout for {name}",
                resolution_id=3,
                enable_stat=1  # Enable statistics from the start
            )
            if DEBUG_VERBOSE: print(f"\n✅ LAYOUT CREATION SUCCESS!")
            if DEBUG_VERBOSE: print(f"📦 Full Response:")
            if DEBUG_VERBOSE: print(json.dumps(layout, indent=2, default=str))

            layout_id = layout.get("layoutId")
            auto_campaign_id = layout.get("campaignId")
            result["layout_id"] = layout_id

            if DEBUG_VERBOSE: print(f"\n✅ STEP 2 COMPLETE")
            if DEBUG_VERBOSE: print(f"🆔 Layout ID: {layout_id}")
            if DEBUG_VERBOSE: print(f"🎯 Auto-Created Campaign ID: {auto_campaign_id}")
            if DEBUG_VERBOSE: print(f"📛 Layout Name: {layout.get('layout', 'N/A')}")
            if DEBUG_VERBOSE: print(f"📐 Width x Height: {layout.get('width', 'N/A')} x {layout.get('height', 'N/A')}")

            # Immediately check the status of the newly created layout
            if DEBUG_VERBOSE: print(f"\n🔍 Checking newly created layout status...")
            fresh_layout = self.get_layout_by_id(layout_id)
            fresh_status = fresh_layout.get("publishedStatusId")
            fresh_parent = fresh_layout.get("parentId")
            if DEBUG_VERBOSE: print(f"📊 New Layout Status:")
            if DEBUG_VERBOSE: print(f"   - publishedStatusId: {fresh_status}")
            if DEBUG_VERBOSE: print(f"   - status: {fresh_layout.get('status')}")
            if DEBUG_VERBOSE: print(f"   - parentId: {fresh_parent}")

        except Exception as e:
            if DEBUG_VERBOSE: print(f"\n❌ STEP 2 FAILED!")
            if DEBUG_VERBOSE: print(f"⚠️  Error: {e}")
            result["error"] = f"Layout creation failed: {e}"
            import traceback
            if DEBUG_VERBOSE: print("\n🔍 Full Traceback:")
            traceback.print_exc()
            return result

        original_layout_id = layout_id
        if DEBUG_VERBOSE: print(f"\n💾 Stored Original Layout ID: {original_layout_id}")

        # Step 2.5: Enable statistics (SKIPPED - causes API conflicts)
        # Statistics will be enabled automatically when layout is created with resolutionId=3
        if DEBUG_VERBOSE: print("\n" + "▶"*40)
        if DEBUG_VERBOSE: print("📊 STEP 2.5: STATISTICS (Skipped - enabled by default)")
        if DEBUG_VERBOSE: print("▶"*40)
        if DEBUG_VERBOSE: print(f"ℹ️  Layout statistics are enabled by default in Xibo")
        if DEBUG_VERBOSE: print(f"ℹ️  Skipping manual enableStat update to avoid API conflicts")

        # Step 3: SKIP CHECKOUT - Just use the layout as-is
        # Xibo layouts are editable immediately after creation
        if DEBUG_VERBOSE: print("\n" + "▶"*40)
        if DEBUG_VERBOSE: print("✏️  STEP 3: LAYOUT PREPARATION (SIMPLIFIED)")
        if DEBUG_VERBOSE: print("▶"*40)
        if DEBUG_VERBOSE: print(f"🆔 Layout ID: {layout_id}")
        if DEBUG_VERBOSE: print(f"ℹ️  Using layout immediately after creation")
        if DEBUG_VERBOSE: print(f"ℹ️  Xibo allows editing layouts right after they're created")
        if DEBUG_VERBOSE: print(f"✅ STEP 3 COMPLETE - Using Layout ID: {layout_id}")

        # Simplified verification - just confirm we have a layout ID
        if DEBUG_VERBOSE: print("\n" + "="*80)
        if DEBUG_VERBOSE: print("🔍 READY TO ADD MEDIA")
        if DEBUG_VERBOSE: print("="*80)
        if DEBUG_VERBOSE: print(f"🆔 Layout ID: {layout_id}")
        if DEBUG_VERBOSE: print(f"🆔 Media ID: {media_id}")
        if DEBUG_VERBOSE: print(f"✅ Proceeding to add regions and media...")
        if DEBUG_VERBOSE: print("="*80 + "\n")

        # Step 4: Add media to layout via region/playlist
        if media_id:
            if DEBUG_VERBOSE: print("\n" + "▶"*40)
            if DEBUG_VERBOSE: print("🎬 STEP 4: ADDING MEDIA TO LAYOUT")
            if DEBUG_VERBOSE: print("▶"*40)
            if DEBUG_VERBOSE: print(f"🆔 Layout ID: {layout_id}")
            if DEBUG_VERBOSE: print(f"🆔 Media ID: {media_id}")
            media_added = False

            try:
                # Step 4a: Create region
                if DEBUG_VERBOSE: print(f"\n📍 STEP 4a: Creating region on layout")
                if DEBUG_VERBOSE: print(f"🆔 Layout ID: {layout_id}")
                if DEBUG_VERBOSE: print(f"📐 Region Dimensions: 1080x1920 @ (0,0)")
                if DEBUG_VERBOSE: print(f"🌐 API Endpoint: POST /api/region/{layout_id}")

                if DEBUG_VERBOSE: print(f"\n📡 Calling add_region_to_layout()...")

                try:
                    region = self.add_region_to_layout(layout_id)
                except Exception as region_error:
                    error_str = str(region_error).lower()

                    # If error is "not a draft", try to checkout and use the draft
                    if "not a draft" in error_str or "please checkout" in error_str:
                        if DEBUG_VERBOSE: print(f"\n⚠️  ERROR: Layout {layout_id} is not a draft!")
                        if DEBUG_VERBOSE: print(f"⚠️  Attempting emergency checkout...")

                        try:
                            # Try to checkout
                            checkout_result = self.checkout_layout(layout_id)
                            if DEBUG_VERBOSE: print(f"✅ Emergency checkout succeeded!")
                            if DEBUG_VERBOSE: print(json.dumps(checkout_result, indent=2, default=str))

                        except Exception as checkout_error:
                            checkout_error_str = str(checkout_error).lower()

                            # If already checked out, that's fine - just find the existing draft
                            if "already checked out" in checkout_error_str:
                                if DEBUG_VERBOSE: print(f"ℹ️  Layout already checked out, looking for existing draft...")
                            else:
                                # Some other checkout error - re-raise it
                                raise checkout_error

                        # Search for the draft (works whether we just checked out or it was already checked out)
                        draft = self.get_draft_layout(layout_id)
                        if draft:
                            draft_id = draft.get("layoutId")
                            if DEBUG_VERBOSE: print(f"✅ Found draft: {draft_id}")

                            # Retry adding region to the draft
                            if DEBUG_VERBOSE: print(f"\n📡 Retrying add_region_to_layout with draft {draft_id}...")
                            region = self.add_region_to_layout(draft_id)

                            # CRITICAL: Update both layout_id (for editing) and keep original for publishing
                            if DEBUG_VERBOSE: print(f"🔄 Updating IDs:")
                            if DEBUG_VERBOSE: print(f"   - Original layout ID (for publishing): {original_layout_id}")
                            if DEBUG_VERBOSE: print(f"   - Draft layout ID (for editing): {draft_id}")
                            layout_id = draft_id  # Use draft for editing
                            if DEBUG_VERBOSE: print(f"✅ SUCCESS! Now using draft layout ID: {layout_id}")
                        else:
                            raise Exception("Could not find draft layout after checkout")
                    else:
                        # Different error, re-raise it
                        raise region_error
                if DEBUG_VERBOSE: print(f"\n✅ REGION CREATION SUCCESS!")
                if DEBUG_VERBOSE: print(f"📦 Full Region Response:")
                if DEBUG_VERBOSE: print(json.dumps(region, indent=2, default=str))

                region_id = region.get("regionId")
                if not region_id:
                    raise Exception(f"No regionId in response: {region}")

                if DEBUG_VERBOSE: print(f"\n✅ STEP 4a COMPLETE")
                if DEBUG_VERBOSE: print(f"🆔 Region ID: {region_id}")
                if DEBUG_VERBOSE: print(f"📐 Width: {region.get('width', 'N/A')}")
                if DEBUG_VERBOSE: print(f"📐 Height: {region.get('height', 'N/A')}")
                if DEBUG_VERBOSE: print(f"📍 Position: ({region.get('left', 0)}, {region.get('top', 0)})")

                # Step 4b: Get playlist from region
                if DEBUG_VERBOSE: print(f"\n🎵 STEP 4b: Getting playlist from region")
                playlist_data = region.get("regionPlaylist", {})
                if DEBUG_VERBOSE: print(f"📦 Playlist Data from Region:")
                if DEBUG_VERBOSE: print(json.dumps(playlist_data, indent=2, default=str))

                playlist_id = playlist_data.get("playlistId") if playlist_data else None
                if DEBUG_VERBOSE: print(f"\n🆔 Playlist ID: {playlist_id}")

                if not playlist_id:
                    raise Exception(f"No playlistId in region response: {region}")

                # Step 4c: Assign media to playlist
                if DEBUG_VERBOSE: print(f"\n🎬 STEP 4c: Assigning media to playlist")
                if DEBUG_VERBOSE: print(f"🆔 Playlist ID: {playlist_id}")
                if DEBUG_VERBOSE: print(f"🆔 Media ID: {media_id}")
                if DEBUG_VERBOSE: print(f"⏱️  Duration: {duration}s")

                data = {
                    "duration": duration,
                    "useDuration": 1,  # CRITICAL: Enable custom duration to make widget valid
                    "media[0]": media_id
                }
                if DEBUG_VERBOSE: print(f"📤 Request Data:")
                if DEBUG_VERBOSE: print(json.dumps(data, indent=2, default=str))
                if DEBUG_VERBOSE: print(f"🌐 API Endpoint: POST /api/playlist/library/assign/{playlist_id}")

                if DEBUG_VERBOSE: print(f"\n📡 Making API request...")
                assign_result = self._make_request("POST", f"/playlist/library/assign/{playlist_id}", data=data)
                if DEBUG_VERBOSE: print(f"\n✅ MEDIA ASSIGNMENT SUCCESS!")
                if DEBUG_VERBOSE: print(f"📦 Full Response:")
                if DEBUG_VERBOSE: print(json.dumps(assign_result, indent=2, default=str))

                # Validate that widgets were created and are valid
                widgets = assign_result.get("widgets", [])
                if widgets:
                    if DEBUG_VERBOSE: print(f"\n🔍 Validating {len(widgets)} widget(s)...")
                    for widget in widgets:
                        widget_id = widget.get("widgetId")
                        is_valid = widget.get("isValid", False)
                        is_new = widget.get("isNew", False)
                        if DEBUG_VERBOSE: print(f"   Widget {widget_id}: isValid={is_valid}, isNew={is_new}")

                        if not is_valid:
                            if DEBUG_VERBOSE: print(f"   ⚠️  WARNING: Widget {widget_id} is marked as INVALID by Xibo")
                            if DEBUG_VERBOSE: print(f"   ⚠️  This may cause the widget to be removed from the layout")
                        else:
                            if DEBUG_VERBOSE: print(f"   ✅ Widget {widget_id} is valid")
                else:
                    if DEBUG_VERBOSE: print(f"\n⚠️  WARNING: No widgets in response!")

                media_added = True
                if DEBUG_VERBOSE: print(f"\n✅ STEP 4c COMPLETE")
                if DEBUG_VERBOSE: print(f"🎬 Media successfully assigned to playlist")

            except Exception as e:
                if DEBUG_VERBOSE: print(f"\n❌ STEP 4 ERROR!")
                if DEBUG_VERBOSE: print(f"⚠️  Error: {e}")
                result["warnings"].append(f"Media assignment failed: {e}")
                result["success"] = False
                result["error"] = f"Failed to add media to layout: {e}"
                import traceback
                if DEBUG_VERBOSE: print("\n🔍 Full Traceback:")
                traceback.print_exc()

                # CRITICAL: If media assignment fails, the layout is useless
                if DEBUG_VERBOSE: print(f"\n🚨 CRITICAL: Layout {layout_id} was created but has NO media!")
                if DEBUG_VERBOSE: print(f"🚨 This booking will NOT display properly on screens!")
                return result

            if not media_added:
                result["warnings"].append("Could not add media to layout")
                result["success"] = False
                result["error"] = "Media was not added to layout"
                if DEBUG_VERBOSE: print(f"\n⚠️  STEP 4 FAILED: Media was NOT added to layout")
                if DEBUG_VERBOSE: print(f"🚨 Aborting - layout without media is useless")
                return result

            if DEBUG_VERBOSE: print(f"\n✅ STEP 4 COMPLETE: Media added to layout successfully")
        else:
            if DEBUG_VERBOSE: print(f"\n⏭️  STEP 4 SKIPPED: No media to add")

        # Step 5: Publish layout
        if DEBUG_VERBOSE: print("\n" + "▶"*40)
        if DEBUG_VERBOSE: print("📢 STEP 5: PUBLISHING LAYOUT")
        if DEBUG_VERBOSE: print("▶"*40)

        # CRITICAL: Always publish the PARENT layout, not the draft
        # Xibo automatically merges draft changes when parent is published
        if layout_id != original_layout_id:
            if DEBUG_VERBOSE: print(f"🔄 Draft {layout_id} was created during editing")
            if DEBUG_VERBOSE: print(f"🆔 Publishing PARENT Layout ID: {original_layout_id}")
            if DEBUG_VERBOSE: print(f"🆔 This will merge draft {layout_id} changes into parent {original_layout_id}")
            publish_id = original_layout_id  # Always publish the parent
        else:
            if DEBUG_VERBOSE: print(f"🆔 No draft created, publishing Layout ID: {original_layout_id}")
            publish_id = original_layout_id  # Publish the layout

        if DEBUG_VERBOSE: print(f"🌐 API Endpoint: PUT /api/layout/publish/{publish_id}")

        try:
            # Verify the layout exists and check lock status before publishing
            if DEBUG_VERBOSE: print(f"\n🔍 Verifying layout {publish_id} exists before publishing...")
            try:
                layout_check = self.get_layout_by_id(publish_id)
                layout_status = layout_check.get("publishedStatusId")
                lock_info = layout_check.get("isLocked", {})

                if DEBUG_VERBOSE: print(f"✅ Layout {publish_id} exists")
                if DEBUG_VERBOSE: print(f"📊 publishedStatusId: {layout_status}")

                if lock_info and isinstance(lock_info, dict) and lock_info.get("userId"):
                    lock_expires = lock_info.get("expires", "unknown")
                    if DEBUG_VERBOSE: print(f"🔒 Layout is locked until: {lock_expires}")
                    if DEBUG_VERBOSE: print(f"⏳ Waiting 2 seconds for lock to clear...")
                    import time
                    time.sleep(2)
                else:
                    if DEBUG_VERBOSE: print(f"🔓 Layout is not locked")

            except Exception as check_error:
                if DEBUG_VERBOSE: print(f"⚠️  Could not verify layout: {check_error}")
                if DEBUG_VERBOSE: print(f"⚠️  Proceeding with publish anyway...")

            if DEBUG_VERBOSE: print(f"\n📡 Calling publish_layout({publish_id})...")
            publish_result = self.publish_layout(publish_id)
            if DEBUG_VERBOSE: print(f"\n✅ PUBLISH SUCCESS!")
            if DEBUG_VERBOSE: print(f"📦 Full Response:")
            if DEBUG_VERBOSE: print(json.dumps(publish_result, indent=2, default=str))

            # CRITICAL: Xibo may return a DIFFERENT layout ID after publishing
            # When publishing a draft, Xibo deletes the parent and promotes the draft
            actual_published_layout_id = publish_result.get("layoutId")
            if actual_published_layout_id and actual_published_layout_id != original_layout_id:
                if DEBUG_VERBOSE: print(f"\n⚠️  IMPORTANT: Xibo changed the layout ID during publish!")
                if DEBUG_VERBOSE: print(f"   Original layout ID: {original_layout_id} (deleted)")
                if DEBUG_VERBOSE: print(f"   Actual published layout ID: {actual_published_layout_id}")
                if DEBUG_VERBOSE: print(f"   Updating to use the actual published layout ID")
                original_layout_id = actual_published_layout_id

            # Verify publish worked
            verify_status = publish_result.get("publishedStatusId")
            if verify_status == 1:
                if DEBUG_VERBOSE: print(f"\n✅ VERIFIED: Layout is now published (publishedStatusId=1)")
            elif verify_status == 2:
                if DEBUG_VERBOSE: print(f"\n⚠️  WARNING: Layout still shows as draft (publishedStatusId=2)")
                if DEBUG_VERBOSE: print(f"⚠️  This may indicate publish didn't complete properly")
            else:
                if DEBUG_VERBOSE: print(f"\n⚠️  Unknown publish status: publishedStatusId={verify_status}")

            # If we published a draft, verify the parent layout now has the regions
            if layout_id != original_layout_id:
                if DEBUG_VERBOSE: print(f"\n🔍 Verifying parent layout {original_layout_id} after publishing draft...")
                try:
                    parent_after_publish = self.get_layout_by_id(original_layout_id, embed="regions")
                    parent_regions = parent_after_publish.get("regions", [])
                    parent_status = parent_after_publish.get("publishedStatusId")
                    if DEBUG_VERBOSE: print(f"📊 Parent Layout Status: publishedStatusId={parent_status}")
                    if DEBUG_VERBOSE: print(f"📊 Parent Layout Regions: {len(parent_regions)} region(s)")

                    if len(parent_regions) > 0:
                        if DEBUG_VERBOSE: print(f"✅ SUCCESS: Parent layout now has regions merged from draft!")
                    else:
                        if DEBUG_VERBOSE: print(f"⚠️  WARNING: Parent layout still has no regions after publish")
                        if DEBUG_VERBOSE: print(f"📦 Parent Layout Data:")
                        if DEBUG_VERBOSE: print(json.dumps(parent_after_publish, indent=2, default=str))
                except Exception as verify_error:
                    if DEBUG_VERBOSE: print(f"⚠️  Could not verify parent layout: {verify_error}")

            if DEBUG_VERBOSE: print(f"\n✅ STEP 5 COMPLETE")
            if DEBUG_VERBOSE: print(f"📢 Layout published and ready for scheduling")

        except Exception as e:
            if DEBUG_VERBOSE: print(f"\n⚠️  STEP 5 WARNING!")
            if DEBUG_VERBOSE: print(f"⚠️  Error: {e}")
            if DEBUG_VERBOSE: print(f"ℹ️  Layout may already be published")

        # Step 6: Campaign setup
        if DEBUG_VERBOSE: print("\n" + "▶"*40)
        if DEBUG_VERBOSE: print("🎯 STEP 6: SETTING UP CAMPAIGN")
        if DEBUG_VERBOSE: print("▶"*40)
        campaign_id = auto_campaign_id
        if DEBUG_VERBOSE: print(f"🆔 Auto-created Campaign ID: {auto_campaign_id}")

        if not campaign_id:
            if DEBUG_VERBOSE: print(f"\n📝 No auto-created campaign, creating new campaign...")
            campaign_name = f"Camp_{name}"[:50]
            if DEBUG_VERBOSE: print(f"📛 Campaign Name: {campaign_name}")
            if DEBUG_VERBOSE: print(f"🌐 API Endpoint: POST /api/campaign")

            try:
                if DEBUG_VERBOSE: print(f"\n📡 Calling create_campaign()...")
                campaign = self.create_campaign(name=campaign_name)
                if DEBUG_VERBOSE: print(f"\n✅ CAMPAIGN CREATION SUCCESS!")
                if DEBUG_VERBOSE: print(f"📦 Full Response:")
                if DEBUG_VERBOSE: print(json.dumps(campaign, indent=2, default=str))

                campaign_id = campaign.get("campaignId")
                if DEBUG_VERBOSE: print(f"\n✅ Campaign Created")
                if DEBUG_VERBOSE: print(f"🆔 Campaign ID: {campaign_id}")

            except Exception as e:
                if DEBUG_VERBOSE: print(f"\n❌ STEP 6 FAILED!")
                if DEBUG_VERBOSE: print(f"⚠️  Error: {e}")
                result["error"] = f"Campaign creation failed: {e}"
                import traceback
                if DEBUG_VERBOSE: print("\n🔍 Full Traceback:")
                traceback.print_exc()
                return result
        else:
            if DEBUG_VERBOSE: print(f"\n✅ Using auto-created campaign")
            if DEBUG_VERBOSE: print(f"🆔 Campaign ID: {campaign_id}")

        # Assign layout to campaign (only if needed)
        # Skip if layout already has its auto-created campaign
        if auto_campaign_id and auto_campaign_id == campaign_id:
            if DEBUG_VERBOSE: print(f"\n✅ Layout already assigned to its auto-created campaign")
            if DEBUG_VERBOSE: print(f"🆔 Campaign ID: {campaign_id}")
            if DEBUG_VERBOSE: print(f"ℹ️  Skipping reassignment (Xibo doesn't allow changing Layout Specific Campaigns)")
        else:
            if DEBUG_VERBOSE: print(f"\n🔗 Assigning layout to campaign...")
            if DEBUG_VERBOSE: print(f"🆔 Campaign ID: {campaign_id}")
            if DEBUG_VERBOSE: print(f"🆔 Layout ID: {original_layout_id}")
            if DEBUG_VERBOSE: print(f"🔢 Display Order: 1")
            if DEBUG_VERBOSE: print(f"🌐 API Endpoint: POST /api/campaign/layout/assign/{campaign_id}")

            try:
                if DEBUG_VERBOSE: print(f"\n📡 Calling assign_layout_to_campaign()...")
                assign_result = self.assign_layout_to_campaign(campaign_id, original_layout_id, display_order=1)
                if DEBUG_VERBOSE: print(f"\n✅ ASSIGNMENT SUCCESS!")
                if DEBUG_VERBOSE: print(f"📦 Full Response:")
                if DEBUG_VERBOSE: print(json.dumps(assign_result, indent=2, default=str))

                if DEBUG_VERBOSE: print(f"\n✅ Layout assigned to campaign")

            except Exception as e:
                error_msg = str(e).lower()
                if "cannot change the assignment" in error_msg or "layout specific campaign" in error_msg:
                    if DEBUG_VERBOSE: print(f"\n⚠️  ASSIGNMENT SKIPPED")
                    if DEBUG_VERBOSE: print(f"ℹ️  This is a Layout Specific Campaign (auto-created with layout)")
                    if DEBUG_VERBOSE: print(f"ℹ️  Xibo doesn't allow reassigning these campaigns - using auto-created campaign")
                else:
                    if DEBUG_VERBOSE: print(f"\n⚠️  ASSIGNMENT WARNING!")
                    if DEBUG_VERBOSE: print(f"⚠️  Error: {e}")
                    if DEBUG_VERBOSE: print(f"ℹ️  Layout may already be assigned to campaign")

        result["campaign_id"] = campaign_id
        result["layout_id"] = original_layout_id
        result["success"] = True

        # FINAL VERIFICATION: Ensure the layout actually exists and is published
        if DEBUG_VERBOSE: print("\n" + "▶"*40)
        if DEBUG_VERBOSE: print("🔍 FINAL VERIFICATION")
        if DEBUG_VERBOSE: print("▶"*40)
        try:
            final_layout = self.get_layout_by_id(original_layout_id)
            final_status = final_layout.get("publishedStatusId")
            final_name = final_layout.get("layout")

            if DEBUG_VERBOSE: print(f"✅ Layout {original_layout_id} EXISTS in Xibo")
            if DEBUG_VERBOSE: print(f"   Name: {final_name}")
            if DEBUG_VERBOSE: print(f"   publishedStatusId: {final_status}")

            if final_status == 1:
                if DEBUG_VERBOSE: print(f"✅ Layout is PUBLISHED and ready for scheduling")
            elif final_status == 2:
                if DEBUG_VERBOSE: print(f"⚠️  WARNING: Layout is still a DRAFT!")
                result["warnings"].append(f"Layout {original_layout_id} is a draft, not published")
            else:
                if DEBUG_VERBOSE: print(f"⚠️  WARNING: Unknown status {final_status}")
                result["warnings"].append(f"Layout {original_layout_id} has unknown status {final_status}")

        except Exception as verify_error:
            if DEBUG_VERBOSE: print(f"❌ CRITICAL: Layout {original_layout_id} DOES NOT EXIST!")
            if DEBUG_VERBOSE: print(f"❌ Error: {verify_error}")
            result["error"] = f"Layout {original_layout_id} was created but cannot be found in Xibo"
            result["success"] = False
            result["warnings"].append(f"Final verification failed: {verify_error}")

        if DEBUG_VERBOSE: print("\n" + "="*80)
        if DEBUG_VERBOSE: print("🎉 WORKFLOW COMPLETE!")
        if DEBUG_VERBOSE: print("="*80)
        if DEBUG_VERBOSE: print(f"✅ Success: {result['success']}")
        if DEBUG_VERBOSE: print(f"🆔 Layout ID: {original_layout_id}")
        if DEBUG_VERBOSE: print(f"🆔 Campaign ID: {campaign_id}")
        if DEBUG_VERBOSE: print(f"🆔 Media ID: {media_id}")
        if result["warnings"]:
            if DEBUG_VERBOSE: print(f"\n⚠️  Warnings ({len(result['warnings'])}):")
            for i, warning in enumerate(result["warnings"], 1):
                if DEBUG_VERBOSE: print(f"   {i}. {warning}")
        if DEBUG_VERBOSE: print("="*80 + "\n")

        return result

    def create_full_schedule(
        self,
        display_group_ids: List[int],
        campaign_id: int,
        from_dt: str,
        to_dt: str,
        display_order: int = 1,
        is_priority: int = 0
    ) -> Dict:
        """
        Create a schedule for a campaign on display groups

        Args:
            display_group_ids: List of display group IDs
            campaign_id: Campaign ID to schedule
            from_dt: Start datetime (Y-m-d H:i:s format)
            to_dt: End datetime (Y-m-d H:i:s format)
            display_order: Display order
            is_priority: Priority flag

        Returns:
            Schedule event details
        """
        return self.create_schedule(
            event_type_id=1,  # Layout/Campaign event
            display_group_ids=display_group_ids,
            from_dt=from_dt,
            to_dt=to_dt,
            campaign_id=campaign_id,
            displayOrder=display_order,
            isPriority=is_priority
        )

    # ============ UTILITY ENDPOINTS ============

    def get_cms_time(self) -> Dict:
        """Get current CMS server time"""
        return self._make_request("GET", "/clock")

    def test_connection(self) -> Dict:
        """Test connection to Xibo CMS"""
        try:
            time_data = self.get_cms_time()
            return {
                "connected": True,
                "server_time": time_data.get("time"),
                "base_url": self.base_url
            }
        except Exception as e:
            return {
                "connected": False,
                "error": str(e),
                "base_url": self.base_url
            }


# Singleton instance
xibo_service = XiboService()
