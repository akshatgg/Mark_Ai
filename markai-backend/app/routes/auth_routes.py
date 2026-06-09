from fastapi import APIRouter, Request, HTTPException, Depends, Header, Query
from pydantic import BaseModel, EmailStr
from typing import Optional
from app.services.auth_service import AuthService
from app.services.email_service import EmailService, OTPService
from app.models.user import User
from werkzeug.security import generate_password_hash
from datetime import datetime

router = APIRouter(prefix='/api/auth', tags=['auth'])


# Pydantic models for request bodies
class RegisterRequest(BaseModel):
    email: EmailStr
    full_name: str
    password: str
    business_name: str
    phone: str
    country: str
    state: str
    city: str
    website: Optional[str] = None
    google_id: Optional[str] = None


class RegisterScreenOwnerRequest(BaseModel):
    email: EmailStr
    full_name: str
    password: str
    business_name: str
    phone: str
    country: str
    state: str
    city: str
    website: Optional[str] = None
    screen_id: Optional[str] = None
    google_id: Optional[str] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class GoogleLoginRequest(BaseModel):
    email: EmailStr
    google_id: str
    full_name: Optional[str] = ''


class SendOTPRequest(BaseModel):
    email: EmailStr


class VerifyOTPRequest(BaseModel):
    token: str
    otp: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    password: str


class SetAdminRequest(BaseModel):
    is_admin: Optional[bool] = True


def verify_token(authorization: Optional[str] = Header(None), auth_token: Optional[str] = Header(None)):
    """Verify JWT token from request - FastAPI dependency"""
    token = authorization or auth_token
    if token:
        if token.startswith('Bearer '):
            token = token[7:]
        payload = AuthService.verify_jwt_token(token)
        if payload:
            return payload
    raise HTTPException(status_code=401, detail="Authentication required")


def is_admin(user_id: str) -> bool:
    """Check if user is admin"""
    try:
        if not user_id:
            print("is_admin: user_id is None or empty")
            return False

        user = AuthService.get_user_by_id(user_id)
        print("user", user)
        if not user:
            print(f"is_admin: User not found for user_id: {user_id}")
            return False

        is_admin_value = user.is_admin
        print(f"is_admin: User {user_id} - is_admin={is_admin_value}, email={user.email}")
        return is_admin_value is True
    except Exception as e:
        print(f"is_admin: Error checking admin status: {str(e)}")
        import traceback
        traceback.print_exc()
        return False


