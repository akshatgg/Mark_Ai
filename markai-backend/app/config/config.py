"""
FastAPI Configuration
Uses pydantic-settings for better type safety and validation
"""
import os
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings with environment variable support"""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore"
    )

    # Basic
    SECRET_KEY: str = "change-me"

    # MongoDB
    MONGO_CONNECTION_STRING: Optional[str] = None
    MONGO_DATABASE_NAME: str = "mark_ai"

    # AWS (Legacy - can be removed if not used)
    AWS_ACCESS_KEY: Optional[str] = None
    AWS_SECRET_ACCESS_KEY: Optional[str] = None
    AWS_REGION: Optional[str] = None
    AWS_S3_BUCKET_NAME: Optional[str] = None

    # JWT
    JWT_SECRET_KEY: Optional[str] = None
    JWT_ACCESS_TOKEN_EXPIRES_MINUTES: int = 1440  # 24 hours

    # SMTP Email
    SMTP_SERVER: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USERNAME: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_FROM_EMAIL: Optional[str] = None
    SMTP_FROM_NAME: str = "Mark AI"

    # Frontend
    FRONTEND_URL: str = "https://mark-ai.tech"

    # Google Cloud Storage
    GCS_BUCKET_NAME: Optional[str] = None
    GCS_SERVICE_ACCOUNT_PATH: str = "mesa-startup-lab-ddbe5ec10dbc.json"
    GCS_PROJECT_ID: Optional[str] = None
    GCS_USE_SIGNED_URLS: bool = False
    GCS_SIGNED_URL_EXPIRATION: int = 31536000  # 1 year

    # Xibo CMS (ScreenOx)
    XIBO_URL: str = "https://saas.screenox.in"
    XIBO_CLIENT_ID: Optional[str] = None
    XIBO_CLIENT_SECRET: Optional[str] = None

    # Cloudinary (Legacy - now using GCS)
    CLOUDINARY_CLOUD_NAME: Optional[str] = None
    CLOUDINARY_API_KEY: Optional[str] = None
    CLOUDINARY_API_SECRET: Optional[str] = None

    # Razorpay
    RAZORPAY_KEY_ID: Optional[str] = None
    RAZORPAY_KEY_SECRET: Optional[str] = None

    # Google OAuth
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: Optional[str] = None

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Set JWT_SECRET_KEY to SECRET_KEY if not provided
        if not self.JWT_SECRET_KEY:
            self.JWT_SECRET_KEY = self.SECRET_KEY
        # Set SMTP_FROM_EMAIL to SMTP_USERNAME if not provided
        if not self.SMTP_FROM_EMAIL and self.SMTP_USERNAME:
            self.SMTP_FROM_EMAIL = self.SMTP_USERNAME


@lru_cache()
def get_settings() -> Settings:
    """
    Get cached settings instance
    Using lru_cache ensures we only create one instance
    """
    return Settings()


# Legacy Config class for backward compatibility
class Config:
    """Legacy Config class - redirects to Settings"""
    _settings: Optional[Settings] = None

    @classmethod
    def _get_settings(cls):
        if cls._settings is None:
            cls._settings = get_settings()
        return cls._settings

    @classmethod
    def __getattribute__(cls, name):
        if name.startswith('_') or name in ['_get_settings']:
            return object.__getattribute__(cls, name)
        settings = cls._get_settings()
        return getattr(settings, name)


# For direct imports
settings = get_settings()