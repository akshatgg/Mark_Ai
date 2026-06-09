# Screen API CURL Examples

BASE URL FOR THE Local: `http://localhost:5000`
BASE URL FOR THE PRODUCTION: `https://mainbackend.mark-ai.tech`

**Note:** Most endpoints require authentication. Include your JWT token in the `Authorization` header:
```
Authorization: Bearer <your_jwt_token>
```

---

## 1. Create Screen

```bash
curl -X POST http://localhost:5000/api/screens \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "screen_name": "MG Road Cafe Digital Display",
    "description": "Premium LED display screen located at MG Road Cafe",
    "screen_owner_id": "USER_ID_HERE",
    "screen_images": [
      "https://storage.googleapis.com/bucket-name/screens/image1.jpg",
      "https://storage.googleapis.com/bucket-name/screens/image2.jpg"
    ],
    "location": {
      "street": "Raju Mansion, Hebbal Main Road",
      "city": "Bengaluru",
      "country": "India",
      "latitude": 12.9716,
      "longitude": 77.5946
    },
    "technical_details": {
      "width": 12,
      "height": 8,
      "size": "12ft x 8ft",
      "orientation": "landscape"
    },
    "pricing": {
      "price": 15500,
      "currency": "INR",
      "unit": "per week"
    }
  }'
```

**Required Fields:**
- `screen_name` (string): Name of the screen
- `screen_owner_id` (string): ID of the screen owner user

**Optional Fields:**
- `description` (string): Description of the screen
- `screen_images` (array of strings): Array of image URLs
- `location` (object): Location details
  - `street` (string, required if location provided)
  - `city` (string, required if location provided)
  - `country` (string, required if location provided)
  - `latitude` (number): Latitude coordinate
  - `longitude` (number): Longitude coordinate
- `technical_details` (object): Technical specifications
  - `width` (number, required if technical_details provided): Width in feet
  - `height` (number, required if technical_details provided): Height in feet
  - `size` (string, required if technical_details provided): Size description (e.g., "12ft x 8ft")
  - `orientation` (string, required if technical_details provided): "landscape" or "portrait"
- `pricing` (object): Pricing information
  - `price` (number, required if pricing provided): Price amount
  - `currency` (string): Currency code (default: "INR")
  - `unit` (string, required if pricing provided): Pricing unit (e.g., "per day", "per week", "per month")

**Minimal Example:**
```bash
curl -X POST http://localhost:5000/api/screens \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "screen_name": "My Screen",
    "screen_owner_id": "USER_ID_HERE"
  }'
```

---

## 2. Get All Screens (Public - No Auth Required)

```bash
# Using page-based pagination
curl -X GET "http://localhost:5000/api/screens?page=1&limit=50&status=active"

# Using skip-based pagination
curl -X GET "http://localhost:5000/api/screens?skip=0&limit=50&status=active"
```

**Query Parameters:**
- `page` (optional): Page number (default: 1) - used with limit
- `limit` (optional): Number of results per page (default: 100, max: 1000)
- `skip` (optional): Number of results to skip (default: 0) - alternative to page
- `status` (optional): Filter by status (e.g., "active", "inactive")

**Response:**
```json
{
  "screens": [
    {
      "_id": "...",
      "screen_name": "MG Road Cafe Digital Display",
      "description": "...",
      "screen_images": [...],
      "location": {...},
      "technical_details": {...},
      "pricing": {...},
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

**Note:** This endpoint is public and does NOT require authentication.

---

## 3. Get Screen by ID (Public - No Auth Required)

```bash
curl -X GET http://localhost:5000/api/screens/SCREEN_ID_HERE
```

**Note:** This endpoint is public and does NOT require authentication.

---

## 4. Update Screen by ID

```bash
curl -X PUT http://localhost:5000/api/screens/SCREEN_ID_HERE \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "screen_name": "Updated Screen Name",
    "description": "Updated description",
    "screen_images": [
      "https://storage.googleapis.com/bucket-name/screens/new-image1.jpg",
      "https://storage.googleapis.com/bucket-name/screens/new-image2.jpg"
    ],
    "location": {
      "street": "New Street Address",
      "city": "Mumbai",
      "country": "India",
      "latitude": 19.0760,
      "longitude": 72.8777
    },
    "technical_details": {
      "width": 10,
      "height": 6,
      "size": "10ft x 6ft",
      "orientation": "portrait"
    },
    "pricing": {
      "price": 12000,
      "currency": "INR",
      "unit": "per week"
    },
    "status": "active"
  }'
```

**Note:** 
- Only provide fields you want to update. All other fields remain unchanged.
- If updating `location`, all required fields (`street`, `city`, `country`) must be provided.
- If updating `technical_details`, all required fields (`width`, `height`, `size`, `orientation`) must be provided.
- If updating `pricing`, `price` and `unit` must be provided.
- `screen_images` must be an array of URLs.
- Only screen owner or admin can update the screen.

---

## 5. Delete Screen by ID

```bash
curl -X DELETE http://localhost:5000/api/screens/SCREEN_ID_HERE \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Response:**
```json
{
  "message": "Screen deleted successfully"
}
```

