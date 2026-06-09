from fastapi import APIRouter, Request, HTTPException, Depends, status
from fastapi.responses import JSONResponse
from datetime import datetime, timedelta, timezone
from bson import ObjectId
import razorpay
import hmac
import hashlib
import os
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

from app.models.booking import Booking
from app.services.xibo_service import xibo_service
from app.services.booking_service import booking_service
import app.config.db

router = APIRouter(prefix="/api/bookings", tags=["bookings"])

# Razorpay client initialization
RAZORPAY_KEY_ID = os.getenv('RAZORPAY_KEY_ID', '')
RAZORPAY_KEY_SECRET = os.getenv('RAZORPAY_KEY_SECRET', '')

razorpay_client = None
if RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET:
    razorpay_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))


# ============ PYDANTIC MODELS ============

class GSTValidationRequest(BaseModel):
    gstin: str = ""
    gstCompanyName: str = ""
    gstAddress: str = ""
    gstCity: str = ""
    gstState: str = ""
    gstPincode: str = ""


class ScreenData(BaseModel):
    screenId: str
    screenName: Optional[str] = None
    xiboDisplayId: Optional[Any] = None
    xiboDisplayGroupId: Optional[Any] = None
    selectedSlots: List[str] = []


class CreateBookingRequest(BaseModel):
    bookingType: str = 'single'
    screens: Optional[List[ScreenData]] = None
    screen_id: Optional[str] = None
    screen_name: Optional[str] = None
    start_date: str
    end_date: str
    total_amount: float
    base_amount: Optional[float] = None
    media_url: Optional[str] = None
    media_type: Optional[str] = None
    cloudinary_public_id: Optional[str] = None
    currency: str = 'INR'
    gstin: Optional[str] = None
    gst_company_name: Optional[str] = None
    gstCompanyName: Optional[str] = None
    gst_address: Optional[str] = None
    gstAddress: Optional[str] = None
    gst_city: Optional[str] = None
    gstCity: Optional[str] = None
    gst_state: Optional[str] = None
    gstState: Optional[str] = None
    gst_pincode: Optional[str] = None
    gstPincode: Optional[str] = None
    xibo_display_id: Optional[Any] = None
    xibo_display_group_id: Optional[Any] = None
    time_slots: Optional[List[Dict[str, Any]]] = None
    schedule_recurrence_type: Optional[str] = None
    schedule_recurrence_detail: Optional[str] = None
    schedule_recurrence_range: Optional[str] = None
    schedule_recurrence_repeats_on: Optional[List[str]] = None
    schedule_day_part_id: Optional[int] = None
    schedule_is_priority: int = 0
    campaign_name: Optional[str] = None
    campaignName: Optional[str] = None
    objective: Optional[str] = None
    business_name: Optional[str] = None
    businessName: Optional[str] = None
    notes: Optional[str] = None


class VerifyPaymentRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str
    booking_id: str


class RejectBookingRequest(BaseModel):
    reason: str = ""


class EditScheduleRequest(BaseModel):
    start_date: str
    end_date: str


class CreateScheduleRequest(BaseModel):
    layout_id: Optional[int] = None
    campaign_id: Optional[int] = None


class UpdateCreativeRequest(BaseModel):
    """Request model for updating/replacing booking creative (media)"""
    media_url: str
    media_type: Optional[str] = None  # "image" or "video"
    cloudinary_public_id: Optional[str] = None


# ============ DEPENDENCIES ============

def get_db():
    """Get database instance"""
    database = app.config.db.db
    if database is None:
        raise RuntimeError("Database not initialized")
    return database


async def verify_token(request: Request) -> dict:
    """Verify JWT token from request header"""
    from app.services.auth_service import AuthService
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required"
        )
    token = auth_header.split(' ')[1]
    token_payload = AuthService.verify_jwt_token(token)
    if not token_payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token"
        )
    return token_payload


# ============ GST VALIDATION ============

