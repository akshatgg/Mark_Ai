# API CURL Examples

Base URL: `http://localhost:5000`

## 1. Register Normal User (Advertiser)

```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "advertiser@example.com",
    "full_name": "John Doe",
    "password": "SecurePassword123!",
    "business_name": "My Advertising Agency",
    "phone": "+1234567890",
    "country": "United States",
    "state": "California",
    "city": "Los Angeles",
    "website": "https://mybusiness.com"
  }'
```

## 2. Register Screen Owner

```bash
curl -X POST http://localhost:5000/api/auth/register/screen-owner \
  -H "Content-Type: application/json" \
  -d '{
    "email": "screenowner@example.com",
    "full_name": "Jane Smith",
    "password": "SecurePassword123!",
    "business_name": "Screen Display Co",
    "phone": "+1234567891",
    "country": "United States",
    "state": "New York",
    "city": "New York City",
    "website": "https://screendisplay.com"
  }'
```

## 3. Login with Email and Password

```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "advertiser@example.com",
    "password": "SecurePassword123!"
  }'
```

**Response:**
```json
{
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "_id": "...",
    "email": "advertiser@example.com",
    "full_name": "John Doe",
    ...
  }
}
```

## 4. Login with Google OAuth

```bash
curl -X POST http://localhost:5000/api/auth/login/google \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@gmail.com",
    "google_id": "123456789012345678901",
    "full_name": "Google User"
  }'
```

**Response:**
```json
{
  "message": "Google login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "_id": "...",
    "email": "user@gmail.com",
    "full_name": "Google User",
    "google_id": "123456789012345678901",
    ...
  }
}
```

## 5. Send OTP to Email

```bash
curl -X POST http://localhost:5000/api/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com"
  }'
```

**Response:**
```json
{
  "message": "OTP sent successfully",
  "token": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
}
```

**Note:** The OTP will be sent to the email address. Save the `token` for verification.

## 6. Verify OTP

```bash
curl -X POST http://localhost:5000/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{
    "token": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
    "otp": "123456"
  }'
```

**Response:**
```json
{
  "message": "OTP verified successfully",
  "email": "user@example.com"
}
```

## 7. Forgot Password (Send Reset Token)

```bash
curl -X POST http://localhost:5000/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com"
  }'
```

**Response:**
```json
{
  "message": "Password reset token sent successfully",
  "token": "x9y8z7w6v5u4t3s2r1q0p9o8n7m6l5k4"
}
```

**Note:** The reset token will be sent to the email address. Save the `token` for password reset.

## 8. Reset Password

```bash
curl -X POST http://localhost:5000/api/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "token": "x9y8z7w6v5u4t3s2r1q0p9o8n7m6l5k4",
    "password": "NewSecurePassword123!"
  }'
```

**Response:**
```json
{
  "message": "Password reset successfully"
}
```

---

## 9. Admin: Get All Normal Users (Advertisers)

```bash
# Using page-based pagination
curl -X GET "http://localhost:5000/api/auth/admin/users/normal?page=1&limit=50" \
  -H "Authorization: Bearer ADMIN_JWT_TOKEN"

# Using skip-based pagination
curl -X GET "http://localhost:5000/api/auth/admin/users/normal?skip=0&limit=50" \
  -H "Authorization: Bearer ADMIN_JWT_TOKEN"
```

**Query Parameters:**
- `page` (optional): Page number (default: 1) - used with limit
- `limit` (optional): Number of results per page (default: 100, max: 1000)
- `skip` (optional): Number of results to skip (default: 0) - alternative to page

**Response:**
```json
{
  "users": [
    {
      "_id": "...",
      "email": "user@example.com",
      "full_name": "John Doe",
      "is_admin": false,
      "is_screen_owner": false,
      ...
    }
  ],
  "pagination": {
    "total": 150,
    "count": 50,
    "page": 1,
    "pages": 3,
    "limit": 50,
    "skip": 0,
    "has_next": true,
    "has_prev": false
  }
}
```

**Pagination Fields:**
- `total`: Total number of users matching the query
- `count`: Number of users in current response
- `page`: Current page number
- `pages`: Total number of pages
- `limit`: Results per page
- `skip`: Number of results skipped
- `has_next`: Whether there are more results
- `has_prev`: Whether there are previous results

**Note:** Admin access required.

---

## 10. Admin: Get All Screen Owners

```bash
# Using page-based pagination
curl -X GET "http://localhost:5000/api/auth/admin/users/screen-owners?page=1&limit=50" \
  -H "Authorization: Bearer ADMIN_JWT_TOKEN"

# Using skip-based pagination
curl -X GET "http://localhost:5000/api/auth/admin/users/screen-owners?skip=0&limit=50" \
  -H "Authorization: Bearer ADMIN_JWT_TOKEN"
```

**Query Parameters:**
- `page` (optional): Page number (default: 1) - used with limit
- `limit` (optional): Number of results per page (default: 100, max: 1000)
- `skip` (optional): Number of results to skip (default: 0) - alternative to page

**Response:**
```json
{
  "users": [
    {
      "_id": "...",
      "email": "screenowner@example.com",
      "full_name": "Jane Smith",
      "is_admin": false,
      "is_screen_owner": true,
      "screen_id": "SCREEN-001",
      ...
    }
  ],
  "pagination": {
    "total": 25,
    "count": 25,
    "page": 1,
    "pages": 1,
    "limit": 50,
    "skip": 0,
    "has_next": false,
    "has_prev": false
  }
}
```

**Pagination Fields:**
- `total`: Total number of screen owners
- `count`: Number of users in current response
- `page`: Current page number
- `pages`: Total number of pages
- `limit`: Results per page
- `skip`: Number of results skipped
- `has_next`: Whether there are more results
- `has_prev`: Whether there are previous results

**Note:** Admin access required.

---

## 11. Set User Admin Status

```bash
curl -X PUT http://localhost:5000/api/auth/admin/users/USER_ID_HERE/set-admin \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "is_admin": true
  }'
```

**Response:**
```json
{
  "message": "User admin status updated to true",
  "user": {
    "_id": "...",
    "email": "user@example.com",
    "is_admin": true,
    ...
  }
}
```

**Note:** 
- If no admins exist in the system, any authenticated user can set the first admin
- After the first admin is set, only existing admins can set admin status
- Use this endpoint to promote a user to admin or demote an admin to regular user

---

## Using JWT Token in Authenticated Requests

After login, you'll receive a JWT token. Use it in the `Authorization` header for protected endpoints:

```bash
curl -X GET http://localhost:5000/api/protected-endpoint \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

Or using the `auth_token` header (as configured in CORS):

```bash
curl -X GET http://localhost:5000/api/protected-endpoint \
  -H "auth_token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

## Error Responses

All endpoints may return error responses in this format:

```json
{
  "error": "Error message here"
}
```

Common HTTP status codes:
- `200` - Success
- `201` - Created (for registration)
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (invalid credentials)
- `404` - Not Found
- `500` - Internal Server Error

```bash
curl --location 'http://localhost:5000/api/screens/upload-image' \
--header 'Authorization: Bearer AUTH_TOKEN' \
--form 'file=@"/C:/Users/Lenovo/Downloads/Alumni-1-3.webp"'

```