**Note:** 
- This will also delete all associated images from Google Cloud Storage (both `screen_images` and `media_gallery`).
- Only screen owner or admin can delete the screen.
- Returns 404 if screen not found.
- Returns 403 if user is not authorized.

---

## 6. Admin: Get All Screens (Admin Only)

```bash
curl -X GET "http://localhost:5000/api/screens/admin/all?limit=50&skip=0&status=active" \
  -H "Authorization: Bearer ADMIN_JWT_TOKEN"
```

**Query Parameters:**
- `limit` (optional): Number of results to return (default: 100)
- `skip` (optional): Number of results to skip (default: 0)
- `status` (optional): Filter by status (e.g., "active", "inactive")

---

## 7. Get Screens by Screen Owner ID

```bash
curl -X GET "http://localhost:5000/api/screens/owner/SCREEN_OWNER_ID?limit=50&skip=0" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Query Parameters:**
- `limit` (optional): Number of results to return (default: 100)
- `skip` (optional): Number of results to skip (default: 0)

**Note:** Users can only view their own screens unless they are admin.

---

## 7. Upload Image to Google Cloud Storage

```bash
curl -X POST http://localhost:5000/api/screens/upload-image \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "file=@/path/to/your/image.jpg" \
  -F "folder=screens"
```

**Form Data:**
- `file` (required): The image file to upload
- `folder` (optional): Folder path in bucket (default: "screens")

**Response:**
```json
{
  "message": "Image uploaded successfully",
  "url": "https://storage.googleapis.com/bucket-name/screens/uuid.jpg",
  "type": "image"
}
```

**Allowed File Types:** jpg, jpeg, png, gif, webp, svg

**Example with different folder:**
```bash
curl -X POST http://localhost:5000/api/screens/upload-image \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "file=@/path/to/your/image.png" \
  -F "folder=venues"
```

---

## 8. Add Media to Screen Gallery

```bash
curl -X POST http://localhost:5000/api/screens/SCREEN_ID_HERE/media \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "type": "image",
    "url": "https://storage.googleapis.com/bucket-name/screens/image.jpg"
  }'
```

**Note:** Use the URL returned from the upload-image endpoint.

---

## Complete Workflow Example

### Step 1: Upload Image
```bash
curl -X POST http://localhost:5000/api/screens/upload-image \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "file=@screen-image.jpg"
```

**Response:**
```json
{
  "url": "https://storage.googleapis.com/bucket-name/screens/abc123.jpg",
  "type": "image"
}
```

### Step 2: Create Screen with Image URL
```bash
curl -X POST http://localhost:5000/api/screens \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "venue_name": "My Screen",
    "screen_owner_id": "USER_ID_HERE",
    "media_gallery": [
      {
        "type": "image",
        "url": "https://storage.googleapis.com/bucket-name/screens/abc123.jpg"
      }
    ]
  }'
```

### Step 3: Add More Images Later
```bash
# Upload another image
curl -X POST http://localhost:5000/api/screens/upload-image \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "file=@another-image.jpg"

# Add to screen gallery
curl -X POST http://localhost:5000/api/screens/SCREEN_ID_HERE/media \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "type": "image",
    "url": "https://storage.googleapis.com/bucket-name/screens/xyz789.jpg"
  }'
```

---

## Error Responses

All endpoints may return error responses:

**401 Unauthorized:**
```json
{
  "error": "Authentication required"
}
```

**403 Forbidden:**
```json
{
  "error": "Admin access required"
}
```
or
```json
{
  "error": "Unauthorized to update this screen"
}
```

**404 Not Found:**
```json
{
  "error": "Screen not found"
}
```

**400 Bad Request:**
```json
{
  "error": "venue_name is required"
}
```

**500 Internal Server Error:**
```json
{
  "error": "Error message here"
}
```

---

## Environment Variables Required

Add these to your `.env` file for Google Cloud Storage:

```env
GCS_BUCKET_NAME=your-bucket-name
GCS_SERVICE_ACCOUNT_PATH=path/to/service-account.json
GCS_PROJECT_ID=your-project-id
GCS_USE_SIGNED_URLS=false
GCS_SIGNED_URL_EXPIRATION=31536000
```

**Note:** Place your `service-account.json` file in your project root or specify the full path in `GCS_SERVICE_ACCOUNT_PATH`.

### Bucket Configuration

**For Uniform Bucket-Level Access (Recommended):**

If your bucket has uniform bucket-level access enabled (which is the default for new buckets), you have two options:

1. **Public URLs (Default):**
   - Configure your bucket's IAM policy to allow public access
   - Go to GCS Console → Your Bucket → Permissions
   - Add principal: `allUsers` with role: `Storage Object Viewer`
   - Set `GCS_USE_SIGNED_URLS=false` in your `.env`

2. **Signed URLs (Alternative):**
   - Works regardless of bucket access settings
   - URLs expire after the specified time (default: 1 year)
   - Set `GCS_USE_SIGNED_URLS=true` in your `.env`
   - Adjust `GCS_SIGNED_URL_EXPIRATION` (in seconds) as needed

**Important:** The error "Cannot get legacy ACL for an object when uniform bucket-level access is enabled" is now fixed. The service will construct public URLs directly or use signed URLs based on your configuration.