@router.post('/validate-gst')
async def validate_gst(data: GSTValidationRequest):
    """Validate GST details"""
    from app.utils.gst_validator import validate_gst_details, get_state_from_gstin

    try:
        # Prepare GST data for validation
        gst_data = {
            'gstin': data.gstin or '',
            'gst_company_name': data.gstCompanyName or '',
            'gst_address': data.gstAddress or '',
            'gst_city': data.gstCity or '',
            'gst_state': data.gstState or '',
            'gst_pincode': data.gstPincode or ''
        }

        # Validate GST details
        validation_result = validate_gst_details(gst_data)

        # Get state from GSTIN for frontend use
        gstin_state = ""
        if gst_data['gstin']:
            gstin_state = get_state_from_gstin(gst_data['gstin'])

        return {
            'valid': validation_result['valid'],
            'errors': validation_result['errors'],
            'warnings': validation_result['warnings'],
            'gstin_state': gstin_state
        }

    except Exception as e:
        print(f"[GST Validation] Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ============ BOOKING CRUD ============

@router.post('')
async def create_booking(
    request: Request,
    data: CreateBookingRequest,
    token_payload: dict = Depends(verify_token)
):
    """Create a new booking and generate Razorpay order"""
    try:
        # Check booking type
        booking_type = data.bookingType

        # Validate required fields based on booking type
        if booking_type == 'multi_screen':
            if not data.screens or len(data.screens) == 0:
                raise HTTPException(
                    status_code=400,
                    detail="At least one screen is required for multi-screen booking"
                )
        else:
            # Single screen booking (legacy)
            if not all([data.screen_id, data.screen_name, data.start_date, data.end_date, data.total_amount]):
                raise HTTPException(
                    status_code=400,
                    detail="Missing required fields for single screen booking"
                )

        # Parse dates
        try:
            start_date = datetime.fromisoformat(data.start_date.replace('Z', '+00:00'))
            end_date = datetime.fromisoformat(data.end_date.replace('Z', '+00:00'))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid date format: {str(e)}")

        # CAPACITY VALIDATION DISABLED FOR PERFORMANCE
        # Previous implementation made 1 API call per slot (84 calls for 1 week booking)
        # Causing severe delays during payment initialization
        # Capacity should be checked in real-time on frontend during slot selection
        # Backend validation is skipped to ensure fast payment flow

        # GST Calculation (18%) - ALWAYS APPLIED - MUST BE BEFORE RAZORPAY ORDER
        base_amount = float(data.base_amount or data.total_amount)
        gst_amount = round(base_amount * 0.18, 2)  # 18% GST always applied
        total_amount_with_gst = round(base_amount + gst_amount, 2)

        # Check if user provided GST details (optional, for tax invoice)
        has_gst_details = bool(data.gstin)

        # Logging disabled for performance
        # print(f"[Booking Creation] Base: ₹{base_amount}, GST (18%): ₹{gst_amount}, Total: ₹{total_amount_with_gst}")
        # if has_gst_details:
        #     print(f"[Booking Creation] GST Details provided - GSTIN: {data.gstin}")

        # Validate GST details if provided
        if has_gst_details:
            from app.utils.gst_validator import validate_gst_details
            gst_data = {
                'gstin': data.gstin or '',
                'gst_company_name': data.gst_company_name or data.gstCompanyName or '',
                'gst_address': data.gst_address or data.gstAddress or '',
                'gst_city': data.gst_city or data.gstCity or '',
                'gst_state': data.gst_state or data.gstState or '',
                'gst_pincode': data.gst_pincode or data.gstPincode or ''
            }

            validation_result = validate_gst_details(gst_data)
            if not validation_result['valid']:
                error_msg = '; '.join(validation_result['errors'])
                # print(f"[Booking Creation] GST Validation Failed: {error_msg}")
                raise HTTPException(
                    status_code=400,
                    detail={
                        'error': 'Invalid GST details',
                        'validation_errors': validation_result['errors']
                    }
                )

        # Create Razorpay order with GST included
        razorpay_order = None
        if razorpay_client:
            try:
                amount_in_paise = int(total_amount_with_gst * 100)  # Use GST-inclusive amount
                razorpay_order = razorpay_client.order.create({
                    "amount": amount_in_paise,
                    "currency": data.currency,
                    "receipt": f"booking_{datetime.utcnow().timestamp()}",
                    "notes": {
                        "screen_id": data.screen_id or 'multi_screen',
                        "advertiser_id": token_payload.get('user_id'),
                        "booking_type": data.bookingType,
                        "gst_included": "true",
                        "base_amount": str(base_amount),
                        "gst_amount": str(gst_amount),
                        "has_gst_details": str(has_gst_details)
                    }
                })
                # print(f"[Razorpay] Order created: {razorpay_order['id']}, Amount: ₹{total_amount_with_gst} (₹{amount_in_paise} paise)")
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Failed to create payment order: {str(e)}")

        # Parse recurrence range if provided
        schedule_recurrence_range = None
        if data.schedule_recurrence_range:
            try:
                schedule_recurrence_range = datetime.fromisoformat(data.schedule_recurrence_range.replace('Z', '+00:00'))
            except:
                pass

        # Get campaign details (logging disabled for performance)
        campaign_name = data.campaign_name or data.objective or data.campaignName
        business_name = data.business_name or data.businessName
        # print(f"[Booking Creation] Campaign Name: {campaign_name}, Business Name: {business_name}")

        # Create booking based on type
        if booking_type == 'multi_screen':
            # NEW: Create separate booking documents for each screen, linked by booking_group_id
            import uuid
            booking_group_id = str(uuid.uuid4())
            created_bookings = []
            database = get_db()

            total_screens = len(data.screens or [])
            # Split amounts evenly across screens
            base_amount_per_screen = round(base_amount / total_screens, 2) if total_screens > 0 else 0
            gst_amount_per_screen = round(gst_amount / total_screens, 2) if total_screens > 0 else 0
            amount_per_screen = round(total_amount_with_gst / total_screens, 2) if total_screens > 0 else 0

            for idx, screen_data in enumerate(data.screens or []):
                screen_id = screen_data.screenId
                screen_name = screen_data.screenName
                xibo_display_id = screen_data.xiboDisplayId
                xibo_display_group_id = screen_data.xiboDisplayGroupId
                selected_slots = screen_data.selectedSlots or []

                # Fetch screen data from database for missing fields
                screen_doc = None
                if not screen_name or screen_name.lower() in ['screen', 'unknown', ''] or not xibo_display_id or not xibo_display_group_id:
                    try:
                        if ObjectId.is_valid(screen_id):
                            screen_doc = database.screens.find_one({"_id": ObjectId(screen_id)})
                        if not screen_doc:
                            screen_doc = database.screens.find_one({
                                "xibo_display_id": int(screen_id) if str(screen_id).isdigit() else screen_id
                            })

                        if screen_doc:
                            # Fetch missing fields from database
                            if not screen_name or screen_name.lower() in ['screen', 'unknown', '']:
                                screen_name = screen_doc.get('name') or screen_doc.get('screen_name') or f"Screen {screen_id[-8:]}"
                            if not xibo_display_id:
                                xibo_display_id = screen_doc.get('xibo_display_id')
                            if not xibo_display_group_id:
                                xibo_display_group_id = screen_doc.get('xibo_display_group_id')
                        else:
                            screen_name = screen_name or f"Screen {screen_id[-8:]}"
                    except Exception as e:
                        # print(f"Error fetching screen data from database: {e}")
                        screen_name = screen_name or f"Screen {screen_id[-8:]}"

                # Parse time slots for this specific screen
                time_slots = []
                # IST timezone offset (UTC+5:30) - used for converting frontend local dates
                IST_OFFSET = timedelta(hours=5, minutes=30)

                for slot_id in selected_slots:
                    try:
                        # Parse slot_id format: "2026-01-14T18:30:00.000Z-13"
                        last_hyphen_index = slot_id.rfind('-')
                        if last_hyphen_index == -1:
                            continue

                        date_iso_part = slot_id[:last_hyphen_index]
                        hour_part = int(slot_id[last_hyphen_index + 1:])

                        # Parse base_date in UTC
                        base_date_utc = datetime.fromisoformat(date_iso_part.replace('Z', '+00:00'))

                        # Convert to local time (IST) to get the correct LOCAL date
                        local_datetime = base_date_utc + IST_OFFSET

                        # Create slot start in local time with the user-selected hour
                        slot_start_local = local_datetime.replace(
                            hour=hour_part, minute=0, second=0, microsecond=0
                        )

                        # Calculate slot end in local time
                        if hour_part == 23:
                            slot_end_local = local_datetime.replace(
                                hour=23, minute=59, second=0, microsecond=0
                            )
                        else:
                            slot_end_local = local_datetime.replace(
                                hour=hour_part + 1, minute=0, second=0, microsecond=0
                            )

                        # Convert back to UTC for storage
                        slot_start_utc = slot_start_local - IST_OFFSET
                        slot_end_utc = slot_end_local - IST_OFFSET

                        # Ensure UTC timezone info is set
                        slot_start_utc = slot_start_utc.replace(tzinfo=timezone.utc)
                        slot_end_utc = slot_end_utc.replace(tzinfo=timezone.utc)

                        time_slots.append({
                            'start': slot_start_utc.isoformat(),
                            'end': slot_end_utc.isoformat()
                        })
                    except Exception as slot_error:
                        # print(f"Error parsing slot {slot_id}: {slot_error}")
                        continue

                # Create individual booking for this screen
                # Build screen_slots array with proper screen-to-slot mapping
                screen_slot_entry = {
                    'screen_id': screen_id,
                    'screen_name': screen_name,
                    'xibo_display_id': xibo_display_id,
                    'xibo_display_group_id': xibo_display_group_id,
                    'time_slots': time_slots
                }

                screen_booking = Booking(
                    advertiser_id=token_payload.get('user_id'),
                    screen_id=screen_id,
                    screen_name=screen_name,
                    start_date=start_date,
                    end_date=end_date,
                    media_url=data.media_url,
                    media_type=data.media_type,
                    cloudinary_public_id=data.cloudinary_public_id,
                    base_amount=base_amount_per_screen,
                    gst_amount=gst_amount_per_screen,
                    total_amount=amount_per_screen,
                    currency=data.currency,
                    # GST Details (GST always applied, details optional for tax invoice)
                    gst_enabled=True,
                    gstin=data.gstin,
                    gst_company_name=data.gst_company_name or data.gstCompanyName,
                    gst_address=data.gst_address or data.gstAddress,
                    gst_city=data.gst_city or data.gstCity,
                    gst_state=data.gst_state or data.gstState,
                    gst_pincode=data.gst_pincode or data.gstPincode,
                    payment_status='pending',
                    razorpay_order_id=razorpay_order['id'] if razorpay_order and idx == 0 else None,
                    xibo_display_id=xibo_display_id,
                    xibo_display_group_id=xibo_display_group_id,
                    booking_type='multi_screen',
                    screens=[screen_data.dict()],
                    time_slots=time_slots,
                    screen_slots=[screen_slot_entry],
                    booking_group_id=booking_group_id,
                    is_primary_booking=(idx == 0),
                    # Screenox Schedule Settings
                    schedule_recurrence_type=data.schedule_recurrence_type,
                    schedule_recurrence_detail=data.schedule_recurrence_detail,
                    schedule_recurrence_range=schedule_recurrence_range,
                    schedule_recurrence_repeats_on=data.schedule_recurrence_repeats_on,
                    schedule_day_part_id=data.schedule_day_part_id,
                    schedule_is_priority=data.schedule_is_priority,
                    status=Booking.STATUS_PAYMENT_PENDING,
                    campaign_name=campaign_name,
                    business_name=business_name,
                    notes=data.notes
                )

                # Save to database
                result = database.bookings.insert_one(screen_booking.to_dict(for_db=True))
                screen_booking._id = result.inserted_id
                created_bookings.append(screen_booking)

            # Return all created bookings
            response_data = {
                "message": "Multi-screen booking created successfully",
                "booking_group_id": booking_group_id,
                "bookings": [b.to_dict() for b in created_bookings],
                "total_bookings": len(created_bookings)
            }

            if razorpay_order:
                response_data["razorpay_order"] = {
                    "id": razorpay_order['id'],
                    "amount": razorpay_order['amount'],
                    "currency": razorpay_order['currency'],
                    "key_id": RAZORPAY_KEY_ID
                }

            return response_data

        else:
            # Single screen booking (legacy)
            screen_id = data.screen_id
            screen_name = data.screen_name

            # Fetch actual screen name from database if not provided or is generic
            if not screen_name or screen_name.lower() in ['screen', 'unknown', '']:
                try:
                    database = get_db()
                    screen_doc = None
                    if ObjectId.is_valid(screen_id):
                        screen_doc = database.screens.find_one({"_id": ObjectId(screen_id)})
                    if not screen_doc:
                        screen_doc = database.screens.find_one({
                            "xibo_display_id": int(screen_id) if str(screen_id).isdigit() else screen_id
                        })
                    if screen_doc:
                        screen_name = screen_doc.get('name') or screen_doc.get('screen_name') or f"Screen {screen_id[-8:]}"
                    else:
                        screen_name = f"Screen {screen_id[-8:]}"
                except Exception as e:
                    # print(f"Error fetching screen name: {e}")
                    screen_name = f"Screen {screen_id[-8:]}"

            booking = Booking(
                advertiser_id=token_payload.get('user_id'),
                screen_id=screen_id,
                screen_name=screen_name,
                start_date=start_date,
                end_date=end_date,
                media_url=data.media_url,
                media_type=data.media_type,
                cloudinary_public_id=data.cloudinary_public_id,
                base_amount=base_amount,
                gst_amount=gst_amount,
                total_amount=total_amount_with_gst,
                currency=data.currency,
                # GST Details (GST always applied, details optional for tax invoice)
                gst_enabled=True,
                gstin=data.gstin,
                gst_company_name=data.gst_company_name or data.gstCompanyName,
                gst_address=data.gst_address or data.gstAddress,
                gst_city=data.gst_city or data.gstCity,
                gst_state=data.gst_state or data.gstState,
                gst_pincode=data.gst_pincode or data.gstPincode,
                payment_status='pending',
                razorpay_order_id=razorpay_order['id'] if razorpay_order else None,
                xibo_display_id=data.xibo_display_id,
                xibo_display_group_id=data.xibo_display_group_id,
                booking_type='single',
                time_slots=data.time_slots or [],
                # Screenox Schedule Settings
                schedule_recurrence_type=data.schedule_recurrence_type,
                schedule_recurrence_detail=data.schedule_recurrence_detail,
                schedule_recurrence_range=schedule_recurrence_range,
                schedule_recurrence_repeats_on=data.schedule_recurrence_repeats_on,
                schedule_day_part_id=data.schedule_day_part_id,
                schedule_is_priority=data.schedule_is_priority,
                status=Booking.STATUS_PAYMENT_PENDING,
                campaign_name=campaign_name,
                business_name=business_name,
                notes=data.notes
            )

            # Save to database
            database = get_db()
            result = database.bookings.insert_one(booking.to_dict(for_db=True))
            booking._id = result.inserted_id

            response_data = {
                "message": "Booking created successfully",
                "booking": booking.to_dict(),
            }

            if razorpay_order:
                response_data["razorpay_order"] = {
                    "id": razorpay_order['id'],
                    "amount": razorpay_order['amount'],
                    "currency": razorpay_order['currency'],
                    "key_id": RAZORPAY_KEY_ID
                }

            return response_data

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/verify-payment')
async def verify_payment(
    data: VerifyPaymentRequest,
    token_payload: dict = Depends(verify_token)
):
    """Verify Razorpay payment and update booking status, generate invoice"""
    try:
        razorpay_order_id = data.razorpay_order_id
        razorpay_payment_id = data.razorpay_payment_id
        razorpay_signature = data.razorpay_signature
        booking_id = data.booking_id

        print(f"[Payment Confirmation] Processing payment for booking: {booking_id}")
        print(f"[Payment Confirmation] Order ID: {razorpay_order_id}")
        print(f"[Payment Confirmation] Payment ID: {razorpay_payment_id}")

        # Note: Payment is already verified by Razorpay on frontend
        # This endpoint updates booking status and generates invoice

        # Get the booking first to check if it's part of a group
        database = get_db()
        booking_data = database.bookings.find_one({"_id": ObjectId(booking_id)})
        if not booking_data:
            raise HTTPException(status_code=404, detail="Booking not found")

        booking_group_id = booking_data.get('booking_group_id')

        # Build update query - if group booking, update all bookings in the group
        if booking_group_id:
            update_query = {"booking_group_id": booking_group_id}
        else:
            update_query = {"_id": ObjectId(booking_id)}

        # Update booking(s) - use update_many to update all linked bookings
        result = database.bookings.update_many(
            update_query,
            {
                "$set": {
                    "payment_status": "paid",
                    "razorpay_payment_id": razorpay_payment_id,
                    "razorpay_signature": razorpay_signature,
                    "status": Booking.STATUS_PAID,
                    "updated_at": datetime.utcnow()
                }
            }
        )

        if result.modified_count == 0:
            raise HTTPException(status_code=404, detail="No bookings updated")

        # Get updated booking (primary)
        booking_data = database.bookings.find_one({"_id": ObjectId(booking_id)})
        booking = Booking.from_dict(booking_data)

        # Send email notification to screen owner(s)
        try:
            from app.services.email_service import EmailService
            from app.services.booking_service import BookingService

            # Get all screen owners for this booking (handles multi-screen)
            screen_owner_ids = BookingService.get_all_screen_owners_for_booking(booking, database)

            for owner_id in screen_owner_ids:
                # Get owner details
                owner_data = database.users.find_one({"_id": ObjectId(owner_id)})
                if owner_data and owner_data.get('email'):
                    owner_email = owner_data.get('email')
                    owner_name = owner_data.get('full_name', 'Screen Owner')

                    # Prepare booking data for email
                    email_booking_data = {
                        'booking_id': str(booking._id),
                        'screen_name': booking.screen_name,
                        'start_date': booking.start_date.isoformat() if booking.start_date else '',
                        'end_date': booking.end_date.isoformat() if booking.end_date else '',
                        'status': booking.status,
                        'payment_status': booking.payment_status,
                        'total_amount': booking.total_amount,
                        'currency': booking.currency,
                        'time_slots': [{'start': slot.get('start'), 'end': slot.get('end')} for slot in (booking.time_slots or [])]
                    }

                    # Send email (non-blocking - errors won't stop the payment flow)
                    EmailService.send_booking_notification_to_owner(
                        owner_email,
                        owner_name,
                        email_booking_data
                    )
                    print(f"Booking notification email sent to {owner_email}")
        except Exception as email_error:
            # Log email error but don't fail the payment verification
            print(f"Error sending booking notification email: {str(email_error)}")

        # Generate and upload invoice PDF
        try:
            from app.services.invoice_service import invoice_service

            # Prepare booking data for invoice
            invoice_booking_data = booking_data.copy()
            invoice_booking_data['_id'] = booking_id

            # Generate and upload invoice
            invoice_url = await invoice_service.generate_and_upload_invoice(invoice_booking_data)

            if invoice_url:
                # Update booking with invoice URL
                database.bookings.update_many(
                    update_query,
                    {
                        "$set": {
                            "invoice_url": invoice_url,
                            "invoice_generated_at": datetime.utcnow()
                        }
                    }
                )
                print(f"[Booking] Invoice generated and saved: {invoice_url}")
            else:
                print("[Booking] WARNING: Invoice generation failed, but payment is verified")

        except Exception as invoice_error:
            # Log invoice error but don't fail the payment verification
            print(f"[Booking] Error generating invoice: {str(invoice_error)}")
            import traceback
            traceback.print_exc()

        # Get final booking data with invoice URL
        booking_data = database.bookings.find_one({"_id": ObjectId(booking_id)})
        booking = Booking.from_dict(booking_data)
        invoice_url = booking_data.get('invoice_url')

        # Send booking confirmation email to CUSTOMER (advertiser)
        try:
            from app.services.email_service import EmailService

            # Get customer (advertiser) details
            customer_data = database.users.find_one({"_id": ObjectId(booking.advertiser_id)})
            if customer_data and customer_data.get('email'):
                customer_email = customer_data.get('email')
                customer_name = customer_data.get('full_name', 'Customer')

                # Prepare booking data for customer email
                customer_booking_data = {
                    'booking_id': str(booking._id),
                    'screen_name': booking.screen_name,
                    'start_date': booking.start_date.isoformat() if booking.start_date else '',
                    'end_date': booking.end_date.isoformat() if booking.end_date else '',
                    'total_amount': booking.total_amount,
                    'payment_status': booking.payment_status,
                    'status': booking.status
                }

                # Send confirmation email with invoice link
                EmailService.send_booking_confirmation_to_customer(
                    customer_email,
                    customer_name,
                    customer_booking_data,
                    invoice_url
                )
                print(f"[Booking] Confirmation email sent to customer: {customer_email}")

        except Exception as customer_email_error:
            # Log email error but don't fail the payment verification
            print(f"[Booking] Error sending customer confirmation email: {str(customer_email_error)}")

        return {
            "message": "Payment verified successfully",
            "booking": booking.to_dict(),
            "invoice_url": invoice_url
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[Payment Verification] ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/{booking_id}/approve')
async def approve_booking(
    booking_id: str,
    token_payload: dict = Depends(verify_token)
):
    """Approve booking and create schedule in Screenox CMS (Admin or Screen Owner)"""
    try:
        database = get_db()
        user_id = token_payload.get('user_id')

        # Check if user is admin or screen owner
        user = database.users.find_one({"_id": ObjectId(user_id)})
        is_admin = user.get('is_admin', False) if user else False
        is_screen_owner = user.get('is_screen_owner', False) if user else False

        if not is_admin and not is_screen_owner:
            raise HTTPException(
                status_code=403,
                detail="Only admin or screen owner can perform final approval"
            )

        # Get booking
        booking_data = database.bookings.find_one({"_id": ObjectId(booking_id)})
        if not booking_data:
            raise HTTPException(status_code=404, detail="Booking not found")

        booking = Booking.from_dict(booking_data)

        # If screen owner (not admin), verify they own this screen
        if not is_admin:
            # Get screen to verify ownership
            screen_data_for_auth = None
            if ObjectId.is_valid(booking.screen_id):
                screen_data_for_auth = database.screens.find_one({"_id": ObjectId(booking.screen_id)})
            if not screen_data_for_auth and booking.screen_id:
                if str(booking.screen_id).isdigit():
                    screen_data_for_auth = database.screens.find_one({"xibo_display_id": int(booking.screen_id)})
                else:
                    screen_data_for_auth = database.screens.find_one({"xibo_display_id": booking.screen_id})

            if not screen_data_for_auth:
                raise HTTPException(status_code=404, detail="Screen not found")

            screen_owner_id = screen_data_for_auth.get('screen_owner_id')
            if screen_owner_id != user_id:
                raise HTTPException(
                    status_code=403,
                    detail="You are not authorized to approve bookings for this screen"
                )

        # Check if payment is completed
        if booking.payment_status != "paid":
            raise HTTPException(status_code=400, detail="Payment not completed")

        # Check if already scheduled with active schedules
        has_schedules_in_db = bool(booking.xibo_schedule_id or (booking.xibo_schedule_ids and len(booking.xibo_schedule_ids) > 0))

        if booking.status == Booking.STATUS_SCHEDULED and has_schedules_in_db:
            # Verify at least one schedule actually exists in Screenox
            schedule_exists_in_screenox = False
            schedule_ids_to_check = booking.xibo_schedule_ids or []
            if booking.xibo_schedule_id and booking.xibo_schedule_id not in schedule_ids_to_check:
                schedule_ids_to_check.append(booking.xibo_schedule_id)

            for sched_id in schedule_ids_to_check:
                try:
                    schedules = xibo_service.get_schedules({"eventId": sched_id})
                    if schedules and len(schedules) > 0:
                        schedule_exists_in_screenox = True
                        break
                except:
                    pass

            # If no schedules exist in Screenox, clear the IDs and allow re-approval
            if not schedule_exists_in_screenox:
                print(f"[Approval] Schedules deleted externally, clearing schedule IDs for booking {booking_id}")
                database.bookings.update_one(
                    {"_id": ObjectId(booking_id)},
                    {
                        "$set": {
                            "xibo_schedule_id": None,
                            "xibo_schedule_ids": [],
                            "status": Booking.STATUS_PAID,
                            "updated_at": datetime.utcnow()
                        }
                    }
                )
                # Reload booking with updated data
                booking_data = database.bookings.find_one({"_id": ObjectId(booking_id)})
                booking = Booking.from_dict(booking_data)
            else:
                raise HTTPException(
                    status_code=400,
                    detail="Booking already scheduled. Please disconnect first to re-schedule."
                )

        # Get screen info to find display group ID
        screen_data = None

        # Try to find screen by MongoDB ObjectId first
        if ObjectId.is_valid(booking.screen_id):
            screen_data = database.screens.find_one({"_id": ObjectId(booking.screen_id)})

        # If not found, try by xibo_display_id
        if not screen_data and booking.screen_id:
            if booking.screen_id.isdigit():
                screen_data = database.screens.find_one({"xibo_display_id": int(booking.screen_id)})
            else:
                screen_data = database.screens.find_one({"xibo_display_id": booking.screen_id})

        xibo_display_group_id = booking.xibo_display_group_id
        xibo_display_id = booking.xibo_display_id

        print(f"[Approval Debug] Booking ID: {booking_id}, Type: {booking.booking_type}")
        print(f"[Approval Debug] Initial - screen_id: {booking.screen_id}, xibo_display_id: {xibo_display_id}, xibo_display_group_id: {xibo_display_group_id}")
        print(f"[Approval Debug] Screen found in DB: {screen_data is not None}")
        print(f"[Approval Debug] screen_slots array: {booking.screen_slots}")
        print(f"[Approval Debug] screens array: {booking.screens}")

        # Get from screen data if not in booking
        if screen_data:
            if not xibo_display_group_id:
                xibo_display_group_id = screen_data.get('xibo_display_group_id')
                print(f"[Approval Debug] Got xibo_display_group_id from screen_data: {xibo_display_group_id}")
            if not xibo_display_id:
                xibo_display_id = screen_data.get('xibo_display_id')
                print(f"[Approval Debug] Got xibo_display_id from screen_data: {xibo_display_id}")

        # Get from screen_slots if not found yet (for multi-screen bookings)
        if not xibo_display_group_id and booking.screen_slots and len(booking.screen_slots) > 0:
            # Get the first screen's display group ID from screen_slots array
            first_screen = booking.screen_slots[0]
            xibo_display_group_id = first_screen.get('xibo_display_group_id')
            if not xibo_display_id:
                xibo_display_id = first_screen.get('xibo_display_id')
            print(f"[Approval Debug] Got from screen_slots - xibo_display_id: {xibo_display_id}, xibo_display_group_id: {xibo_display_group_id}")

        # Additional fallback: Try to lookup screen in DB using xibo_display_id from screen_slots
        if not xibo_display_group_id and booking.screen_slots and len(booking.screen_slots) > 0:
            first_screen = booking.screen_slots[0]
            slot_xibo_display_id = first_screen.get('xibo_display_id')
            if slot_xibo_display_id:
                try:
                    fallback_screen = database.screens.find_one({"xibo_display_id": slot_xibo_display_id})
                    if fallback_screen:
                        xibo_display_group_id = fallback_screen.get('xibo_display_group_id')
                        print(f"[Approval Debug] Got xibo_display_group_id from DB lookup via screen_slots xibo_display_id: {xibo_display_group_id}")
                except Exception as e:
                    print(f"[Approval Debug] Error during fallback screen lookup: {e}")

        # If still no display group, fetch directly from Screenox API
        if not xibo_display_group_id and xibo_display_id:
            try:
                display_info = xibo_service.get_display_by_id(xibo_display_id)
                if display_info:
                    xibo_display_group_id = display_info.get('displayGroupId')
                    print(f"[Approval Debug] Got displayGroupId from Screenox API (by ID): {xibo_display_group_id}")
            except Exception as e:
                print(f"[Approval Debug] Failed to get display info from Screenox by ID: {e}")

        # Last resort: Try to match screen by name from Screenox displays
        if not xibo_display_group_id and booking.screen_name:
            try:
                print(f"[Approval Debug] Attempting to match screen by name: {booking.screen_name}")
                all_displays = xibo_service.get_displays()

                # Try exact match first
                for display in all_displays:
                    display_name = display.get('display', '').strip()
                    if display_name.lower() == booking.screen_name.lower():
                        xibo_display_group_id = display.get('defaultDisplayGroupId') or display.get('displayGroupId')
                        xibo_display_id = display.get('displayId')
                        print(f"[Approval Debug] Found exact match - display: {display_name}, displayId: {xibo_display_id}, displayGroupId: {xibo_display_group_id}")
                        break

                # If no exact match, try partial match
                if not xibo_display_group_id:
                    for display in all_displays:
                        display_name = display.get('display', '').strip()
                        if (display_name.lower() in booking.screen_name.lower() or
                            booking.screen_name.lower() in display_name.lower()):
                            xibo_display_group_id = display.get('defaultDisplayGroupId') or display.get('displayGroupId')
                            xibo_display_id = display.get('displayId')
                            print(f"[Approval Debug] Found partial match - display: {display_name}, displayId: {xibo_display_id}, displayGroupId: {xibo_display_group_id}")
                            break

                if xibo_display_group_id:
                    print(f"[Approval Debug] Successfully matched screen '{booking.screen_name}' with Screenox display")
                    # Update booking with found IDs for future use
                    database.bookings.update_one(
                        {"_id": ObjectId(booking_id)},
                        {"$set": {
                            "xibo_display_id": xibo_display_id,
                            "xibo_display_group_id": xibo_display_group_id
                        }}
                    )
                else:
                    print(f"[Approval Debug] No matching display found in Screenox for '{booking.screen_name}'")
                    print(f"[Approval Debug] Available displays: {[d.get('display') for d in all_displays[:10]]}")

            except Exception as e:
                print(f"[Approval Debug] Error fetching displays from Screenox: {e}")

        print(f"Booking approval - screen_id: {booking.screen_id}, xibo_display_id: {xibo_display_id}, xibo_display_group_id: {xibo_display_group_id}")

        schedule_result = None

        # Check if we have display group ID
        if not xibo_display_group_id:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "Cannot create schedule: No display group ID found",
                    "details": {
                        "booking_id": booking_id,
                        "booking_type": booking.booking_type,
                        "screen_id": booking.screen_id,
                        "xibo_display_id": xibo_display_id,
                        "xibo_display_group_id": xibo_display_group_id,
                        "screen_found": screen_data is not None,
                        "screen_slots_count": len(booking.screen_slots) if booking.screen_slots else 0,
                        "screen_slots_data": booking.screen_slots[:3] if booking.screen_slots else [],
                        "screens_data": booking.screens[:1] if booking.screens else [],
                        "tip": "Try re-syncing screens from Screenox using POST /api/screens/admin/sync-screenox or check server logs for debug details"
                    }
                }
            )

        # Create layout and schedule in Screenox if we have display group ID
        layout_result = None
        layout_id = booking.xibo_layout_id
        schedule_ids = []

        if xibo_display_group_id:
            try:
                # Step 1: If booking has media, create a layout with that media (SHARED across all screens)
                # Check if existing layout is valid (has regions and media)
                should_create_layout = booking.media_url and not layout_id

                if layout_id and booking.media_url:
                    # Verify the existing layout has regions/media
                    try:
                        existing_layout = xibo_service.get_layout_by_id(layout_id, embed="regions")
                        regions = existing_layout.get("regions", [])
                        if not regions or len(regions) == 0:
                            print(f"⚠️  Existing layout {layout_id} has NO regions, will create new layout")
                            layout_id = None
                            should_create_layout = True
                        else:
                            print(f"✅ Existing layout {layout_id} is valid with {len(regions)} regions")
                    except Exception as e:
                        print(f"⚠️  Could not verify existing layout {layout_id}: {e}, will create new layout")
                        layout_id = None
                        should_create_layout = True

                if should_create_layout:
                    print(f"Creating new layout with media: {booking.media_url}")

                    # Determine media type
                    media_type = booking.media_type or "image"
                    if booking.media_url.lower().endswith(('.mp4', '.mov', '.avi', '.webm')):
                        media_type = "video"

                    # Calculate duration (default 10 seconds for images)
                    duration = 10
                    if media_type == "video":
                        duration = 30

                    # Sanitize campaign name
                    if booking.campaign_name:
                        campaign_name_clean = "".join(c if c.isalnum() or c in '-_' else '_' for c in booking.campaign_name)
                        print(f"[Approval] Using campaign_name for LAYOUT: {booking.campaign_name}")
                    else:
                        campaign_name_clean = str(booking_id)[-8:]
                        print(f"[Approval] WARNING: No campaign_name found for LAYOUT, using booking ID: {campaign_name_clean}")

                    # Sanitize screen name
                    screen_name_clean = "".join(c if c.isalnum() or c in '-_' else '_' for c in booking.screen_name)

                    # Construct layout name: MarkAi_CampaignName_ScreenName
                    layout_name = f"MarkAi_{campaign_name_clean}_{screen_name_clean}"[:50]
                    print(f"[Approval] Generated LAYOUT name: {layout_name}")

                    layout_result = xibo_service.create_layout_with_media(
                        name=layout_name,
                        media_url=booking.media_url,
                        media_type=media_type,
                        duration=duration,
                        description=f"Campaign: {booking.campaign_name or 'Ad'} for {booking.screen_name}"[:254]
                    )

                    if layout_result.get("success"):
                        layout_id = layout_result.get("layout_id")
                        print(f"Layout created successfully: ID={layout_id}")
                    else:
                        error_msg = layout_result.get('error') or 'Unknown error'
                        warnings = layout_result.get('warnings', [])
                        print(f"Layout creation failed: {error_msg}")
                        print(f"Warnings: {warnings}")
                        raise HTTPException(
                            status_code=500,
                            detail={
                                "error": f"Failed to create layout in Screenox: {error_msg}",
                                "warnings": warnings,
                                "details": layout_result
                            }
                        )

                # Step 2: Create schedule(s) with the campaign
                campaign_id = layout_result.get("campaign_id") if layout_result else booking.xibo_campaign_id

                if not layout_result and booking.xibo_campaign_id:
                    print(f"Reusing existing layout (ID={layout_id}) and campaign (ID={campaign_id})")

                # Generate schedule name
                if booking.campaign_name:
                    campaign_name_clean = "".join(c if c.isalnum() or c in '-_' else '_' for c in booking.campaign_name)
                    print(f"[Approval] Using campaign_name from booking: {booking.campaign_name}")
                else:
                    campaign_name_clean = str(booking_id)[-8:]
                    print(f"[Approval] WARNING: No campaign_name found, using booking ID: {campaign_name_clean}")

                screen_name_clean = "".join(c if c.isalnum() or c in '-_' else '_' for c in booking.screen_name)
                schedule_name = f"MarkAi_{campaign_name_clean}_{screen_name_clean}"[:50]
                print(f"[Approval] Generated schedule name: {schedule_name}")

                if campaign_id:
                    # Format recurrence range if set
                    recurrence_range = None
                    if booking.schedule_recurrence_range:
                        recurrence_range = booking.schedule_recurrence_range.strftime("%Y-%m-%d %H:%M:%S")

                    # Use booking_service with rollback logic
                    time_slots = booking.time_slots or []

                    if time_slots and len(time_slots) > 0:
                        # Create schedules with automatic rollback on failure
                        print(f"Creating {len(time_slots)} schedules with rollback protection")

                        # Update booking with display group ID if not set
                        if not booking.xibo_display_group_id:
                            booking.xibo_display_group_id = xibo_display_group_id

                        success, schedule_ids, error_msg = booking_service.create_schedules_with_rollback(
                            booking=booking,
                            campaign_id=campaign_id,
                            database=database,
                            layout_id=layout_id,
                            schedule_name=schedule_name
                        )

                        if not success:
                            raise HTTPException(
                                status_code=500,
                                detail={
                                    "error": f"Failed to create schedules in ScreenOx: {error_msg}",
                                    "details": "All partial schedules have been rolled back. Please try again."
                                }
                            )

                        # Success - schedules created
                        if schedule_ids:
                            schedule_result = {
                                "eventId": schedule_ids[0],
                                "total_schedules": len(schedule_ids),
                                "all_schedule_ids": schedule_ids
                            }
                        else:
                            schedule_result = None

                    else:
                        # No individual slots - create single schedule with overall dates
                        from_dt = booking.start_date.strftime("%Y-%m-%d %H:%M:%S")
                        to_dt = booking.end_date.strftime("%Y-%m-%d %H:%M:%S")

                        print(f"Creating single schedule for campaign {campaign_id} on display group {xibo_display_group_id}")

                        schedule_result = xibo_service.create_schedule(
                            event_type_id=1,
                            display_group_ids=[xibo_display_group_id],
                            from_dt=from_dt,
                            to_dt=to_dt,
                            campaign_id=campaign_id,
                            recurrence_type=booking.schedule_recurrence_type,
                            recurrence_detail=booking.schedule_recurrence_detail,
                            recurrence_range=recurrence_range,
                            recurrence_repeats_on=booking.schedule_recurrence_repeats_on,
                            day_part_id=booking.schedule_day_part_id,
                            is_priority=booking.schedule_is_priority,
                            display_order=1,
                            name=schedule_name
                        )

                        if schedule_result and schedule_result.get('eventId'):
                            schedule_ids.append(schedule_result.get('eventId'))

                    print(f"Total recurring schedules created in Screenox: {len(schedule_ids)}")
                else:
                    print("No campaign available - schedule not created")
                    schedule_result = None

            except HTTPException:
                raise
            except Exception as e:
                print(f"Failed to create Screenox layout/schedule: {str(e)}")

        # Update booking status
        update_data = {
            "status": Booking.STATUS_SCHEDULED if schedule_result else Booking.STATUS_APPROVED,
            "approved_by": token_payload.get('user_id'),
            "approved_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }

        # Store layout, campaign, and schedule IDs
        if layout_result and layout_result.get("layout_id"):
            update_data["xibo_layout_id"] = layout_result.get("layout_id")
            update_data["xibo_media_id"] = layout_result.get("media_id")
        if layout_result and layout_result.get("campaign_id"):
            update_data["xibo_campaign_id"] = layout_result.get("campaign_id")

        if schedule_result and schedule_result.get('eventId'):
            update_data["xibo_schedule_id"] = schedule_result.get('eventId')

        if schedule_ids and len(schedule_ids) > 0:
            update_data["xibo_schedule_ids"] = schedule_ids

        database.bookings.update_one(
            {"_id": ObjectId(booking_id)},
            {"$set": update_data}
        )

        # Get updated booking
        updated_booking = database.bookings.find_one({"_id": ObjectId(booking_id)})

        return {
            "message": "Booking approved successfully",
            "booking": Booking.from_dict(updated_booking).to_dict(),
            "layout_created": layout_result.get("success") if layout_result else False,
            "layout_details": layout_result,
            "schedule_created": schedule_result is not None,
            "schedule_details": schedule_result
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/{booking_id}/reject')
async def reject_booking(
    booking_id: str,
    data: RejectBookingRequest,
    token_payload: dict = Depends(verify_token)
):
    """Reject a booking (Admin only)"""
    try:
        database = get_db()
        user_id = token_payload.get('user_id')

        # Check if user is admin
        user = database.users.find_one({"_id": ObjectId(user_id)})
        is_admin = user.get('is_admin', False) if user else False

        if not is_admin:
            raise HTTPException(status_code=403, detail="Only admin can reject bookings")

        reason = data.reason

        result = database.bookings.update_one(
            {"_id": ObjectId(booking_id)},
            {
                "$set": {
                    "status": Booking.STATUS_REJECTED,
                    "rejection_reason": reason,
                    "approved_by": user_id,
                    "approved_at": datetime.utcnow(),
                    "updated_at": datetime.utcnow()
                }
            }
        )

        if result.modified_count == 0:
            raise HTTPException(status_code=404, detail="Booking not found")

        return {"message": "Booking rejected"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ SCREEN OWNER APPROVAL ============

@router.post('/{booking_id}/owner-approve')
async def owner_approve_booking(
    booking_id: str,
    token_payload: dict = Depends(verify_token)
):
    """Screen owner approves a booking for their screen"""
    try:
        database = get_db()
        user_id = token_payload.get('user_id')

        # Get user to check role
        user = database.users.find_one({"_id": ObjectId(user_id)})
        is_admin = user.get('is_admin', False) if user else False
        is_screen_owner = user.get('is_screen_owner', False) if user else False

        if not is_admin and not is_screen_owner:
            raise HTTPException(
                status_code=403,
                detail="Only screen owners or admin can approve bookings"
            )

        # Get booking
        booking_data = database.bookings.find_one({"_id": ObjectId(booking_id)})
        if not booking_data:
            raise HTTPException(status_code=404, detail="Booking not found")

        booking = Booking.from_dict(booking_data)

        # Check if payment is completed
        if booking.payment_status != "paid":
            raise HTTPException(status_code=400, detail="Payment not completed")

        # Check if screen owner is authorized for this screen (unless admin)
        if not is_admin:
            # Get screen to verify ownership
            screen_data = None
            if ObjectId.is_valid(booking.screen_id):
                screen_data = database.screens.find_one({"_id": ObjectId(booking.screen_id)})
            if not screen_data:
                screen_data = database.screens.find_one({"xibo_display_id": int(booking.screen_id) if booking.screen_id.isdigit() else booking.screen_id})

            if not screen_data:
                raise HTTPException(status_code=404, detail="Screen not found")

            screen_owner_id = screen_data.get('screen_owner_id')
            if screen_owner_id != user_id:
                raise HTTPException(
                    status_code=403,
                    detail="You are not authorized to approve bookings for this screen"
                )

        # Check current approval status
        if booking.screen_owner_approval == "approved":
            raise HTTPException(status_code=400, detail="Booking already approved by screen owner")

        # Update screen owner approval
        update_result = database.bookings.update_one(
            {"_id": ObjectId(booking_id)},
            {
                "$set": {
                    "screen_owner_approval": "approved",
                    "screen_owner_approved_by": user_id,
                    "screen_owner_approved_at": datetime.utcnow(),
                    "status": Booking.STATUS_OWNER_APPROVED,
                    "updated_at": datetime.utcnow()
                }
            }
        )

        if update_result.modified_count == 0:
            raise HTTPException(status_code=500, detail="Failed to update booking")

        # Get updated booking
        updated_booking = database.bookings.find_one({"_id": ObjectId(booking_id)})

        return {
            "message": "Booking approved by screen owner. Awaiting admin final approval.",
            "booking": Booking.from_dict(updated_booking).to_dict()
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/{booking_id}/owner-reject')
async def owner_reject_booking(
    booking_id: str,
    data: RejectBookingRequest,
    token_payload: dict = Depends(verify_token)
):
    """Screen owner rejects a booking for their screen"""
    try:
        database = get_db()
        user_id = token_payload.get('user_id')

        # Get user to check role
        user = database.users.find_one({"_id": ObjectId(user_id)})
        is_admin = user.get('is_admin', False) if user else False
        is_screen_owner = user.get('is_screen_owner', False) if user else False

        if not is_admin and not is_screen_owner:
            raise HTTPException(
                status_code=403,
                detail="Only screen owners or admin can reject bookings"
            )

        # Get booking
        booking_data = database.bookings.find_one({"_id": ObjectId(booking_id)})
        if not booking_data:
            raise HTTPException(status_code=404, detail="Booking not found")

        booking = Booking.from_dict(booking_data)

        # Check if screen owner is authorized for this screen (unless admin)
        if not is_admin:
            # Get screen to verify ownership
            screen_data = None
            if ObjectId.is_valid(booking.screen_id):
                screen_data = database.screens.find_one({"_id": ObjectId(booking.screen_id)})
            if not screen_data:
                screen_data = database.screens.find_one({"xibo_display_id": int(booking.screen_id) if booking.screen_id.isdigit() else booking.screen_id})

            if not screen_data:
                raise HTTPException(status_code=404, detail="Screen not found")

            screen_owner_id = screen_data.get('screen_owner_id')
            if screen_owner_id != user_id:
                raise HTTPException(
                    status_code=403,
                    detail="You are not authorized to reject bookings for this screen"
                )

        reason = data.reason

        # Update screen owner rejection
        update_result = database.bookings.update_one(
            {"_id": ObjectId(booking_id)},
            {
                "$set": {
                    "screen_owner_approval": "rejected",
                    "screen_owner_approved_by": user_id,
                    "screen_owner_approved_at": datetime.utcnow(),
                    "screen_owner_rejection_reason": reason,
                    "status": Booking.STATUS_OWNER_REJECTED,
                    "updated_at": datetime.utcnow()
                }
            }
        )

        if update_result.modified_count == 0:
            raise HTTPException(status_code=500, detail="Failed to update booking")

        # Get updated booking
        updated_booking = database.bookings.find_one({"_id": ObjectId(booking_id)})

        return {
            "message": "Booking rejected by screen owner",
            "booking": Booking.from_dict(updated_booking).to_dict()
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/{booking_id}/debug')
async def debug_booking(
    booking_id: str,
    token_payload: dict = Depends(verify_token)
):
    """Debug endpoint to check booking status and Screenox connection"""
    try:
        database = get_db()
        user_id = token_payload.get('user_id')

        # Check if user is admin
        user = database.users.find_one({"_id": ObjectId(user_id)})
        is_admin = user.get('is_admin', False) if user else False

        if not is_admin:
            raise HTTPException(status_code=403, detail="Admin access required")

        # Get booking
        booking_data = database.bookings.find_one({"_id": ObjectId(booking_id)})
        if not booking_data:
            raise HTTPException(status_code=404, detail="Booking not found")

        booking = Booking.from_dict(booking_data)

        # Get screen info
        screen_data = None
        if ObjectId.is_valid(booking.screen_id):
            screen_data = database.screens.find_one({"_id": ObjectId(booking.screen_id)})
        if not screen_data:
            screen_data = database.screens.find_one({"xibo_display_id": int(booking.screen_id) if booking.screen_id.isdigit() else booking.screen_id})

        # Test Screenox connection
        screenox_connection = None
        try:
            screenox_connection = xibo_service.test_connection()
        except Exception as e:
            screenox_connection = {"error": str(e)}

        # Check display info from Screenox
        display_info = None
        xibo_display_id = booking.xibo_display_id or (screen_data.get('xibo_display_id') if screen_data else None)
        if xibo_display_id:
            try:
                display_info = xibo_service.get_display_by_id(xibo_display_id)
            except Exception as e:
                display_info = {"error": str(e)}

        return {
            "booking": {
                "id": str(booking._id),
                "screen_id": booking.screen_id,
                "screen_name": booking.screen_name,
                "status": booking.status,
                "payment_status": booking.payment_status,
                "screen_owner_approval": booking.screen_owner_approval,
                "media_url": booking.media_url,
                "media_type": booking.media_type,
                "xibo_display_id": booking.xibo_display_id,
                "xibo_display_group_id": booking.xibo_display_group_id,
                "xibo_layout_id": booking.xibo_layout_id,
                "xibo_schedule_id": booking.xibo_schedule_id,
                "start_date": booking.start_date.isoformat() if booking.start_date else None,
                "end_date": booking.end_date.isoformat() if booking.end_date else None,
            },
            "screen_from_db": {
                "found": screen_data is not None,
                "xibo_display_id": screen_data.get('xibo_display_id') if screen_data else None,
                "xibo_display_group_id": screen_data.get('xibo_display_group_id') if screen_data else None,
            } if screen_data else None,
            "screenox_connection": screenox_connection,
            "display_from_screenox": display_info,
            "issues": {
                "no_media_url": not booking.media_url,
                "no_display_group_id": not (booking.xibo_display_group_id or (screen_data.get('xibo_display_group_id') if screen_data else None)),
                "no_xibo_display_id": not xibo_display_id,
                "not_paid": booking.payment_status != "paid",
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/pending-owner-approval')
async def get_pending_owner_approval(token_payload: dict = Depends(verify_token)):
    """Get bookings pending screen owner approval"""
    try:
        database = get_db()
        user_id = token_payload.get('user_id')

        # Get user to check role
        user = database.users.find_one({"_id": ObjectId(user_id)})
        is_admin = user.get('is_admin', False) if user else False
        is_screen_owner = user.get('is_screen_owner', False) if user else False

        if not is_admin and not is_screen_owner:
            raise HTTPException(status_code=403, detail="Access denied")

        # Build query
        query = {
            "payment_status": "paid",
            "screen_owner_approval": "pending"
        }

        # If screen owner (not admin), only show their screens
        if not is_admin:
            owner_screens = list(database.screens.find({"screen_owner_id": user_id}))
            screen_ids = [str(s['_id']) for s in owner_screens]
            xibo_display_ids = [s.get('xibo_display_id') for s in owner_screens if s.get('xibo_display_id')]

            query["$or"] = [
                {"screen_id": {"$in": screen_ids}},
                {"xibo_display_id": {"$in": xibo_display_ids}}
            ]

        # Get bookings
        bookings_cursor = database.bookings.find(query).sort("created_at", -1)
        # Hide sensitive data (GST & payment details) ONLY for screen owners (not admins)
        hide_sensitive = is_screen_owner and not is_admin
        bookings = [Booking.from_dict(b).to_dict(hide_sensitive=hide_sensitive) for b in bookings_cursor]

        return {
            "bookings": bookings,
            "total": len(bookings)
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('')
async def get_bookings(
    request: Request,
    token_payload: dict = Depends(verify_token),
    limit: int = 50,
    skip: int = 0,
    status: Optional[str] = None
):
    """Get all bookings (filtered by user role)"""
    try:
        database = get_db()
        user_id = token_payload.get('user_id')

        # Get user to check role
        user = database.users.find_one({"_id": ObjectId(user_id)})
        is_admin = user.get('is_admin', False) if user else False
        is_screen_owner = user.get('is_screen_owner', False) if user else False

        # Build query based on role
        query = {}

        if is_admin:
            # Admin sees all bookings
            pass
        elif is_screen_owner:
            # Screen owner sees bookings for their screens
            owner_screens = list(database.screens.find({"screen_owner_id": user_id}))
            screen_ids = [str(s['_id']) for s in owner_screens]
            query["screen_id"] = {"$in": screen_ids}
        else:
            # Advertiser sees only their bookings
            query["advertiser_id"] = user_id

        # Apply limit constraint
        limit = min(limit, 100)

        if status:
            query["status"] = status

        # Get bookings
        bookings_cursor = database.bookings.find(query).sort("created_at", -1).skip(skip).limit(limit)
        # Hide sensitive data (GST & payment details) ONLY for screen owners (not admins)
        hide_sensitive = is_screen_owner and not is_admin
        bookings = [Booking.from_dict(b).to_dict(hide_sensitive=hide_sensitive) for b in bookings_cursor]
        total = database.bookings.count_documents(query)

        return {
            "bookings": bookings,
            "total": total,
            "limit": limit,
            "skip": skip
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/{booking_id}')
async def get_booking(
    booking_id: str,
    token_payload: dict = Depends(verify_token)
):
    """Get single booking by ID"""
    try:
        database = get_db()
        user_id = token_payload.get('user_id')

        booking_data = database.bookings.find_one({"_id": ObjectId(booking_id)})

        if not booking_data:
            raise HTTPException(status_code=404, detail="Booking not found")

        booking = Booking.from_dict(booking_data)

        # Get user to check role
        user = database.users.find_one({"_id": ObjectId(user_id)})
        is_admin = user.get('is_admin', False) if user else False
        is_screen_owner = user.get('is_screen_owner', False) if user else False

        # Hide sensitive data (GST & payment details) ONLY for screen owners (not admins)
        hide_sensitive = is_screen_owner and not is_admin
        return {"booking": booking.to_dict(hide_sensitive=hide_sensitive)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/{booking_id}/create-schedule')
async def create_schedule_for_booking(
    booking_id: str,
    data: CreateScheduleRequest,
    token_payload: dict = Depends(verify_token)
):
    """Manually create Screenox schedule for an approved booking"""
    try:
        database = get_db()

        # Get booking
        booking_data = database.bookings.find_one({"_id": ObjectId(booking_id)})
        if not booking_data:
            raise HTTPException(status_code=404, detail="Booking not found")

        booking = Booking.from_dict(booking_data)

        # Check status
        if booking.status not in [Booking.STATUS_APPROVED, Booking.STATUS_PAID]:
            raise HTTPException(
                status_code=400,
                detail="Booking must be approved or paid to create schedule"
            )

        # Check if schedule already exists
        if booking.xibo_schedule_id:
            raise HTTPException(
                status_code=400,
                detail={"error": "Schedule already exists", "schedule_id": booking.xibo_schedule_id}
            )

        # Get display group ID
        xibo_display_group_id = booking.xibo_display_group_id

        if not xibo_display_group_id:
            # Try to get from screen
            screen_data = database.screens.find_one({"_id": ObjectId(booking.screen_id)}) if ObjectId.is_valid(booking.screen_id) else None
            if screen_data:
                xibo_display_group_id = screen_data.get('xibo_display_group_id')

        if not xibo_display_group_id:
            raise HTTPException(status_code=400, detail="No display group ID found for this booking")

        # Get optional data from request
        layout_id = data.layout_id or booking.xibo_layout_id
        campaign_id = data.campaign_id or booking.xibo_campaign_id

        # Create schedule
        from_dt = booking.start_date.strftime("%Y-%m-%d %H:%M:%S")
        to_dt = booking.end_date.strftime("%Y-%m-%d %H:%M:%S")

        schedule_data = {
            "event_type_id": 1,
            "display_group_ids": [xibo_display_group_id],
            "from_dt": from_dt,
            "to_dt": to_dt,
            "displayOrder": 1,
            "isPriority": 0
        }

        if campaign_id:
            schedule_data["campaign_id"] = campaign_id
        if layout_id:
            schedule_data["layout_id"] = layout_id

        schedule_result = xibo_service.create_schedule(**schedule_data)

        # Update booking with schedule ID
        if schedule_result and schedule_result.get('eventId'):
            database.bookings.update_one(
                {"_id": ObjectId(booking_id)},
                {
                    "$set": {
                        "xibo_schedule_id": schedule_result.get('eventId'),
                        "status": Booking.STATUS_SCHEDULED,
                        "updated_at": datetime.utcnow()
                    }
                }
            )

        return {
            "message": "Schedule created successfully",
            "schedule": schedule_result
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ SCHEDULE MANAGEMENT ============

@router.post('/{booking_id}/cancel-schedule')
async def cancel_schedule(
    booking_id: str,
    token_payload: dict = Depends(verify_token)
):
    """Cancel/delete the Screenox schedule for a booking"""
    try:
        database = get_db()
        user_id = token_payload.get('user_id')

        # Check if user is admin or screen owner
        user = database.users.find_one({"_id": ObjectId(user_id)})
        is_admin = user.get('is_admin', False) if user else False
        is_screen_owner = user.get('is_screen_owner', False) if user else False

        if not is_admin and not is_screen_owner:
            raise HTTPException(
                status_code=403,
                detail="Only admin or screen owner can cancel schedules"
            )

        # Get booking
        booking_data = database.bookings.find_one({"_id": ObjectId(booking_id)})
        if not booking_data:
            raise HTTPException(status_code=404, detail="Booking not found")

        booking = Booking.from_dict(booking_data)

        # Check if schedule exists
        schedule_ids_to_delete = booking.xibo_schedule_ids or []
        if booking.xibo_schedule_id and booking.xibo_schedule_id not in schedule_ids_to_delete:
            schedule_ids_to_delete.append(booking.xibo_schedule_id)

        if not schedule_ids_to_delete:
            raise HTTPException(status_code=400, detail="No schedule found for this booking")

        # Delete all schedules from Screenox
        deleted_count = 0
        for schedule_id in schedule_ids_to_delete:
            try:
                xibo_service.delete_schedule(schedule_id)
                print(f"Schedule {schedule_id} deleted from Screenox")
                deleted_count += 1
            except Exception as e:
                print(f"Error deleting schedule {schedule_id} from Screenox: {e}")

        print(f"Deleted {deleted_count}/{len(schedule_ids_to_delete)} schedules")

        # Update booking status
        database.bookings.update_one(
            {"_id": ObjectId(booking_id)},
            {
                "$set": {
                    "status": Booking.STATUS_PAID,
                    "xibo_schedule_id": None,
                    "xibo_schedule_ids": [],
                    "cancelled_by": user_id,
                    "cancelled_at": datetime.utcnow(),
                    "updated_at": datetime.utcnow()
                }
            }
        )

        # Get updated booking
        updated_booking = database.bookings.find_one({"_id": ObjectId(booking_id)})

        return {
            "message": "Schedule disconnected successfully. You can now re-approve this booking to create a new schedule.",
            "booking": Booking.from_dict(updated_booking).to_dict(),
            "status_changed": True,
            "new_status": Booking.STATUS_PAID
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/{booking_id}/sync-status')
async def sync_booking_status(
    booking_id: str,
    token_payload: dict = Depends(verify_token)
):
    """Sync booking status with Screenox CMS (check if schedules still exist)"""
    try:
        database = get_db()
        user_id = token_payload.get('user_id')

        # Check if user is admin or screen owner
        user = database.users.find_one({"_id": ObjectId(user_id)})
        is_admin = user.get('is_admin', False) if user else False
        is_screen_owner = user.get('is_screen_owner', False) if user else False

        if not is_admin and not is_screen_owner:
            raise HTTPException(
                status_code=403,
                detail="Only admin or screen owner can sync booking status"
            )

        # Get booking
        booking_data = database.bookings.find_one({"_id": ObjectId(booking_id)})
        if not booking_data:
            raise HTTPException(status_code=404, detail="Booking not found")

        booking = Booking.from_dict(booking_data)

        # Check if schedules exist
        schedule_ids_to_check = booking.xibo_schedule_ids or []
        if booking.xibo_schedule_id and booking.xibo_schedule_id not in schedule_ids_to_check:
            schedule_ids_to_check.append(booking.xibo_schedule_id)

        if not schedule_ids_to_check:
            return {
                "message": "No schedules to sync",
                "booking": booking.to_dict()
            }

        # Check which schedules still exist in Screenox
        existing_schedule_ids = []
        for sched_id in schedule_ids_to_check:
            try:
                schedules = xibo_service.get_schedules({"eventId": sched_id})
                if schedules and len(schedules) > 0:
                    existing_schedule_ids.append(sched_id)
            except Exception as e:
                print(f"Error checking schedule {sched_id}: {e}")

        # Update booking based on what exists
        status_changed = False
        new_status = booking.status

        if len(existing_schedule_ids) == 0:
            # No schedules exist - reset to PAID
            database.bookings.update_one(
                {"_id": ObjectId(booking_id)},
                {
                    "$set": {
                        "xibo_schedule_id": None,
                        "xibo_schedule_ids": [],
                        "status": Booking.STATUS_PAID,
                        "updated_at": datetime.utcnow()
                    }
                }
            )
            status_changed = True
            new_status = Booking.STATUS_PAID
        elif len(existing_schedule_ids) < len(schedule_ids_to_check):
            # Some schedules were deleted - update the list
            database.bookings.update_one(
                {"_id": ObjectId(booking_id)},
                {
                    "$set": {
                        "xibo_schedule_ids": existing_schedule_ids,
                        "xibo_schedule_id": existing_schedule_ids[0] if existing_schedule_ids else None,
                        "updated_at": datetime.utcnow()
                    }
                }
            )
            status_changed = True

        # Get updated booking
        updated_booking = database.bookings.find_one({"_id": ObjectId(booking_id)})

        return {
            "message": "Booking status synced with Screenox" if status_changed else "Booking status is up to date",
            "booking": Booking.from_dict(updated_booking).to_dict(),
            "status_changed": status_changed,
            "schedules_in_screenox": len(existing_schedule_ids),
            "schedules_expected": len(schedule_ids_to_check)
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put('/{booking_id}/edit-schedule')
async def edit_schedule(
    booking_id: str,
    data: EditScheduleRequest,
    token_payload: dict = Depends(verify_token)
):
    """Edit schedule dates for a booking"""
    try:
        database = get_db()
        user_id = token_payload.get('user_id')

        # Check if user is admin or screen owner
        user = database.users.find_one({"_id": ObjectId(user_id)})
        is_admin = user.get('is_admin', False) if user else False
        is_screen_owner = user.get('is_screen_owner', False) if user else False

        if not is_admin and not is_screen_owner:
            raise HTTPException(
                status_code=403,
                detail="Only admin or screen owner can edit schedules"
            )

        # Get booking
        booking_data = database.bookings.find_one({"_id": ObjectId(booking_id)})
        if not booking_data:
            raise HTTPException(status_code=404, detail="Booking not found")

        booking = Booking.from_dict(booking_data)

        # Parse dates
        try:
            start_date = datetime.fromisoformat(data.start_date.replace('Z', '+00:00'))
            end_date = datetime.fromisoformat(data.end_date.replace('Z', '+00:00'))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid date format: {e}")

        # If schedule exists in Screenox, delete old and create new
        schedule_result = None
        if booking.xibo_schedule_id:
            try:
                # Delete old schedule
                xibo_service.delete_schedule(booking.xibo_schedule_id)
                print(f"Old schedule {booking.xibo_schedule_id} deleted")
            except Exception as e:
                print(f"Error deleting old schedule: {e}")

            # Create new schedule with new dates
            xibo_display_group_id = booking.xibo_display_group_id
            campaign_id = booking.xibo_campaign_id

            if xibo_display_group_id and campaign_id:
                try:
                    from_dt = start_date.strftime("%Y-%m-%d %H:%M:%S")
                    to_dt = end_date.strftime("%Y-%m-%d %H:%M:%S")

                    schedule_result = xibo_service.create_schedule(
                        event_type_id=1,
                        display_group_ids=[xibo_display_group_id],
                        from_dt=from_dt,
                        to_dt=to_dt,
                        campaign_id=campaign_id,
                        displayOrder=1,
                        isPriority=0
                    )
                    print(f"New schedule created: {schedule_result}")
                except Exception as e:
                    print(f"Error creating new schedule: {e}")

        # Update booking in database
        update_data = {
            "start_date": start_date,
            "end_date": end_date,
            "updated_at": datetime.utcnow()
        }

        if schedule_result and schedule_result.get('eventId'):
            update_data["xibo_schedule_id"] = schedule_result.get('eventId')

        database.bookings.update_one(
            {"_id": ObjectId(booking_id)},
            {"$set": update_data}
        )

        # Get updated booking
        updated_booking = database.bookings.find_one({"_id": ObjectId(booking_id)})

        return {
            "message": "Schedule updated successfully",
            "booking": Booking.from_dict(updated_booking).to_dict(),
            "new_schedule": schedule_result
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/{booking_id}/schedule-status')
async def get_schedule_status(
    booking_id: str,
    token_payload: dict = Depends(verify_token)
):
    """Get current status of the Screenox schedule"""
    try:
        database = get_db()

        # Get booking
        booking_data = database.bookings.find_one({"_id": ObjectId(booking_id)})
        if not booking_data:
            raise HTTPException(status_code=404, detail="Booking not found")

        booking = Booking.from_dict(booking_data)

        # Determine status
        now = datetime.utcnow()
        status_str = "unknown"
        schedule_info = None

        if not booking.xibo_schedule_id:
            status_str = "not_scheduled"
        else:
            # Try to get schedule from Screenox
            try:
                schedules = xibo_service.get_schedules({"eventId": booking.xibo_schedule_id})
                if schedules and len(schedules) > 0:
                    schedule_info = schedules[0]
            except Exception as e:
                print(f"Error fetching schedule: {e}")

            # Determine status based on dates
            if booking.start_date and booking.end_date:
                if now < booking.start_date:
                    status_str = "upcoming"
                elif now > booking.end_date:
                    status_str = "completed"
                else:
                    status_str = "playing"
            elif booking.status == Booking.STATUS_CANCELLED:
                status_str = "cancelled"
            else:
                status_str = "scheduled"

        # Get layout status if available
        layout_status = None
        if booking.xibo_layout_id:
            try:
                layout = xibo_service.get_layout_by_id(booking.xibo_layout_id)
                layout_status = {
                    "layout_id": layout.get("layoutId"),
                    "name": layout.get("layout"),
                    "status": layout.get("status"),
                    "published_status": layout.get("publishedStatus"),
                    "duration": layout.get("duration")
                }
            except Exception as e:
                print(f"Error fetching layout: {e}")

        return {
            "booking_id": str(booking._id),
            "status": status_str,
            "schedule_info": schedule_info,
            "layout_info": layout_status,
            "start_date": booking.start_date.isoformat() if booking.start_date else None,
            "end_date": booking.end_date.isoformat() if booking.end_date else None,
            "xibo_schedule_id": booking.xibo_schedule_id,
            "xibo_layout_id": booking.xibo_layout_id,
            "xibo_campaign_id": booking.xibo_campaign_id
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/{booking_id}/proof-of-play')
async def get_proof_of_play(
    booking_id: str,
    token_payload: dict = Depends(verify_token)
):
    """Get proof of play statistics for a booking"""
    try:
        database = get_db()

        # Get booking
        booking_data = database.bookings.find_one({"_id": ObjectId(booking_id)})
        if not booking_data:
            raise HTTPException(status_code=404, detail="Booking not found")

        booking = Booking.from_dict(booking_data)

        if not booking.xibo_layout_id:
            raise HTTPException(status_code=400, detail="No layout ID found for this booking")

        # Get proof of play from Screenox
        from_dt = booking.start_date.strftime("%Y-%m-%d %H:%M:%S") if booking.start_date else None
        to_dt = booking.end_date.strftime("%Y-%m-%d %H:%M:%S") if booking.end_date else None

        if not from_dt or not to_dt:
            raise HTTPException(status_code=400, detail="Booking dates not set")

        try:
            stats = xibo_service.get_proof_of_play(
                from_dt=from_dt,
                to_dt=to_dt,
                layout_id=booking.xibo_layout_id
            )

            # Calculate summary
            total_plays = len(stats)
            total_duration = sum(s.get('duration', 0) for s in stats)

            return {
                "booking_id": str(booking._id),
                "layout_id": booking.xibo_layout_id,
                "period": {
                    "from": from_dt,
                    "to": to_dt
                },
                "summary": {
                    "total_plays": total_plays,
                    "total_duration_seconds": total_duration
                },
                "details": stats[:100]
            }

        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to get proof of play: {e}")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ SCREENOX SCHEDULE OPTIONS ============

@router.get('/screenox/day-parts')
async def get_screenox_day_parts(token_payload: dict = Depends(verify_token)):
    """Get available day parts (time slots) from Screenox for scheduling"""
    try:
        day_parts = xibo_service.get_day_parts()

        # Format day parts for frontend
        formatted_parts = []
        for dp in day_parts:
            formatted_parts.append({
                "dayPartId": dp.get("dayPartId"),
                "name": dp.get("name"),
                "description": dp.get("description", ""),
                "startTime": dp.get("startTime"),
                "endTime": dp.get("endTime"),
                "isAlways": dp.get("isAlways", 0),
                "isCustom": dp.get("isCustom", 0),
            })

        return {
            "day_parts": formatted_parts,
            "recurrence_options": [
                {"value": None, "label": "One Time (No Recurrence)"},
                {"value": "Day", "label": "Daily"},
                {"value": "Week", "label": "Weekly"},
                {"value": "Month", "label": "Monthly"},
            ],
            "week_days": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/screenox/display-groups')
async def get_screenox_display_groups(token_payload: dict = Depends(verify_token)):
    """Get available display groups from Screenox"""
    try:
        display_groups = xibo_service.get_display_groups()

        # Format display groups for frontend
        formatted_groups = []
        for dg in display_groups:
            formatted_groups.append({
                "displayGroupId": dg.get("displayGroupId"),
                "displayGroup": dg.get("displayGroup"),
                "description": dg.get("description", ""),
                "isDynamic": dg.get("isDynamic", 0),
            })

        return {"display_groups": formatted_groups}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/{booking_id}/sync-status')
async def get_booking_sync_status(
    booking_id: str,
    token_payload: dict = Depends(verify_token)
):
    """
    Check if booking's ScreenOx schedules match database records
    Returns sync status and any discrepancies
    """
    try:
        database = get_db()

        # Get booking
        booking_data = database.bookings.find_one({"_id": ObjectId(booking_id)})
        if not booking_data:
            raise HTTPException(status_code=404, detail="Booking not found")

        booking = Booking.from_dict(booking_data)

        sync_status = {
            "booking_id": booking_id,
            "in_sync": True,
            "issues": [],
            "db_schedule_ids": booking.xibo_schedule_ids or [],
            "screenox_schedules": []
        }

        # Check each schedule ID in database
        for sched_id in (booking.xibo_schedule_ids or []):
            try:
                # Try to fetch schedule from ScreenOx
                schedules = xibo_service.get_schedules({"eventId": sched_id})

                if not schedules or len(schedules) == 0:
                    sync_status["in_sync"] = False
                    sync_status["issues"].append(
                        f"Schedule {sched_id} exists in DB but not found in ScreenOx"
                    )
                else:
                    sync_status["screenox_schedules"].append({
                        "eventId": sched_id,
                        "found": True,
                        "details": schedules[0]
                    })
            except Exception as e:
                sync_status["in_sync"] = False
                sync_status["issues"].append(
                    f"Error checking schedule {sched_id}: {str(e)}"
                )

        # Check for orphaned schedules (in ScreenOx but not in DB)
        if booking.xibo_display_group_id:
            try:
                from_ts = int(booking.start_date.timestamp())
                to_ts = int(booking.end_date.timestamp())

                all_schedules = xibo_service.get_schedule_by_display(
                    booking.xibo_display_group_id,
                    str(from_ts),
                    str(to_ts)
                )

                db_sched_set = set(booking.xibo_schedule_ids or [])
                for sched in all_schedules:
                    sched_id = sched.get('eventId')
                    if sched_id and sched_id not in db_sched_set:
                        # Check if this schedule belongs to this campaign
                        if sched.get('campaignId') == booking.xibo_campaign_id:
                            sync_status["in_sync"] = False
                            sync_status["issues"].append(
                                f"Orphaned schedule {sched_id} found in ScreenOx but not in DB"
                            )
            except Exception as e:
                sync_status["issues"].append(
                    f"Error checking ScreenOx schedules: {str(e)}"
                )

        return sync_status

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ UPDATE CREATIVE (MEDIA) ============

@router.put('/{booking_id}/update-creative')
async def update_creative(
    booking_id: str,
    data: UpdateCreativeRequest,
    token_payload: dict = Depends(verify_token)
):
    """
    Update/replace the creative (media) for an existing booking.

    This will:
    1. Delete existing schedules from Screenox (if any)
    2. Update the media URL and type in the booking
    3. Reset all approvals to pending (screen owner approval & admin approval)
    4. Clear existing Screenox layout/campaign/schedule data
    5. The booking will need to go through the full approval workflow again

    Only the booking owner (advertiser) can update their creative.
    """
    try:
        database = get_db()
        user_id = token_payload.get('user_id')

        # Get booking
        booking_data = database.bookings.find_one({"_id": ObjectId(booking_id)})
        if not booking_data:
            raise HTTPException(status_code=404, detail="Booking not found")

        booking = Booking.from_dict(booking_data)

        # Verify ownership - only the advertiser who created the booking can update creative
        if booking.advertiser_id != user_id:
            # Check if user is admin (admins can also update)
            user = database.users.find_one({"_id": ObjectId(user_id)})
            is_admin = user.get('is_admin', False) if user else False

            if not is_admin:
                raise HTTPException(
                    status_code=403,
                    detail="Only the booking owner or admin can update the creative"
                )

        # Check if payment is completed - only paid bookings can have creative updated
        if booking.payment_status != "paid":
            raise HTTPException(
                status_code=400,
                detail="Cannot update creative: Payment not completed"
            )

        # Check if booking is not cancelled or completed
        if booking.status in [Booking.STATUS_CANCELLED, Booking.STATUS_COMPLETED]:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot update creative: Booking is {booking.status}"
            )

        # Track if we need to delete Screenox resources
        deleted_schedules = 0
        deleted_layout = False
        deleted_media = False
        previous_media_url = booking.media_url
        was_scheduled = booking.status == Booking.STATUS_SCHEDULED

        # Step 1: Delete existing schedules from Screenox
        schedule_ids_to_delete = booking.xibo_schedule_ids or []
        if booking.xibo_schedule_id and booking.xibo_schedule_id not in schedule_ids_to_delete:
            schedule_ids_to_delete.append(booking.xibo_schedule_id)

        for schedule_id in schedule_ids_to_delete:
            try:
                xibo_service.delete_schedule(schedule_id)
                print(f"[Update Creative] Deleted schedule {schedule_id} from Screenox")
                deleted_schedules += 1
            except Exception as e:
                print(f"[Update Creative] Warning: Could not delete schedule {schedule_id}: {e}")

        # Step 2: Optionally delete the old layout (to avoid clutter in Screenox)
        if booking.xibo_layout_id:
            try:
                xibo_service.delete_layout(booking.xibo_layout_id)
                print(f"[Update Creative] Deleted layout {booking.xibo_layout_id} from Screenox")
                deleted_layout = True
            except Exception as e:
                print(f"[Update Creative] Warning: Could not delete layout {booking.xibo_layout_id}: {e}")

        # Step 3: Optionally delete the old media from library
        if booking.xibo_media_id:
            try:
                xibo_service.delete_library_media(booking.xibo_media_id)
                print(f"[Update Creative] Deleted media {booking.xibo_media_id} from Screenox library")
                deleted_media = True
            except Exception as e:
                print(f"[Update Creative] Warning: Could not delete media {booking.xibo_media_id}: {e}")

        # Step 4: Determine media type if not provided
        media_type = data.media_type
        if not media_type:
            # Infer from URL
            media_url_lower = data.media_url.lower()
            if any(ext in media_url_lower for ext in ['.mp4', '.mov', '.avi', '.webm', '.mkv']):
                media_type = "video"
            else:
                media_type = "image"

        # Step 5: Update booking with new creative and reset approvals
        update_data = {
            # New creative data
            "media_url": data.media_url,
            "media_type": media_type,
            "cloudinary_public_id": data.cloudinary_public_id,

            # Reset screen owner approval
            "screen_owner_approval": "pending",
            "screen_owner_approved_by": None,
            "screen_owner_approved_at": None,
            "screen_owner_rejection_reason": None,

            # Reset admin approval - set status to paid (needs re-approval)
            "status": Booking.STATUS_PAID,
            "approved_by": None,
            "approved_at": None,
            "rejection_reason": None,

            # Clear Screenox IDs - new ones will be created on approval
            "xibo_layout_id": None,
            "xibo_campaign_id": None,
            "xibo_media_id": None,
            "xibo_schedule_id": None,
            "xibo_schedule_ids": [],

            # Update timestamp
            "updated_at": datetime.utcnow()
        }

        result = database.bookings.update_one(
            {"_id": ObjectId(booking_id)},
            {"$set": update_data}
        )

        if result.modified_count == 0:
            raise HTTPException(status_code=500, detail="Failed to update booking")

        # Get updated booking
        updated_booking = database.bookings.find_one({"_id": ObjectId(booking_id)})

        # Send notification to screen owner about creative update
        try:
            from app.services.email_service import EmailService
            from app.services.booking_service import BookingService

            # Get all screen owners for this booking
            booking_obj = Booking.from_dict(updated_booking)
            screen_owner_ids = BookingService.get_all_screen_owners_for_booking(booking_obj, database)

            for owner_id in screen_owner_ids:
                owner_data = database.users.find_one({"_id": ObjectId(owner_id)})
                if owner_data and owner_data.get('email'):
                    owner_email = owner_data.get('email')
                    owner_name = owner_data.get('full_name', 'Screen Owner')

                    # Prepare booking data for email
                    email_booking_data = {
                        'booking_id': str(booking_obj._id),
                        'screen_name': booking_obj.screen_name,
                        'start_date': booking_obj.start_date.isoformat() if booking_obj.start_date else '',
                        'end_date': booking_obj.end_date.isoformat() if booking_obj.end_date else '',
                        'status': booking_obj.status,
                        'payment_status': booking_obj.payment_status,
                        'total_amount': booking_obj.total_amount,
                        'currency': booking_obj.currency,
                        'creative_updated': True,
                        'previous_media_url': previous_media_url,
                        'new_media_url': data.media_url,
                        'time_slots': [{'start': slot.get('start'), 'end': slot.get('end')} for slot in (booking_obj.time_slots or [])]
                    }

                    # Send email notification
                    EmailService.send_booking_notification_to_owner(
                        owner_email,
                        owner_name,
                        email_booking_data
                    )
                    print(f"[Update Creative] Notification sent to screen owner: {owner_email}")
        except Exception as email_error:
            # Log email error but don't fail the update
            print(f"[Update Creative] Warning: Could not send notification email: {email_error}")

        return {
            "message": "Creative updated successfully. The booking now requires re-approval from screen owner and admin.",
            "booking": Booking.from_dict(updated_booking).to_dict(),
            "cleanup_summary": {
                "schedules_deleted": deleted_schedules,
                "layout_deleted": deleted_layout,
                "media_deleted": deleted_media,
                "was_scheduled": was_scheduled
            },
            "next_steps": [
                "Screen owner needs to approve the new creative",
                "Admin/Screen owner needs to do final approval",
                "New layout and schedules will be created in Screenox upon approval"
            ]
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[Update Creative] Error: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
