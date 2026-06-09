# SMTP Email Setup Guide

## Gmail SMTP Configuration

If you're using Gmail for sending emails, you need to configure it properly.

### Error: `535, b'5.7.8 Username and Password not accepted'`

This error occurs when Gmail rejects your credentials. Here's how to fix it:

### Solution: Use Gmail App Password

1. **Enable 2-Step Verification** (if not already enabled):
   - Go to: https://myaccount.google.com/security
   - Enable "2-Step Verification"

2. **Generate an App Password**:
   - Go to: https://myaccount.google.com/apppasswords
   - Select "Mail" as the app
   - Select "Other (Custom name)" as the device
   - Enter a name like "Mark AI Backend"
   - Click "Generate"
   - Copy the 16-character password (no spaces)

3. **Update your `.env` file**:
   ```env
   SMTP_SERVER=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USERNAME=your-email@gmail.com
   SMTP_PASSWORD=your-16-character-app-password
   SMTP_FROM_EMAIL=your-email@gmail.com
   SMTP_FROM_NAME=Mark AI
   ```

### Important Notes:

- **SMTP_USERNAME**: Must be your full Gmail address (e.g., `user@gmail.com`)
- **SMTP_PASSWORD**: Must be the 16-character App Password (NOT your regular Gmail password)
- **SMTP_FROM_EMAIL**: Usually the same as SMTP_USERNAME
- The App Password is 16 characters without spaces (e.g., `abcd efgh ijkl mnop` → use `abcdefghijklmnop`)

### Alternative: Other Email Providers

If you're using a different email provider, update the SMTP settings:

**Outlook/Hotmail:**
```env
SMTP_SERVER=smtp-mail.outlook.com
SMTP_PORT=587
```

**Yahoo:**
```env
SMTP_SERVER=smtp.mail.yahoo.com
SMTP_PORT=587
```

**Custom SMTP:**
```env
SMTP_SERVER=your-smtp-server.com
SMTP_PORT=587
```

### Testing

After updating your `.env` file, restart your Flask server and try sending an OTP email again.

