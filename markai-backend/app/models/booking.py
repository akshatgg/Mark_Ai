from datetime import datetime
from typing import Optional, List, Dict
from bson import ObjectId


class Booking:
    """Booking model for screen advertisement bookings"""

    # Booking statuses
    STATUS_PENDING = "pending"
    STATUS_PAYMENT_PENDING = "payment_pending"
    STATUS_PAID = "paid"
    STATUS_AWAITING_OWNER_APPROVAL = "awaiting_owner_approval"
    STATUS_OWNER_APPROVED = "owner_approved"
    STATUS_OWNER_REJECTED = "owner_rejected"
    STATUS_APPROVED = "approved"
    STATUS_REJECTED = "rejected"
    STATUS_SCHEDULED = "scheduled"
    STATUS_LIVE = "live"
    STATUS_COMPLETED = "completed"
    STATUS_CANCELLED = "cancelled"

    def __init__(
        self,
        advertiser_id: str,
        screen_id: str,
        screen_name: str,
        # Booking dates
        start_date: datetime,
        end_date: datetime,
        # Media/Creative
        media_url: Optional[str] = None,
        media_type: Optional[str] = None,  # "image" or "video"
        cloudinary_public_id: Optional[str] = None,
        # Pricing
        base_amount: float = 0,  # Amount before GST
        gst_amount: float = 0,  # GST amount (18%)
        total_amount: float = 0,  # Total amount (base + GST)
        currency: str = "INR",
        # GST Details
        gst_enabled: bool = False,
        gstin: Optional[str] = None,  # GST Identification Number
        gst_company_name: Optional[str] = None,
        gst_address: Optional[str] = None,
        gst_city: Optional[str] = None,
        gst_state: Optional[str] = None,
        gst_pincode: Optional[str] = None,
        # Payment
        payment_status: str = "pending",
        razorpay_order_id: Optional[str] = None,
        razorpay_payment_id: Optional[str] = None,
        razorpay_signature: Optional[str] = None,
        # Screenox integration
        xibo_display_id: Optional[int] = None,
        xibo_display_group_id: Optional[int] = None,
        xibo_schedule_id: Optional[int] = None,
        xibo_schedule_ids: Optional[List[int]] = None,  # Multiple schedule IDs for individual slots
        xibo_campaign_id: Optional[int] = None,
        xibo_layout_id: Optional[int] = None,
        xibo_media_id: Optional[int] = None,
        # Individual time slots for separate schedules
        time_slots: Optional[List[Dict[str, str]]] = None,  # [{start: "ISO", end: "ISO", screenId: "..."}, ...]
        # NEW: Screen slots mapping - each screen with its own slots
        screen_slots: Optional[List[Dict]] = None,  # [{screen_id, screen_name, xibo_display_id, xibo_display_group_id, time_slots: [...]}]
        # Multi-screen booking
        booking_type: str = "single",  # "single" or "multi_screen"
        screens: Optional[List[Dict]] = None,  # Array of screen data for multi-screen bookings
        booking_group_id: Optional[str] = None,  # Links multi-screen bookings together
        is_primary_booking: bool = True,  # True for first booking in group
        # Screenox Schedule Settings
        schedule_recurrence_type: Optional[str] = None,  # None, "Day", "Week", "Month"
        schedule_recurrence_detail: Optional[int] = None,  # e.g., 2 = every 2 days/weeks
        schedule_recurrence_range: Optional[datetime] = None,  # End date for recurrence
        schedule_recurrence_repeats_on: Optional[str] = None,  # "Mon,Tue,Wed" for weekly
        schedule_day_part_id: Optional[int] = None,  # Day part for time restrictions
        schedule_is_priority: int = 0,  # 1 = priority, 0 = normal
        # Screen Owner Approval
        screen_owner_id: Optional[str] = None,
        screen_owner_approval: str = "pending",  # "pending", "approved", "rejected"
        screen_owner_approved_by: Optional[str] = None,
        screen_owner_approved_at: Optional[datetime] = None,
        screen_owner_rejection_reason: Optional[str] = None,
        # Admin Approval
        status: str = STATUS_PENDING,
        approved_by: Optional[str] = None,
        approved_at: Optional[datetime] = None,
        rejection_reason: Optional[str] = None,
        # Campaign Details
        campaign_name: Optional[str] = None,  # Campaign/Objective name for layout naming
        business_name: Optional[str] = None,  # Business name from booking form
        # Invoice
        invoice_url: Optional[str] = None,  # URL to generated tax invoice PDF
        invoice_generated_at: Optional[datetime] = None,  # When invoice was generated
        # Metadata
        notes: Optional[str] = None,
        _id: Optional[ObjectId] = None,
        created_at: Optional[datetime] = None,
        updated_at: Optional[datetime] = None
    ):
        self._id = _id or ObjectId()
        self.advertiser_id = advertiser_id
        self.screen_id = screen_id
        self.screen_name = screen_name
        self.start_date = start_date
        self.end_date = end_date
        self.media_url = media_url
        self.media_type = media_type
        self.cloudinary_public_id = cloudinary_public_id
        self.base_amount = base_amount
        self.gst_amount = gst_amount
        self.total_amount = total_amount
        self.currency = currency
        # GST Details
        self.gst_enabled = gst_enabled
        self.gstin = gstin
        self.gst_company_name = gst_company_name
        self.gst_address = gst_address
        self.gst_city = gst_city
        self.gst_state = gst_state
        self.gst_pincode = gst_pincode
        self.payment_status = payment_status
        self.razorpay_order_id = razorpay_order_id
        self.razorpay_payment_id = razorpay_payment_id
        self.razorpay_signature = razorpay_signature
        self.xibo_display_id = xibo_display_id
        self.xibo_display_group_id = xibo_display_group_id
        self.xibo_schedule_id = xibo_schedule_id
        self.xibo_schedule_ids = xibo_schedule_ids or []
        self.xibo_campaign_id = xibo_campaign_id
        self.xibo_layout_id = xibo_layout_id
        self.xibo_media_id = xibo_media_id
        self.time_slots = time_slots or []
        self.screen_slots = screen_slots or []  # NEW: Screen slots mapping
        # Multi-screen booking
        self.booking_type = booking_type
        self.screens = screens or []
        self.booking_group_id = booking_group_id
        self.is_primary_booking = is_primary_booking
        # Screenox Schedule Settings
        self.schedule_recurrence_type = schedule_recurrence_type
        self.schedule_recurrence_detail = schedule_recurrence_detail
        self.schedule_recurrence_range = schedule_recurrence_range
        self.schedule_recurrence_repeats_on = schedule_recurrence_repeats_on
        self.schedule_day_part_id = schedule_day_part_id
        self.schedule_is_priority = schedule_is_priority
        # Screen Owner Approval
        self.screen_owner_id = screen_owner_id
        self.screen_owner_approval = screen_owner_approval
        self.screen_owner_approved_by = screen_owner_approved_by
        self.screen_owner_approved_at = screen_owner_approved_at
        self.screen_owner_rejection_reason = screen_owner_rejection_reason
        # Admin Approval
        self.status = status
        self.approved_by = approved_by
        self.approved_at = approved_at
        self.rejection_reason = rejection_reason
        self.campaign_name = campaign_name
        self.business_name = business_name
        self.invoice_url = invoice_url
        self.invoice_generated_at = invoice_generated_at
        self.notes = notes
        self.created_at = created_at or datetime.utcnow()
        self.updated_at = updated_at or datetime.utcnow()

    def to_dict(self, for_db: bool = False, hide_sensitive: bool = False) -> dict:
        """Convert booking to dictionary

        Args:
            for_db: If True, use datetime objects and ObjectId for MongoDB
            hide_sensitive: If True, hide GST and payment details (for screen owners)
        """
        data = {
            "_id": self._id if for_db else str(self._id),
            "screen_id": self.screen_id,
            "screen_name": self.screen_name,
            "start_date": self.start_date if for_db else self.start_date.isoformat() if self.start_date else None,
            "end_date": self.end_date if for_db else self.end_date.isoformat() if self.end_date else None,
            "media_url": self.media_url,
            "media_type": self.media_type,
            "cloudinary_public_id": self.cloudinary_public_id,
            "currency": self.currency,
            "payment_status": self.payment_status,
            "xibo_display_id": self.xibo_display_id,
            "xibo_display_group_id": self.xibo_display_group_id,
            "xibo_schedule_id": self.xibo_schedule_id,
            "xibo_schedule_ids": self.xibo_schedule_ids,
            "xibo_campaign_id": self.xibo_campaign_id,
            "xibo_layout_id": self.xibo_layout_id,
            "xibo_media_id": self.xibo_media_id,
            "time_slots": self.time_slots,
            "screen_slots": self.screen_slots,  # NEW: Screen slots mapping
            # Multi-screen booking
            "booking_type": self.booking_type,
            "screens": self.screens,
            "booking_group_id": self.booking_group_id,
            "is_primary_booking": self.is_primary_booking,
            # Screenox Schedule Settings
            "schedule_recurrence_type": self.schedule_recurrence_type,
            "schedule_recurrence_detail": self.schedule_recurrence_detail,
            "schedule_recurrence_range": self.schedule_recurrence_range if for_db else self.schedule_recurrence_range.isoformat() if self.schedule_recurrence_range else None,
            "schedule_recurrence_repeats_on": self.schedule_recurrence_repeats_on,
            "schedule_day_part_id": self.schedule_day_part_id,
            "schedule_is_priority": self.schedule_is_priority,
            # Screen Owner Approval
            "screen_owner_id": self.screen_owner_id,
            "screen_owner_approval": self.screen_owner_approval,
            "screen_owner_approved_by": self.screen_owner_approved_by,
            "screen_owner_approved_at": self.screen_owner_approved_at if for_db else self.screen_owner_approved_at.isoformat() if self.screen_owner_approved_at else None,
            "screen_owner_rejection_reason": self.screen_owner_rejection_reason,
            # Admin Approval
            "status": self.status,
            "approved_by": self.approved_by,
            "approved_at": self.approved_at if for_db else self.approved_at.isoformat() if self.approved_at else None,
            "rejection_reason": self.rejection_reason,
            "campaign_name": self.campaign_name,
            "notes": self.notes,
            "created_at": self.created_at if for_db else self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at if for_db else self.updated_at.isoformat() if self.updated_at else None
        }

        # Add sensitive fields only if not hidden (for admins and advertisers only)
        if not hide_sensitive:
            data.update({
                # Advertiser Identity
                "advertiser_id": self.advertiser_id,
                "business_name": self.business_name,
                # Pricing Details
                "base_amount": self.base_amount,
                "gst_amount": self.gst_amount,
                "total_amount": self.total_amount,
                # Invoice Details
                "invoice_url": self.invoice_url,
                "invoice_generated_at": self.invoice_generated_at if for_db else self.invoice_generated_at.isoformat() if self.invoice_generated_at else None,
                # GST Details
                "gst_enabled": self.gst_enabled,
                "gstin": self.gstin,
                "gst_company_name": self.gst_company_name,
                "gst_address": self.gst_address,
                "gst_city": self.gst_city,
                "gst_state": self.gst_state,
                "gst_pincode": self.gst_pincode,
                # Payment Gateway Details
                "razorpay_order_id": self.razorpay_order_id,
                "razorpay_payment_id": self.razorpay_payment_id,
                "razorpay_signature": self.razorpay_signature,
            })

        return data

    @staticmethod
    def from_dict(data: dict) -> 'Booking':
        """Create Booking instance from dictionary"""
        booking_id = data.get("_id")
        if booking_id and not isinstance(booking_id, ObjectId):
            try:
                booking_id = ObjectId(booking_id)
            except:
                booking_id = None

        # Parse dates
        def parse_date(val):
            if val is None:
                return None
            if isinstance(val, datetime):
                return val
            try:
                return datetime.fromisoformat(val.replace('Z', '+00:00'))
            except:
                return None

        return Booking(
            _id=booking_id,
            advertiser_id=data.get("advertiser_id", ""),
            screen_id=data.get("screen_id", ""),
            screen_name=data.get("screen_name", ""),
            start_date=parse_date(data.get("start_date")),
            end_date=parse_date(data.get("end_date")),
            media_url=data.get("media_url"),
            media_type=data.get("media_type"),
            cloudinary_public_id=data.get("cloudinary_public_id"),
            base_amount=data.get("base_amount", 0),
            gst_amount=data.get("gst_amount", 0),
            total_amount=data.get("total_amount", 0),
            currency=data.get("currency", "INR"),
            # GST Details
            gst_enabled=data.get("gst_enabled", False),
            gstin=data.get("gstin"),
            gst_company_name=data.get("gst_company_name"),
            gst_address=data.get("gst_address"),
            gst_city=data.get("gst_city"),
            gst_state=data.get("gst_state"),
            gst_pincode=data.get("gst_pincode"),
            payment_status=data.get("payment_status", "pending"),
            razorpay_order_id=data.get("razorpay_order_id"),
            razorpay_payment_id=data.get("razorpay_payment_id"),
            razorpay_signature=data.get("razorpay_signature"),
            xibo_display_id=data.get("xibo_display_id"),
            xibo_display_group_id=data.get("xibo_display_group_id"),
            xibo_schedule_id=data.get("xibo_schedule_id"),
            xibo_schedule_ids=data.get("xibo_schedule_ids", []),
            xibo_campaign_id=data.get("xibo_campaign_id"),
            xibo_layout_id=data.get("xibo_layout_id"),
            xibo_media_id=data.get("xibo_media_id"),
            time_slots=data.get("time_slots", []),
            screen_slots=data.get("screen_slots", []),  # NEW: Screen slots mapping
            # Multi-screen booking
            booking_type=data.get("booking_type", "single"),
            screens=data.get("screens", []),
            booking_group_id=data.get("booking_group_id"),
            is_primary_booking=data.get("is_primary_booking", True),
            # Screenox Schedule Settings
            schedule_recurrence_type=data.get("schedule_recurrence_type"),
            schedule_recurrence_detail=data.get("schedule_recurrence_detail"),
            schedule_recurrence_range=parse_date(data.get("schedule_recurrence_range")),
            schedule_recurrence_repeats_on=data.get("schedule_recurrence_repeats_on"),
            schedule_day_part_id=data.get("schedule_day_part_id"),
            schedule_is_priority=data.get("schedule_is_priority", 0),
            # Screen Owner Approval
            screen_owner_id=data.get("screen_owner_id"),
            screen_owner_approval=data.get("screen_owner_approval", "pending"),
            screen_owner_approved_by=data.get("screen_owner_approved_by"),
            screen_owner_approved_at=parse_date(data.get("screen_owner_approved_at")),
            screen_owner_rejection_reason=data.get("screen_owner_rejection_reason"),
            # Admin Approval
            status=data.get("status", "pending"),
            approved_by=data.get("approved_by"),
            approved_at=parse_date(data.get("approved_at")),
            rejection_reason=data.get("rejection_reason"),
            campaign_name=data.get("campaign_name"),
            business_name=data.get("business_name"),
            invoice_url=data.get("invoice_url"),
            invoice_generated_at=parse_date(data.get("invoice_generated_at")),
            notes=data.get("notes"),
            created_at=parse_date(data.get("created_at")),
            updated_at=parse_date(data.get("updated_at"))
        )
