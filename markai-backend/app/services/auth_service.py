import jwt
from datetime import datetime, timedelta
from typing import Optional, Dict
from bson import ObjectId
from app.config.config import settings
import app.config.db
from app.models.user import User


def get_db():
    """Get database instance"""
    database = app.config.db.db
    if database is None:
        raise RuntimeError("Database not initialized")
    return database


class AuthService:
    """Service for authentication and JWT token management"""
    
    @staticmethod
    def generate_jwt_token(user_id: str, email: str) -> str:
        """Generate JWT token for user"""
        payload = {
            "user_id": user_id,
            "email": email,
            "exp": datetime.utcnow() + timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRES_MINUTES),
            "iat": datetime.utcnow()
        }
        return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm="HS256")
    
    @staticmethod
    def verify_jwt_token(token: str) -> Optional[Dict]:
        """Verify and decode JWT token"""
        try:
            payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=["HS256"])
            return payload
        except jwt.ExpiredSignatureError:
            return None
        except jwt.InvalidTokenError:
            return None
    
    @staticmethod
    def get_user_by_email(email: str) -> Optional[User]:
        """Get user by email from database"""
        database = get_db()
        if database is None:
            raise ValueError("Database not initialized")
        user_data = database.users.find_one({"email": email})
        if user_data:
            return User.from_dict(user_data)
        return None
    
    @staticmethod
    def get_user_by_id(user_id: str) -> Optional[User]:
        """Get user by ID from database"""
        try:
            database = get_db()
            if database is None:
                print("get_user_by_id: Database not initialized")
                raise ValueError("Database not initialized")
            
            print(f"get_user_by_id: Looking for user_id: {user_id}, type: {type(user_id)}")
            
            # Try to convert to ObjectId
            try:
                object_id = ObjectId(user_id)
                print(f"get_user_by_id: Converted to ObjectId: {object_id}")
            except Exception as e:
                print(f"get_user_by_id: Error converting to ObjectId: {str(e)}")
                return None
            
            # Query database with ObjectId
            user_data = database.users.find_one({"_id": object_id})
            print(f"get_user_by_id: Query result with ObjectId: {user_data}")
            
            # If not found, try querying by string (in case _id is stored as string)
            if not user_data:
                user_data = database.users.find_one({"_id": user_id})
                print(f"get_user_by_id: Query result with string: {user_data}")
            
            if user_data:
                print(f"get_user_by_id: Found user, email: {user_data.get('email')}, _id type: {type(user_data.get('_id'))}")
                user = User.from_dict(user_data)
                print(f"get_user_by_id: Created User object, is_admin: {user.is_admin}")
                return user
            else:
                print(f"get_user_by_id: No user found with _id: {object_id} or {user_id}")
                
                # Debug: Check what users exist
                all_users = list(database.users.find({}).limit(5))
                print(f"get_user_by_id: Sample users in DB (first 5):")
                for u in all_users:
                    print(f"  - _id: {u.get('_id')} (type: {type(u.get('_id'))}), email: {u.get('email')}")
                
        except Exception as e:
            print(f"get_user_by_id: Exception occurred: {str(e)}")
            import traceback
            traceback.print_exc()
        return None
    
    @staticmethod
    def get_user_by_google_id(google_id: str) -> Optional[User]:
        """Get user by Google ID"""
        database = get_db()
        if database is None:
            raise ValueError("Database not initialized")
        user_data = database.users.find_one({"google_id": google_id})
        if user_data:
            return User.from_dict(user_data)
        return None
    
    @staticmethod
    def create_user(user: User) -> User:
        """Create a new user in database"""
        database = get_db()
        if database is None:
            raise ValueError("Database not initialized")
        user_dict = user.to_dict(include_password=True, for_db=True)
        result = database.users.insert_one(user_dict)
        user._id = result.inserted_id
        return user
    
    @staticmethod
    def update_user_password(user_id: str, new_password: str) -> bool:
        """Update user password"""
        from werkzeug.security import generate_password_hash
        try:
            database = get_db()
            if database is None:
                raise ValueError("Database not initialized")
            database.users.update_one(
                {"_id": ObjectId(user_id)},
                {
                    "$set": {
                        "password": generate_password_hash(new_password),
                        "updated_at": datetime.utcnow()
                    }
                }
            )
            return True
        except Exception:
            return False
    
    @staticmethod
    def update_user_admin_status(user_id: str, is_admin: bool) -> Optional[User]:
        """Update user admin status"""
        try:
            database = get_db()
            if database is None:
                raise ValueError("Database not initialized")
            
            result = database.users.update_one(
                {"_id": ObjectId(user_id)},
                {
                    "$set": {
                        "is_admin": is_admin,
                        "updated_at": datetime.utcnow()
                    }
                }
            )
            
            if result.modified_count > 0:
                return AuthService.get_user_by_id(user_id)
        except Exception as e:
            print(f"Error updating user admin status: {str(e)}")
        return None
    
    @staticmethod
    def store_otp_token(email: str, token: str, otp: str) -> bool:
        """Store OTP token in database (expires in 10 minutes)"""
        try:
            database = get_db()
            if database is None:
                print("Error: Database not initialized in store_otp_token")
                raise ValueError("Database not initialized")
            
            # Verify database connection
            print(f"Database name: {database.name}")
            print(f"Database client: {database.client}")
            
            # MongoDB automatically creates collections on first insert
            # But we can explicitly ensure the collection exists
            otp_doc = {
                "email": email,
                "token": token,
                "otp": otp,
                "created_at": datetime.utcnow(),
                "expires_at": datetime.utcnow() + timedelta(minutes=10),
                "used": False
            }
            
            print(f"Attempting to insert OTP token into collection 'otp_tokens'")
            print(f"OTP document: {otp_doc}")
            
            result = database.otp_tokens.insert_one(otp_doc)
            print(f"OTP token stored successfully. Inserted ID: {result.inserted_id}")
            
            # Verify the collection exists and has the document
            count = database.otp_tokens.count_documents({})
            print(f"Total documents in otp_tokens collection: {count}")
            
            return True
        except Exception as e:
            print(f"Error storing OTP token: {str(e)}")
            print(f"Error type: {type(e).__name__}")
            import traceback
            traceback.print_exc()
            return False
    
    @staticmethod
    def verify_otp_token(token: str, otp: str) -> Optional[str]:
        """Verify OTP token and return email if valid"""
        print("token", token);
        print("otp", otp);
        
        try:
            database = get_db()
            if database is None:
                print("Error: Database not initialized in verify_otp_token")
                raise ValueError("Database not initialized")
            otp_data = database.otp_tokens.find_one({
                "token": token,
                "otp": otp,
                "used": False,
                "expires_at": {"$gt": datetime.utcnow()}
            })
            if otp_data:
                # Mark as used
                database.otp_tokens.update_one(
                    {"_id": otp_data["_id"]},
                    {"$set": {"used": True}}
                )
                return otp_data["email"]
        except Exception as e:
            print(f"Error verifying OTP token: {str(e)}")
            import traceback
            traceback.print_exc()
        return None
    
    @staticmethod
    def store_password_reset_token(email: str, token: str) -> bool:
        """Store password reset token (expires in 1 hour)"""
        try:
            database = get_db()
            if database is None:
                print("Error: Database not initialized in store_password_reset_token")
                raise ValueError("Database not initialized")
            result = database.password_reset_tokens.insert_one({
                "email": email,
                "token": token,
                "created_at": datetime.utcnow(),
                "expires_at": datetime.utcnow() + timedelta(hours=1),
                "used": False
            })
            print(f"Password reset token stored successfully. Inserted ID: {result.inserted_id}")
            return True
        except Exception as e:
            print(f"Error storing password reset token: {str(e)}")
            import traceback
            traceback.print_exc()
            return False
    
    @staticmethod
    def verify_password_reset_token(token: str) -> Optional[str]:
        """Verify password reset token and return email if valid"""
        try:
            database = get_db()
            if not database:
                raise ValueError("Database not initialized")
            reset_data = database.password_reset_tokens.find_one({
                "token": token,
                "used": False,
                "expires_at": {"$gt": datetime.utcnow()}
            })
            if reset_data:
                return reset_data["email"]
        except Exception:
            pass
        return None
    
    @staticmethod
    def mark_password_reset_token_used(token: str) -> bool:
        """Mark password reset token as used"""
        try:
            database = get_db()
            if database is None:
                raise ValueError("Database not initialized")
            database.password_reset_tokens.update_one(
                {"token": token},
                {"$set": {"used": True}}
            )
            return True
        except Exception:
            return False
    
    @staticmethod
    def get_all_normal_users(limit: int = 100, skip: int = 0, search: Optional[str] = None) -> tuple:
        """Get all normal users (advertisers, not screen owners)

        Args:
            limit: Maximum number of users to return
            skip: Number of users to skip (for pagination)
            search: Search term to filter users by name, email, phone, or business name

        Returns:
            tuple: (list of users, total count)
        """
        try:
            database = get_db()
            if database is None:
                raise ValueError("Database not initialized")

            # Base query
            query = {"is_screen_owner": False}

            # Add search filter if provided
            if search:
                search_lower = search.lower()
                query["$or"] = [
                    {"full_name": {"$regex": search_lower, "$options": "i"}},
                    {"email": {"$regex": search_lower, "$options": "i"}},
                    {"phone": {"$regex": search_lower, "$options": "i"}},
                    {"business_name": {"$regex": search_lower, "$options": "i"}},
                    {"city": {"$regex": search_lower, "$options": "i"}},
                    {"state": {"$regex": search_lower, "$options": "i"}}
                ]
                # Update query to maintain is_screen_owner filter with search
                query = {
                    "$and": [
                        {"is_screen_owner": False},
                        {
                            "$or": [
                                {"full_name": {"$regex": search_lower, "$options": "i"}},
                                {"email": {"$regex": search_lower, "$options": "i"}},
                                {"phone": {"$regex": search_lower, "$options": "i"}},
                                {"business_name": {"$regex": search_lower, "$options": "i"}},
                                {"city": {"$regex": search_lower, "$options": "i"}},
                                {"state": {"$regex": search_lower, "$options": "i"}}
                            ]
                        }
                    ]
                }

            # Get total count
            total_count = database.users.count_documents(query)

            # Get users
            users_data = database.users.find(query).skip(skip).limit(limit)

            users = [User.from_dict(user) for user in users_data]
            return users, total_count
        except Exception as e:
            print(f"Error getting all normal users: {str(e)}")
            return [], 0
    
    @staticmethod
    def get_all_screen_owners(limit: int = 100, skip: int = 0, search: Optional[str] = None) -> tuple:
        """Get all screen owners

        Args:
            limit: Maximum number of users to return
            skip: Number of users to skip (for pagination)
            search: Search term to filter users by name, email, phone, or business name

        Returns:
            tuple: (list of users, total count)
        """
        try:
            database = get_db()
            if database is None:
                raise ValueError("Database not initialized")

            # Base query
            query = {"is_screen_owner": True}

            # Add search filter if provided
            if search:
                search_lower = search.lower()
                query = {
                    "$and": [
                        {"is_screen_owner": True},
                        {
                            "$or": [
                                {"full_name": {"$regex": search_lower, "$options": "i"}},
                                {"email": {"$regex": search_lower, "$options": "i"}},
                                {"phone": {"$regex": search_lower, "$options": "i"}},
                                {"business_name": {"$regex": search_lower, "$options": "i"}},
                                {"city": {"$regex": search_lower, "$options": "i"}},
                                {"state": {"$regex": search_lower, "$options": "i"}}
                            ]
                        }
                    ]
                }

            # Get total count
            total_count = database.users.count_documents(query)

            # Get users who are screen owners
            users_data = database.users.find(query).skip(skip).limit(limit)

            users = [User.from_dict(user) for user in users_data]
            return users, total_count
        except Exception as e:
            print(f"Error getting all screen owners: {str(e)}")
            return [], 0

    @staticmethod
    def update_screen_owner(user_id: str, update_data: dict) -> Optional[User]:
        """Update screen owner details including active status

        Args:
            user_id: ID of the user to update
            update_data: Dictionary containing fields to update

        Returns:
            Updated User object or None if failed
        """
        try:
            database = get_db()
            if database is None:
                raise ValueError("Database not initialized")

            # Only allow updating specific fields
            allowed_fields = ['full_name', 'business_name', 'phone', 'country', 'state', 'city', 'website', 'is_active']
            update_set = {}

            for field in allowed_fields:
                if field in update_data:
                    update_set[field] = update_data[field]

            # Always update the updated_at timestamp
            update_set['updated_at'] = datetime.utcnow()

            if not update_set:
                return AuthService.get_user_by_id(user_id)

            result = database.users.update_one(
                {"_id": ObjectId(user_id)},
                {"$set": update_set}
            )

            if result.modified_count > 0 or result.matched_count > 0:
                return AuthService.get_user_by_id(user_id)

            return None
        except Exception as e:
            print(f"Error updating screen owner: {str(e)}")
            import traceback
            traceback.print_exc()
            return None
