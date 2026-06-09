"""
Booking service for business logic
Separates route handlers from business logic
"""
from typing import List, Dict, Optional, Tuple
from datetime import datetime, timedelta, timezone
from bson import ObjectId

from app.models.booking import Booking
from app.services.xibo_service import xibo_service


class BookingService:
    """Service for booking-related business logic"""

    @staticmethod
    def get_all_screen_owners_for_booking(booking: Booking, database) -> List[str]:
        """
        Get all unique screen owner IDs for a booking
        Handles both single and multi-screen bookings

        Returns:
            List of screen owner user IDs
        """
        screen_owner_ids = set()

        if booking.booking_type == 'multi_screen' and booking.screens:
            # Multi-screen: check all screens
            for screen_data in booking.screens:
                screen_id = screen_data.get('screenId')
                screen_doc = BookingService._get_screen_document(screen_id, database)

                if screen_doc and screen_doc.get('screen_owner_id'):
                    screen_owner_ids.add(screen_doc['screen_owner_id'])
        else:
            # Single screen
            screen_doc = BookingService._get_screen_document(booking.screen_id, database)
            if screen_doc and screen_doc.get('screen_owner_id'):
                screen_owner_ids.add(screen_doc['screen_owner_id'])

        return list(screen_owner_ids)

    @staticmethod
    def _get_screen_document(screen_id: str, database) -> Optional[Dict]:
        """Helper to get screen document from various ID formats"""
        if ObjectId.is_valid(screen_id):
            return database.screens.find_one({"_id": ObjectId(screen_id)})

        return database.screens.find_one({
            "xibo_display_id": int(screen_id) if str(screen_id).isdigit() else screen_id
        })

    @staticmethod
    def create_schedules_with_rollback(
        booking: Booking,
        campaign_id: int,
        database,
        layout_id: int = None,
        schedule_name: str = None
    ) -> Tuple[bool, List[int], Optional[str]]:
        """
        Create ScreenOx schedules with automatic rollback on failure

        Returns:
            (success: bool, schedule_ids: List[int], error_msg: Optional[str])
        """
        created_schedules = []

        try:
            # Since we now create separate bookings per screen,
            # each booking has only one screen and its slots
            if not booking.xibo_display_group_id:
                raise Exception(f"No display group ID found for booking {booking._id}")

            # Get advertiser name for metadata
            advertiser = database.users.find_one({"_id": ObjectId(booking.advertiser_id)})
            # Check multiple fields: full_name (User model), name (legacy), business_name, or email
            advertiser_name = 'Unknown'
            if advertiser:
                advertiser_name = (
                    advertiser.get('full_name') or
                    advertiser.get('name') or
                    advertiser.get('business_name') or
                    advertiser.get('email', '').split('@')[0] or
                    'Unknown'
                )

            # OPTIMIZED: Group slots by hour and consecutive date ranges
            # This creates separate schedules for each consecutive range to avoid unwanted dates
            # Example: If user selects Mon-Wed + Fri (skips Thu), creates 2 schedules instead of 1

            IST_OFFSET = timedelta(hours=5, minutes=30)

            # Group time slots by hour (e.g., all 8:00-9:00 slots together)
            from collections import defaultdict
            slots_by_hour = defaultdict(list)

            for slot in (booking.time_slots or []):
                slot_start_utc = datetime.fromisoformat(slot['start'].replace('Z', '+00:00'))
                slot_end_utc = datetime.fromisoformat(slot['end'].replace('Z', '+00:00'))

                # Convert UTC to IST
                slot_start_ist = slot_start_utc + IST_OFFSET
                slot_end_ist = slot_end_utc + IST_OFFSET

                # Group by hour (e.g., "08:00-09:00")
                hour_key = f"{slot_start_ist.hour:02d}:00-{slot_end_ist.hour:02d}:00"
                slots_by_hour[hour_key].append({
                    'start_utc': slot_start_utc,
                    'end_utc': slot_end_utc,
                    'start_ist': slot_start_ist,
                    'end_ist': slot_end_ist
                })

            print(f"Creating schedules for {booking.screen_name} across {len(slots_by_hour)} time slots")

            # For each hour, break into consecutive date ranges
            for hour_key, hour_slots in slots_by_hour.items():
                # Sort slots by date
                hour_slots.sort(key=lambda x: x['start_ist'])

                # Find consecutive date ranges
                consecutive_ranges = []
                current_range = [hour_slots[0]]

                for i in range(1, len(hour_slots)):
                    current_slot = hour_slots[i]
                    previous_slot = hour_slots[i - 1]

                    # Check if dates are consecutive (difference of 1 day)
                    date_diff = (current_slot['start_ist'].date() - previous_slot['start_ist'].date()).days

                    if date_diff == 1:
                        # Consecutive - add to current range
                        current_range.append(current_slot)
                    else:
                        # Gap found - save current range and start new one
                        consecutive_ranges.append(current_range)
                        current_range = [current_slot]

                # Don't forget the last range
                consecutive_ranges.append(current_range)

                print(f"  {hour_key}: {len(hour_slots)} slots broken into {len(consecutive_ranges)} consecutive ranges")

                # Create separate schedule for each consecutive range
                for range_idx, date_range in enumerate(consecutive_ranges):
                    first_slot = date_range[0]
                    last_slot = date_range[-1]
                    is_single_day = len(date_range) == 1

                    # Start and end times (hour remains same, just dates change)
                    from_dt = first_slot['start_ist'].strftime("%Y-%m-%d %H:%M:%S")
                    to_dt = first_slot['end_ist'].strftime("%Y-%m-%d %H:%M:%S")

                    # For recurrence range, use last slot's end time
                    recurrence_range = last_slot['end_ist'].strftime("%Y-%m-%d %H:%M:%S")

                    # Generate schedule name with range info
                    if is_single_day:
                        # Single day: include date in name
                        date_str = first_slot['start_ist'].strftime('%d-%b')
                        slot_schedule_name = f"{advertiser_name[:10]}_{booking.screen_name[:15]}_{date_str}_{hour_key}"
                    else:
                        # Multiple days: show range
                        start_date = first_slot['start_ist'].strftime('%d')
                        end_date = last_slot['start_ist'].strftime('%d-%b')
                        slot_schedule_name = f"{advertiser_name[:10]}_{booking.screen_name[:15]}_{start_date}-{end_date}_{hour_key}"

                    slot_schedule_name = slot_schedule_name[:50]  # Screenox limit

                    # Determine recurrence settings
                    if is_single_day:
                        # Single day: NO recurrence, just use from_dt and to_dt
                        final_recurrence_type = None
                        final_recurrence_detail = None
                        final_recurrence_range = None
                        final_recurrence_repeats_on = None
                        print(f"    Range {range_idx + 1}: Single day {first_slot['start_ist'].strftime('%Y-%m-%d')} {hour_key}")
                    else:
                        # Multiple consecutive days: Use daily recurrence
                        final_recurrence_type = "Day"
                        final_recurrence_detail = 1  # Every 1 day
                        final_recurrence_range = recurrence_range
                        final_recurrence_repeats_on = None
                        print(f"    Range {range_idx + 1}: {first_slot['start_ist'].strftime('%Y-%m-%d')} to {last_slot['start_ist'].strftime('%Y-%m-%d')} ({len(date_range)} days) {hour_key}")

                    # Create schedule for this consecutive range
                    result = xibo_service.create_schedule(
                        event_type_id=1,
                        display_group_ids=[booking.xibo_display_group_id],
                        from_dt=from_dt,
                        to_dt=to_dt,
                        campaign_id=campaign_id,
                        # RECURRENCE: Only for multi-day consecutive ranges
                        recurrence_type=final_recurrence_type,
                        recurrence_detail=final_recurrence_detail,
                        recurrence_range=final_recurrence_range,
                        recurrence_repeats_on=final_recurrence_repeats_on,
                        # Other settings
                        day_part_id=booking.schedule_day_part_id,
                        is_priority=booking.schedule_is_priority,
                        display_order=1,
                        name=slot_schedule_name,
                        notes=f"Booking: {booking._id} | Advertiser: {advertiser_name} | Screen: {booking.screen_name}"
                    )

                    if result and result.get('eventId'):
                        schedule_id = result.get('eventId')
                        created_schedules.append(schedule_id)
                        print(f"      ✓ Created schedule {schedule_id}")
                    else:
                        raise Exception(f"Failed to create schedule for {hour_key} range {range_idx + 1}")

            if not created_schedules:
                raise Exception("No schedules were created")

            return (True, created_schedules, None)

        except Exception as e:
            # ROLLBACK: Delete all previously created schedules
            print(f"Error creating schedules, rolling back: {e}")
            for sched_id in created_schedules:
                try:
                    xibo_service.delete_schedule(sched_id)
                    print(f"Rolled back schedule {sched_id}")
                except Exception as del_error:
                    print(f"Error rolling back schedule {sched_id}: {del_error}")

            return (False, [], str(e))

    @staticmethod
    def _create_slot_schedule(
        slot_id: str,
        display_group_id: int,
        campaign_id: int,
        booking: Booking,
        screen_name: str,
        database
    ) -> Optional[int]:
        """Create a single schedule for a time slot (used for selectedSlots format)"""
        try:
            # IST timezone offset (UTC+5:30)
            IST_OFFSET = timedelta(hours=5, minutes=30)

            # Parse slot ID: "2026-01-14T18:30:00.000Z-13"
            # Date is in UTC, hour is in local time (IST)
            last_hyphen_index = slot_id.rfind('-')
            if last_hyphen_index == -1:
                return None

            date_iso_part = slot_id[:last_hyphen_index]
            hour_part = int(slot_id[last_hyphen_index + 1:])

            # Parse as UTC and convert to local to get correct date
            base_date_utc = datetime.fromisoformat(date_iso_part.replace('Z', '+00:00'))
            local_datetime = base_date_utc + IST_OFFSET

            # Create slot times in local timezone (IST)
            slot_start_ist = local_datetime.replace(hour=hour_part, minute=0, second=0, microsecond=0)
            if hour_part == 23:
                slot_end_ist = local_datetime.replace(hour=23, minute=59, second=0, microsecond=0)
            else:
                slot_end_ist = local_datetime.replace(hour=hour_part + 1, minute=0, second=0, microsecond=0)

            # Send IST times to Screenox (CMS is configured with IST timezone)
            from_dt = slot_start_ist.strftime("%Y-%m-%d %H:%M:%S")
            to_dt = slot_end_ist.strftime("%Y-%m-%d %H:%M:%S")

            # Get advertiser name for metadata
            advertiser = database.users.find_one({"_id": ObjectId(booking.advertiser_id)})
            # Check multiple fields: full_name (User model), name (legacy), business_name, or email
            advertiser_name = 'Unknown'
            if advertiser:
                advertiser_name = (
                    advertiser.get('full_name') or
                    advertiser.get('name') or
                    advertiser.get('business_name') or
                    advertiser.get('email', '').split('@')[0] or
                    'Unknown'
                )

            # Screenox requires name <= 50 characters
            # Use IST time for display in schedule name
            schedule_name = f"{advertiser_name[:10]}_{screen_name[:20]}_{slot_start_ist.strftime('%m-%d_%H:%M')}"
            schedule_name = schedule_name[:50]  # Ensure max 50 chars

            result = xibo_service.create_schedule(
                event_type_id=1,
                display_group_ids=[display_group_id],
                from_dt=from_dt,
                to_dt=to_dt,
                campaign_id=campaign_id,
                day_part_id=booking.schedule_day_part_id,
                is_priority=booking.schedule_is_priority,
                display_order=1,
                # Metadata for ScreenOx CMS
                name=schedule_name,
                notes=f"Booking: {booking._id} | Advertiser: {advertiser_name} | Screen: {screen_name}"
            )

            return result.get('eventId') if result else None

        except Exception as e:
            print(f"Error creating schedule for slot {slot_id}: {e}")
            return None


# Singleton instance
booking_service = BookingService()
