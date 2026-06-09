from datetime import datetime
from typing import Optional
from bson import ObjectId
from passlib.context import CryptContext

# Password hashing context with werkzeug compatibility
# Supports both werkzeug and passlib bcrypt hashes
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Try importing werkzeug for backward compatibility with existing hashes
try:
    from werkzeug.security import check_password_hash as werkzeug_check
    HAS_WERKZEUG = True
except ImportError:
    HAS_WERKZEUG = False

class User:
    """User model for both advertisers and screen owners"""
    
    def __init__(
        self,
        email: str,
        full_name: str,
        password: Optional[str] = None,
        business_name: str = "",
        phone: str = "",
        country: str = "",
        state: str = "",
        city: str = "",
        website: Optional[str] = None,
        is_admin: bool = False,
        is_screen_owner: bool = False,
        is_active: bool = True,
        screen_id: Optional[str] = None,
        google_id: Optional[str] = None,
        _id: Optional[ObjectId] = None,
        created_at: Optional[datetime] = None,
        updated_at: Optional[datetime] = None
    ):
        self._id = _id or ObjectId()
        self.email = email
        self.full_name = full_name
        self.password = pwd_context.hash(password) if password else None
        self.business_name = business_name
        self.phone = phone
        self.country = country
        self.state = state
        self.city = city
        self.website = website
        self.is_admin = is_admin
        self.is_screen_owner = is_screen_owner
        self.is_active = is_active
        self.screen_id = screen_id
        self.google_id = google_id
        self.created_at = created_at or datetime.utcnow()
        self.updated_at = updated_at or datetime.utcnow()
    
    def to_dict(self, include_password: bool = False, for_db: bool = False) -> dict:
        """Convert user to dictionary
        
        Args:
            include_password: Whether to include password hash
            for_db: If True, use datetime objects and ObjectId for MongoDB. If False, use strings for API responses.
        """
        if for_db:
            data = {
                "_id": self._id,
                "email": self.email,
                "full_name": self.full_name,
                "business_name": self.business_name,
                "phone": self.phone,
                "country": self.country,
                "state": self.state,
                "city": self.city,
                "website": self.website,
                "is_admin": self.is_admin,
                "is_screen_owner": self.is_screen_owner,
                "is_active": self.is_active,
                "screen_id": self.screen_id,
                "google_id": self.google_id,
                "created_at": self.created_at,
                "updated_at": self.updated_at
            }
        else:
            data = {
                "_id": str(self._id),
                "email": self.email,
                "full_name": self.full_name,
                "business_name": self.business_name,
                "phone": self.phone,
                "country": self.country,
                "state": self.state,
                "city": self.city,
                "website": self.website,
                "is_admin": self.is_admin,
                "is_screen_owner": self.is_screen_owner,
                "is_active": self.is_active,
                "screen_id": self.screen_id,
                "google_id": self.google_id,
                "created_at": self.created_at.isoformat() if self.created_at else None,
                "updated_at": self.updated_at.isoformat() if self.updated_at else None
            }
        
        if include_password and self.password:
            data["password"] = self.password
        return data
    
    def check_password(self, password: str) -> bool:
        """Check if provided password matches (supports both werkzeug and passlib hashes)"""
        if not self.password:
            return False

        try:
            # Try passlib first (new passwords)
            return pwd_context.verify(password, self.password)
        except Exception as e:
            # If passlib fails and werkzeug is available, try werkzeug (old passwords)
            if HAS_WERKZEUG:
                try:
                    return werkzeug_check(self.password, password)
                except Exception:
                    pass
            print(f"Password verification error: {e}")
            return False
    
    @staticmethod
    def from_dict(data: dict) -> 'User':
        """Create User instance from dictionary"""
        # Handle _id conversion
        user_id = data.get("_id")
        if user_id:
            if not isinstance(user_id, ObjectId):
                try:
                    user_id = ObjectId(user_id)
                except:
                    user_id = None
        else:
            user_id = None
        
        # Handle datetime conversion (MongoDB returns datetime objects)
        created_at = data.get("created_at")
        updated_at = data.get("updated_at")
        
        user = User(
            _id=user_id,
            email=data.get("email", ""),
            full_name=data.get("full_name", ""),
            password=None,  # Will be set separately to preserve hash
            business_name=data.get("business_name", ""),
            phone=data.get("phone", ""),
            country=data.get("country", ""),
            state=data.get("state", ""),
            city=data.get("city", ""),
            website=data.get("website"),
            is_admin=data.get("is_admin", False),
            is_screen_owner=data.get("is_screen_owner", False),
            is_active=data.get("is_active", True),
            screen_id=data.get("screen_id"),
            google_id=data.get("google_id"),
            created_at=created_at,
            updated_at=updated_at
        )
        # Preserve password hash from database (don't re-hash)
        if data.get("password"):
            user.password = data.get("password")
        return user

