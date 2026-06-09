"""
Statistics API Routes - FastAPI Version
Provides endpoints for dashboard statistics and analytics
"""
from fastapi import APIRouter, Depends, HTTPException, Header, Query
from typing import Optional, Dict, Any
from datetime import datetime, timedelta
from bson import ObjectId
import app.config.db
from app.services.auth_service import AuthService

router = APIRouter(prefix="/api/stats", tags=["stats"])


# ============ HELPER FUNCTIONS ============

def get_db():
    """Get database instance"""
    database = app.config.db.db
    if database is None:
        raise RuntimeError("Database not initialized")
    return database


# ============ DEPENDENCIES ============

async def verify_token(
    authorization: Optional[str] = Header(None)
) -> Dict[str, Any]:
    """Verify JWT token from request header"""
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(status_code=401, detail="Authentication required")

    token = authorization.split(' ')[1]
    payload = AuthService.verify_jwt_token(token)

    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return payload


# ============ ENDPOINTS ============

@router.get('/dashboard')
async def get_dashboard_stats(token_payload: dict = Depends(verify_token)):
    """Get real-time dashboard statistics based on user role"""
    try:
        database = get_db()
        user_id = token_payload.get('user_id')

        # Get user to check role
        user = database.users.find_one({"_id": ObjectId(user_id)})
        is_admin = user.get('is_admin', False) if user else False
        is_screen_owner = user.get('is_screen_owner', False) if user else False

        stats = {}

        # Calculate date range for "this month"
        now = datetime.utcnow()
        month_start = datetime(now.year, now.month, 1)

        if is_admin:
            # Admin stats
            total_bookings = database.bookings.count_documents({})
            this_month_bookings = database.bookings.count_documents({
                "created_at": {"$gte": month_start}
            })
            last_month_start = month_start - timedelta(days=30)
            last_month_bookings = database.bookings.count_documents({
                "created_at": {
                    "$gte": last_month_start,
                    "$lt": month_start
                }
            })

            # Current month screens/users
            active_screens = database.screens.count_documents({"status": "active"})
            this_month_screens = database.screens.count_documents({
                "created_at": {"$gte": month_start},
                "status": "active"
            })

            screen_owners = database.users.count_documents({"is_screen_owner": True})
            this_month_owners = database.users.count_documents({
                "is_screen_owner": True,
                "created_at": {"$gte": month_start}
            })

            total_users = database.users.count_documents({})
            this_month_users = database.users.count_documents({
                "created_at": {"$gte": month_start}
            })

            # Calculate percentage changes
            booking_change = 0
            if last_month_bookings > 0:
                booking_change = ((this_month_bookings - last_month_bookings) / last_month_bookings * 100)

            # For screens, owners, and users - show absolute change this month
            screens_change = this_month_screens
            owners_change = this_month_owners
            users_change = this_month_users

            stats = {
                "total_bookings": total_bookings,
                "total_bookings_change": f"+{booking_change:.1f}%" if booking_change >= 0 else f"{booking_change:.1f}%",
                "active_screens": active_screens,
                "active_screens_change": f"+{screens_change}" if screens_change >= 0 else f"{screens_change}",
                "screen_owners": screen_owners,
                "screen_owners_change": f"+{owners_change}" if owners_change >= 0 else f"{owners_change}",
                "total_users": total_users,
                "total_users_change": f"+{users_change}" if users_change >= 0 else f"{users_change}"
            }

        elif is_screen_owner:
            # Screen owner stats
            # Get screens owned by this user
            owner_screens = list(database.screens.find({"screen_owner_id": user_id}))
            screen_ids = [str(s['_id']) for s in owner_screens]

            # Count bookings for owner's screens
            total_bookings = database.bookings.count_documents({
                "screen_id": {"$in": screen_ids}
            })

            active_screens_count = len([s for s in owner_screens if s.get('status') == 'active'])

            # Calculate revenue (sum of paid bookings for owner's screens)
            revenue_pipeline = [
                {"$match": {
                    "screen_id": {"$in": screen_ids},
                    "payment_status": "paid",
                    "created_at": {"$gte": month_start}
                }},
                {"$group": {
                    "_id": None,
                    "total": {"$sum": "$total_amount"}
                }}
            ]
            revenue_result = list(database.bookings.aggregate(revenue_pipeline))
            revenue = revenue_result[0]['total'] if revenue_result else 0

            # Pending approvals count
            pending_creatives = database.bookings.count_documents({
                "screen_id": {"$in": screen_ids},
                "screen_owner_approval": "pending",
                "payment_status": "paid"
            })

            # Approved creatives count
            approved_creatives = database.bookings.count_documents({
                "screen_id": {"$in": screen_ids},
                "screen_owner_approval": "approved"
            })

            # Rejected creatives count
            rejected_creatives = database.bookings.count_documents({
                "screen_id": {"$in": screen_ids},
                "screen_owner_approval": "rejected"
            })

            stats = {
                "my_bookings": total_bookings,
                "my_bookings_change": "+0%",
                "active_screens": active_screens_count,
                "active_screens_change": "+0",
                "revenue": f"₹{revenue:,.0f}",
                "revenue_change": "+0%",
                "pending_creatives": pending_creatives,
                "pending_creatives_change": "0",
                "approved_creatives": approved_creatives,
                "rejected_creatives": rejected_creatives
            }

        else:
            # Advertiser stats
            my_bookings = database.bookings.count_documents({
                "advertiser_id": user_id
            })

            # Calculate total spent (sum of paid bookings)
            spent_pipeline = [
                {"$match": {
                    "advertiser_id": user_id,
                    "payment_status": "paid",
                    "created_at": {"$gte": month_start}
                }},
                {"$group": {
                    "_id": None,
                    "total": {"$sum": "$total_amount"}
                }}
            ]
            spent_result = list(database.bookings.aggregate(spent_pipeline))
            total_spent = spent_result[0]['total'] if spent_result else 0

            # Count unique screens from bookings
            active_bookings = list(database.bookings.find({
                "advertiser_id": user_id,
                "status": {"$in": ["scheduled", "live", "approved"]}
            }))

            # Handle multi-screen bookings
            unique_screens = set()
            for booking in active_bookings:
                if booking.get('booking_type') == 'multi_screen' and booking.get('screens'):
                    for screen in booking['screens']:
                        unique_screens.add(screen.get('screenId'))
                else:
                    unique_screens.add(booking.get('screen_id'))

            active_screens_count = len(unique_screens)

            # Mock impressions (would come from ScreenOx proof-of-play API)
            impressions = "1.2M"  # TODO: Calculate from proof-of-play data

            stats = {
                "my_bookings": my_bookings,
                "my_bookings_change": "+0",
                "total_spent": f"₹{total_spent:,.0f}",
                "total_spent_change": "+0%",
                "active_screens": active_screens_count,
                "active_screens_change": "+0",
                "impressions": impressions,
                "impressions_change": "+0%"
            }

        return {
            "stats": stats,
            "user_role": "admin" if is_admin else ("screen_owner" if is_screen_owner else "advertiser")
        }

    except Exception as e:
        print(f"Error in get_dashboard_stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/bookings-by-status')
async def get_bookings_by_status(token_payload: dict = Depends(verify_token)):
    """Get count of bookings grouped by status"""
    try:
        database = get_db()
        user_id = token_payload.get('user_id')

        # Get user to check role
        user = database.users.find_one({"_id": ObjectId(user_id)})
        is_admin = user.get('is_admin', False) if user else False
        is_screen_owner = user.get('is_screen_owner', False) if user else False

        # Build match query based on role
        match_query = {}
        if not is_admin:
            if is_screen_owner:
                owner_screens = list(database.screens.find({"screen_owner_id": user_id}))
                screen_ids = [str(s['_id']) for s in owner_screens]
                match_query["screen_id"] = {"$in": screen_ids}
            else:
                match_query["advertiser_id"] = user_id

        # Aggregate by status
        pipeline = [
            {"$match": match_query},
            {"$group": {
                "_id": "$status",
                "count": {"$sum": 1}
            }}
        ]

        results = list(database.bookings.aggregate(pipeline))

        status_counts = {item['_id']: item['count'] for item in results}

        return {"status_counts": status_counts}

    except Exception as e:
        print(f"Error in get_bookings_by_status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/recent-activities')
async def get_recent_activities(
    token_payload: dict = Depends(verify_token),
    limit: int = Query(10, ge=1, le=100)
):
    """Get recent activities/notifications for the user"""
    try:
        database = get_db()
        user_id = token_payload.get('user_id')

        # Get user to check role
        user = database.users.find_one({"_id": ObjectId(user_id)})
        is_admin = user.get('is_admin', False) if user else False
        is_screen_owner = user.get('is_screen_owner', False) if user else False

        activities = []

        if is_admin:
            # Admin sees all recent bookings and status changes
            recent_bookings = list(database.bookings.find({}).sort("created_at", -1).limit(limit))

            for booking in recent_bookings:
                screen_name = booking.get('screen_name', 'Unknown Screen')
                activity_type = "booking_created"
                message = f"New booking for {screen_name}"

                if booking.get('status') == 'scheduled':
                    activity_type = "booking_scheduled"
                    message = f"Booking scheduled for {screen_name}"
                elif booking.get('status') == 'approved':
                    activity_type = "booking_approved"
                    message = f"Booking approved for {screen_name}"
                elif booking.get('status') == 'rejected':
                    activity_type = "booking_rejected"
                    message = f"Booking rejected for {screen_name}"
                elif booking.get('payment_status') == 'paid':
                    activity_type = "payment_received"
                    message = f"Payment received for {screen_name}"

                activities.append({
                    "type": activity_type,
                    "message": message,
                    "timestamp": booking.get('created_at', datetime.utcnow()).isoformat(),
                    "booking_id": str(booking.get('_id'))
                })

        elif is_screen_owner:
            # Screen owner sees bookings for their screens
            owner_screens = list(database.screens.find({"screen_owner_id": user_id}))
            screen_ids = [str(s['_id']) for s in owner_screens]

            recent_bookings = list(database.bookings.find({
                "screen_id": {"$in": screen_ids}
            }).sort("created_at", -1).limit(limit))

            for booking in recent_bookings:
                screen_name = booking.get('screen_name', 'Your Screen')
                activity_type = "booking_received"
                message = f"New booking received for {screen_name}"

                if booking.get('screen_owner_approval') == 'approved':
                    activity_type = "creative_approved"
                    message = f"Creative approved for {screen_name}"
                elif booking.get('screen_owner_approval') == 'rejected':
                    activity_type = "creative_rejected"
                    message = f"Creative rejected for {screen_name}"
                elif booking.get('screen_owner_approval') == 'pending' and booking.get('payment_status') == 'paid':
                    activity_type = "pending_review"
                    message = f"New creative awaiting review for {screen_name}"
                elif booking.get('payment_status') == 'paid':
                    activity_type = "payment_received"
                    message = f"Payment received for {screen_name}"

                activities.append({
                    "type": activity_type,
                    "message": message,
                    "timestamp": booking.get('created_at', datetime.utcnow()).isoformat(),
                    "booking_id": str(booking.get('_id'))
                })

        else:
            # Advertiser sees their own bookings
            recent_bookings = list(database.bookings.find({
                "advertiser_id": user_id
            }).sort("created_at", -1).limit(limit))

            for booking in recent_bookings:
                screen_name = booking.get('screen_name', 'Unknown Screen')
                activity_type = "booking_created"
                message = f"Booking created for {screen_name}"

                # Prioritize status-based messages over payment
                if booking.get('status') == 'scheduled':
                    activity_type = "campaign_scheduled"
                    message = f"Campaign scheduled on {screen_name}"
                elif booking.get('status') == 'live':
                    activity_type = "campaign_live"
                    message = f"Campaign is now live on {screen_name}"
                elif booking.get('status') == 'approved':
                    activity_type = "campaign_approved"
                    message = f"Campaign approved for {screen_name}"
                elif booking.get('status') == 'rejected':
                    activity_type = "campaign_rejected"
                    message = f"Campaign rejected for {screen_name}"
                elif booking.get('screen_owner_approval') == 'approved':
                    activity_type = "owner_approved"
                    message = f"Screen owner approved booking for {screen_name}"
                elif booking.get('screen_owner_approval') == 'pending':
                    activity_type = "awaiting_approval"
                    message = f"Awaiting screen owner approval for {screen_name}"
                elif booking.get('payment_status') == 'paid':
                    activity_type = "payment_processed"
                    message = f"Payment processed for {screen_name}"

                activities.append({
                    "type": activity_type,
                    "message": message,
                    "timestamp": booking.get('created_at', datetime.utcnow()).isoformat(),
                    "booking_id": str(booking.get('_id'))
                })

        return {"activities": activities}

    except Exception as e:
        print(f"Error in get_recent_activities: {e}")
        raise HTTPException(status_code=500, detail=str(e))