@router.post('/register')
def register(data: RegisterRequest):
    """Register a new user (advertiser)"""
    try:
        email = data.email.lower().strip()

        # Check if user already exists
        existing_user = AuthService.get_user_by_email(email)
        if existing_user:
            raise HTTPException(status_code=400, detail="User with this email already exists")

        # For Google OAuth users, don't store password
        # They can set a password later via forgot password if needed
        password = None if data.google_id else data.password

        # Create user with default values
        user = User(
            email=email,
            full_name=data.full_name,
            password=password,
            business_name=data.business_name,
            phone=data.phone,
            country=data.country,
            state=data.state,
            city=data.city,
            website=data.website,
            google_id=data.google_id,
            is_admin=False,  # Default false
            is_screen_owner=False  # Default false
        )

        user = AuthService.create_user(user)
        token = AuthService.generate_jwt_token(str(user._id), user.email)

        return {
            "message": "User registered successfully",
            "token": token,
            "user": user.to_dict()
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/register/screen-owner')
def register_screen_owner(data: RegisterScreenOwnerRequest):
    """Register a new screen owner"""
    try:
        email = data.email.lower().strip()

        # Check if user already exists
        existing_user = AuthService.get_user_by_email(email)
        if existing_user:
            raise HTTPException(status_code=400, detail="User with this email already exists")

        # For Google OAuth users, don't store password
        # They can set a password later via forgot password if needed
        password = None if data.google_id else data.password

        # Create screen owner
        user = User(
            email=email,
            full_name=data.full_name,
            password=password,
            business_name=data.business_name,
            phone=data.phone,
            country=data.country,
            state=data.state,
            city=data.city,
            website=data.website,
            google_id=data.google_id,
            is_admin=False,  # Default false
            is_screen_owner=True,
            screen_id=data.screen_id  # Optional field
        )

        user = AuthService.create_user(user)
        token = AuthService.generate_jwt_token(str(user._id), user.email)

        return {
            "message": "Screen owner registered successfully",
            "token": token,
            "user": user.to_dict()
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/login')
def login(data: LoginRequest):
    """Login with email and password"""
    try:
        email = data.email.lower().strip()
        password = data.password
        print("email", email)
        print("password", password)

        # Get user from database
        user = AuthService.get_user_by_email(email)
        print("user", user)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid email or password")

        # Check if user account is active
        if not user.is_active:
            raise HTTPException(status_code=403, detail="Your account has been deactivated. Please contact support.")

        # Check if user was created via Google auth (no password)
        if user.password is None and user.google_id:
            raise HTTPException(status_code=401, detail="Please sign in with Google")

        # Check password
        if not user.check_password(password):
            raise HTTPException(status_code=401, detail="Invalid email or password")

        # Generate JWT token
        token = AuthService.generate_jwt_token(str(user._id), user.email)

        return {
            "message": "Login successful",
            "token": token,
            "user": user.to_dict()
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Login error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/login/google')
def login_google(data: GoogleLoginRequest, request: Request):
    """Login/Register with Google OAuth"""
    try:
        email = data.email.lower().strip()
        google_id = data.google_id
        full_name = data.full_name

        # Check if user exists by Google ID
        user = AuthService.get_user_by_google_id(google_id)

        if not user:
            # Check if user exists by email
            user = AuthService.get_user_by_email(email)

            if user:
                # Update existing user with Google ID
                database = getattr(request.app.state, 'db', None)
                if database is not None:
                    database.users.update_one(
                        {"_id": user._id},
                        {"$set": {"google_id": google_id, "updated_at": datetime.utcnow()}}
                    )
                user.google_id = google_id
            else:
                # User does not exist - return error
                raise HTTPException(status_code=404, detail="User not found. Please register first.")
        else:
            # Update email if it changed
            if user.email != email:
                database = getattr(request.app.state, 'db', None)
                if database is not None:
                    database.users.update_one(
                        {"_id": user._id},
                        {"$set": {"email": email, "updated_at": datetime.utcnow()}}
                    )
                user.email = email

        # Check if user account is active
        if not user.is_active:
            raise HTTPException(status_code=403, detail="Your account has been deactivated. Please contact support.")

        # Generate JWT token
        token = AuthService.generate_jwt_token(str(user._id), user.email)

        return {
            "message": "Google login successful",
            "token": token,
            "user": user.to_dict()
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/send-otp')
def send_otp(data: SendOTPRequest):
    """Send OTP to email"""
    try:
        email = data.email.lower().strip()

        # Generate OTP and token
        otp = OTPService.generate_otp()
        token = OTPService.generate_token()

        # Store OTP token
        AuthService.store_otp_token(email, token, otp)

        # Send email
        email_sent = EmailService.send_otp_email(email, otp)

        if not email_sent:
            raise HTTPException(status_code=500, detail="Failed to send OTP email")

        return {
            "message": "OTP sent successfully",
            "token": token
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/verify-otp')
def verify_otp(data: VerifyOTPRequest):
    """Verify OTP with token"""
    try:
        token = data.token
        otp = data.otp

        # Verify OTP
        email = AuthService.verify_otp_token(token, otp)

        if not email:
            raise HTTPException(status_code=400, detail="Invalid or expired OTP")

        return {
            "message": "OTP verified successfully",
            "email": email
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/forgot-password')
def forgot_password(data: ForgotPasswordRequest):
    """Send password reset token to email"""
    try:
        email = data.email.lower().strip()

        # Check if user exists
        user = AuthService.get_user_by_email(email)
        if not user:
            # Don't reveal if user exists or not for security
            return {
                "message": "If the email exists, a password reset token has been sent"
            }

        # Generate reset token
        token = OTPService.generate_token()

        # Store reset token
        AuthService.store_password_reset_token(email, token)

        # Send email
        email_sent = EmailService.send_password_reset_email(email, token)

        if not email_sent:
            raise HTTPException(status_code=500, detail="Failed to send password reset email")

        return {
            "message": "Password reset token sent successfully",
            "token": token
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/reset-password')
def reset_password(data: ResetPasswordRequest):
    """Reset password using token"""
    try:
        token = data.token
        password = data.password

        # Verify token
        email = AuthService.verify_password_reset_token(token)

        if not email:
            raise HTTPException(status_code=400, detail="Invalid or expired token")

        # Get user
        user = AuthService.get_user_by_email(email)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        # Update password
        success = AuthService.update_user_password(str(user._id), password)

        if not success:
            raise HTTPException(status_code=500, detail="Failed to update password")

        # Mark token as used
        AuthService.mark_password_reset_token_used(token)

        return {
            "message": "Password reset successfully"
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/admin/users/normal')
def get_all_normal_users(
    token_payload: dict = Depends(verify_token),
    limit: int = Query(default=100, ge=1, le=1000),
    page: int = Query(default=1, ge=1),
    skip: int = Query(default=0, ge=0),
    search: Optional[str] = Query(None, description="Search by name, email, phone, or business name")
):
    """Admin API: Get all normal users (advertisers)"""
    try:
        # Check if user is admin
        user_id = token_payload.get('user_id')
        print(f"get_all_normal_users: Checking admin for user_id: {user_id}")
        if not is_admin(user_id):
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "Admin access required",
                    "user_id": user_id,
                    "message": "Your account does not have admin privileges"
                }
            )

        # If page is provided, calculate skip
        if page > 1:
            skip = (page - 1) * limit

        users, total_count = AuthService.get_all_normal_users(limit=limit, skip=skip, search=search)

        # Calculate pagination metadata
        total_pages = (total_count + limit - 1) // limit if total_count > 0 else 0
        current_page = (skip // limit) + 1 if skip > 0 else 1

        return {
            "users": [user.to_dict() for user in users],
            "pagination": {
                "total": total_count,
                "count": len(users),
                "page": current_page,
                "pages": total_pages,
                "limit": limit,
                "skip": skip,
                "has_next": skip + len(users) < total_count,
                "has_prev": skip > 0
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/admin/users/screen-owners')
def get_all_screen_owners(
    token_payload: dict = Depends(verify_token),
    limit: int = Query(default=100, ge=1, le=1000),
    page: int = Query(default=1, ge=1),
    skip: int = Query(default=0, ge=0),
    search: Optional[str] = Query(None, description="Search by name, email, phone, or business name")
):
    """Admin API: Get all screen owners"""
    try:
        # Check if user is admin
        user_id = token_payload.get('user_id')
        print(f"get_all_screen_owners: Checking admin for user_id: {user_id}")
        if not is_admin(user_id):
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "Admin access required",
                    "user_id": user_id,
                    "message": "Your account does not have admin privileges"
                }
            )

        # If page is provided, calculate skip
        if page > 1:
            skip = (page - 1) * limit

        users, total_count = AuthService.get_all_screen_owners(limit=limit, skip=skip, search=search)

        # Calculate pagination metadata
        total_pages = (total_count + limit - 1) // limit if total_count > 0 else 0
        current_page = (skip // limit) + 1 if skip > 0 else 1

        return {
            "users": [user.to_dict() for user in users],
            "pagination": {
                "total": total_count,
                "count": len(users),
                "page": current_page,
                "pages": total_pages,
                "limit": limit,
                "skip": skip,
                "has_next": skip + len(users) < total_count,
                "has_prev": skip > 0
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put('/admin/users/{user_id}/set-admin')
def set_user_admin_status(user_id: str, data: Optional[SetAdminRequest] = None, token_payload: dict = Depends(verify_token), request: Request = None):
    """Admin API: Set user admin status (for setting first admin or promoting users)"""
    try:
        # Check if user is admin OR if no admins exist yet (for setting first admin)
        current_user_id = token_payload.get('user_id')

        # Check if any admin exists
        database = getattr(request.app.state, 'db', None)
        if database is None:
            raise HTTPException(status_code=500, detail="Database not initialized")

        admin_count = database.users.count_documents({"is_admin": True})

        # Allow if user is admin OR if no admins exist (for setting first admin)
        if admin_count == 0:
            print("No admins exist, allowing first admin creation")
        elif not is_admin(current_user_id):
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "Admin access required",
                    "message": "Only admins can set admin status"
                }
            )

        is_admin_value = data.is_admin if data else True

        # Update user admin status
        updated_user = AuthService.update_user_admin_status(user_id, is_admin_value)

        if not updated_user:
            raise HTTPException(status_code=404, detail="Failed to update admin status or user not found")

        return {
            "message": f"User admin status updated to {is_admin_value}",
            "user": updated_user.to_dict()
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put('/admin/users/screen-owners/{user_id}')
def update_screen_owner(user_id: str, data: dict, token_payload: dict = Depends(verify_token)):
    """Admin API: Update screen owner details"""
    try:
        # Check if user is admin
        current_user_id = token_payload.get('user_id')
        if not is_admin(current_user_id):
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "Admin access required",
                    "message": "Your account does not have admin privileges"
                }
            )

        if not data:
            raise HTTPException(status_code=400, detail="Update data is required")

        # Update screen owner
        updated_user = AuthService.update_screen_owner(user_id, data)

        if not updated_user:
            raise HTTPException(status_code=404, detail="Failed to update screen owner or user not found")

        return {
            "message": "Screen owner updated successfully",
            "user": updated_user.to_dict()
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
