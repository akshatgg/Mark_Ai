import smtplib
import random
import string
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta
from typing import Optional
from app.config.config import settings

class EmailService:
    """Service for sending emails via SMTP"""
    
    @staticmethod
    def send_email(to_email: str, subject: str, body: str, html_body: Optional[str] = None) -> bool:
        """Send email via SMTP"""
        try:
            msg = MIMEMultipart('alternative')
            msg['Subject'] = subject
            msg['From'] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_FROM_EMAIL}>"
            msg['To'] = to_email
            print("msg", msg)
            print("settings.SMTP_USERNAME", settings.SMTP_USERNAME)
            print("settings.SMTP_PASSWORD", settings.SMTP_PASSWORD)
            
            # Add plain text version
            msg.attach(MIMEText(body, 'plain'))
            
            # Add HTML version if provided
            if html_body:
                msg.attach(MIMEText(html_body, 'html'))
            
            # Connect to SMTP server
            if not settings.SMTP_USERNAME or not settings.SMTP_PASSWORD:
                print("Error: SMTP_USERNAME or SMTP_PASSWORD not configured in environment variables")
                return False
            
            server = smtplib.SMTP(settings.SMTP_SERVER, settings.SMTP_PORT)
            server.starttls()
            server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            server.send_message(msg)
            server.quit()
            
            return True
        except smtplib.SMTPAuthenticationError as e:
            error_msg = str(e)
            print(f"SMTP Authentication Error: {error_msg}")
            if "BadCredentials" in error_msg or "535" in error_msg:
                print("\n⚠️  Gmail Authentication Failed!")
                print("If you're using Gmail, you need to:")
                print("1. Enable 2-Step Verification on your Google account")
                print("2. Generate an App Password: https://myaccount.google.com/apppasswords")
                print("3. Use the App Password (16 characters) as SMTP_PASSWORD in your .env file")
                print("4. Make sure SMTP_USERNAME is your full Gmail address")
            return False
        except Exception as e:
            print(f"Error sending email: {str(e)}")
            return False
    
    @staticmethod
    def send_otp_email(to_email: str, otp: str) -> bool:
        """Send professional OTP email with Mark AI branding"""
        subject = "Your OTP Verification Code - Mark AI"

        body = f"""
Mark AI - OTP Verification

Your OTP verification code is: {otp}

This code will expire in 10 minutes.

If you didn't request this code, please ignore this email.

Best regards,
Mark AI Team
        """

        html_body = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OTP Verification</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <table role="presentation" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">

                    <!-- Logo Header -->
                    <tr>
                        <td style="padding: 40px 40px 30px; text-align: center; background-color: #ffffff; border-radius: 12px 12px 0 0; border-bottom: 3px solid #1a1a1a;">
                            <img src="https://storage.googleapis.com/careers-crm-data/careers-data/Mark_AI_Logo_02_20260123_140835_d7399e6b.png" alt="Mark AI" style="max-width: 180px; height: auto; margin-bottom: 20px;">
                            <h1 style="margin: 0; color: #1a1a1a; font-size: 26px; font-weight: 600;">OTP Verification</h1>
                        </td>
                    </tr>

                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px;">
                            <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.6;">Hello,</p>
                            <p style="margin: 0 0 30px; color: #555555; font-size: 15px; line-height: 1.6;">Use the following One-Time Password (OTP) to verify your account:</p>

                            <!-- OTP Box - Clean, Professional -->
                            <div style="text-align: center; margin: 35px 0;">
                                <div style="display: inline-block; background-color: #f8f8f8; border: 2px solid #1a1a1a; padding: 25px 45px; border-radius: 10px;">
                                    <span style="font-size: 38px; font-weight: 700; color: #1a1a1a; letter-spacing: 10px; font-family: 'Courier New', monospace;">{otp}</span>
                                </div>
                            </div>

                            <div style="background-color: #fff3cd; border-left: 4px solid: #ffc107; padding: 15px; border-radius: 6px; margin: 30px 0;">
                                <p style="margin: 0; color: #856404; font-size: 14px; line-height: 1.6;">
                                    <strong>⏰ Expires in 10 minutes</strong> - Please use this code promptly.
                                </p>
                            </div>

                            <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">

                            <p style="margin: 0; color: #999999; font-size: 13px; line-height: 1.6; text-align: center;">If you didn't request this verification code, please ignore this email or contact our support team if you have concerns.</p>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 12px 12px; text-align: center; border-top: 1px solid #e0e0e0;">
                            <p style="margin: 0 0 8px; color: #666666; font-size: 13px;">Need help? Contact us at {settings.SMTP_FROM_EMAIL}</p>
                            <p style="margin: 0; color: #999999; font-size: 12px;">© {datetime.now().year} Mark AI. All rights reserved.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
        """
        return EmailService.send_email(to_email, subject, body, html_body)
    
    @staticmethod
    def send_password_reset_email(to_email: str, reset_token: str) -> bool:
        """Send professional password reset email with Mark AI branding"""
        reset_link = f"{settings.FRONTEND_URL}/auth/reset-password?token={reset_token}"
        subject = "Password Reset Request - Mark AI"

        body = f"""
Mark AI - Password Reset Request

You requested to reset your password.

Click the following link to reset your password:
{reset_link}

This link will expire in 1 hour.

If you didn't request this, please ignore this email.

Best regards,
Mark AI Team
        """

        html_body = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Password Reset</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <table role="presentation" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">

                    <!-- Logo Header -->
                    <tr>
                        <td style="padding: 40px 40px 30px; text-align: center; background-color: #ffffff; border-radius: 12px 12px 0 0; border-bottom: 3px solid #1a1a1a;">
                            <img src="https://storage.googleapis.com/careers-crm-data/careers-data/Mark_AI_Logo_02_20260123_140835_d7399e6b.png" alt="Mark AI" style="max-width: 180px; height: auto; margin-bottom: 20px;">
                            <h1 style="margin: 0; color: #1a1a1a; font-size: 26px; font-weight: 600;">Reset Your Password</h1>
                        </td>
                    </tr>

                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px;">
                            <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.6;">Hello,</p>
                            <p style="margin: 0 0 30px; color: #555555; font-size: 15px; line-height: 1.6;">We received a request to reset your password. Click the button below to create a new password for your Mark AI account:</p>

                            <!-- Reset Button - Clean Design -->
                            <div style="text-align: center; margin: 35px 0;">
                                <a href="{reset_link}" style="display: inline-block; background-color: #1a1a1a; color: #ffffff; text-decoration: none; padding: 16px 45px; border-radius: 8px; font-size: 16px; font-weight: 600;">Reset Password</a>
                            </div>

                            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; border: 1px solid #e0e0e0; margin: 30px 0;">
                                <p style="margin: 0 0 10px; color: #666666; font-size: 13px; line-height: 1.6; text-align: center;">Or copy and paste this link into your browser:</p>
                                <p style="margin: 0; color: #1a1a1a; font-size: 12px; line-height: 1.6; word-break: break-all; text-align: center; font-family: 'Courier New', monospace;">{reset_link}</p>
                            </div>

                            <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; border-radius: 6px; margin: 25px 0;">
                                <p style="margin: 0; color: #856404; font-size: 14px; line-height: 1.6;">
                                    <strong>⏰ This link expires in 1 hour</strong>
                                </p>
                            </div>

                            <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">

                            <p style="margin: 0; color: #999999; font-size: 13px; line-height: 1.6; text-align: center;">If you didn't request a password reset, please ignore this email. Your password will remain unchanged and secure.</p>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 12px 12px; text-align: center; border-top: 1px solid #e0e0e0;">
                            <p style="margin: 0 0 8px; color: #666666; font-size: 13px;">Need help? Contact us at {settings.SMTP_FROM_EMAIL}</p>
                            <p style="margin: 0; color: #999999; font-size: 12px;">© {datetime.now().year} Mark AI. All rights reserved.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
        """
        return EmailService.send_email(to_email, subject, body, html_body)

    @staticmethod
    def send_booking_notification_to_owner(owner_email: str, owner_name: str, booking_data: dict) -> bool:
        """Send booking notification email to screen owner"""
        subject = f"New Booking Request - {booking_data.get('screen_name', 'Screen')}"

        # Format dates
        start_date = booking_data.get('start_date', '')
        end_date = booking_data.get('end_date', '')
        if start_date:
            start_date = datetime.fromisoformat(start_date.replace('Z', '+00:00')).strftime('%d %b %Y, %I:%M %p')
        if end_date:
            end_date = datetime.fromisoformat(end_date.replace('Z', '+00:00')).strftime('%d %b %Y, %I:%M %p')

        # Format time slots HTML
        time_slots_html = ""
        time_slots = booking_data.get('time_slots', [])
        if time_slots:
            time_slots_html = '<div style="margin: 20px 0;"><h3 style="color: #333; font-size: 16px; margin: 0 0 10px;">Booked Time Slots:</h3>'
            for idx, slot in enumerate(time_slots[:10], 1):  # Show first 10 slots
                slot_start = slot.get('start', '')
                slot_end = slot.get('end', '')
                if slot_start and slot_end:
                    slot_start_fmt = datetime.fromisoformat(slot_start.replace('Z', '+00:00')).strftime('%d %b, %I:%M %p')
                    slot_end_fmt = datetime.fromisoformat(slot_end.replace('Z', '+00:00')).strftime('%I:%M %p')
                    time_slots_html += f'<div style="background: #f8f9fa; padding: 8px 12px; margin: 5px 0; border-radius: 4px; font-size: 14px;"><strong>Slot {idx}:</strong> {slot_start_fmt} - {slot_end_fmt}</div>'
            if len(time_slots) > 10:
                time_slots_html += f'<p style="color: #666; font-size: 13px; margin: 10px 0 0;">+ {len(time_slots) - 10} more slots</p>'
            time_slots_html += '</div>'

        # Payment info (optional)
        payment_html = ""
        if booking_data.get('total_amount'):
            total_amount = booking_data.get('total_amount', 0)
            currency = booking_data.get('currency', 'INR')
            payment_status = booking_data.get('payment_status', 'pending')
            payment_html = f'''
            <div style="background: #e8f5e9; padding: 15px; border-radius: 6px; border-left: 4px solid #4caf50; margin: 20px 0;">
                <h3 style="color: #2e7d32; font-size: 16px; margin: 0 0 8px;">Payment Information</h3>
                <p style="margin: 5px 0; color: #333; font-size: 14px;"><strong>Amount:</strong> Rs. {total_amount:,.2f} {currency}</p>
                <p style="margin: 5px 0; color: #333; font-size: 14px;"><strong>Status:</strong> <span style="color: #4caf50; text-transform: uppercase; font-weight: 600;">{payment_status}</span></p>
            </div>
            '''

        # Create plain text body
        body = f"""
New Booking Request

Hello {owner_name},

You have received a new booking request for your screen.

Screen: {booking_data.get('screen_name', 'N/A')}
Booking Period: {start_date} to {end_date}
Booking ID: {booking_data.get('booking_id', 'N/A')}
Status: {booking_data.get('status', 'Pending').upper()}

Please log in to your dashboard to review and approve this booking.

Dashboard: {settings.FRONTEND_URL}/dashboard/bookings

Best regards,
{settings.SMTP_FROM_NAME} Team
        """

        # Create HTML body - Professional design with Mark AI logo
        html_body = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>New Booking Notification</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <table role="presentation" style="max-width: 650px; width: 100%; background-color: #ffffff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">

                    <!-- Logo Header -->
                    <tr>
                        <td style="padding: 40px 40px 30px; text-align: center; background-color: #ffffff; border-radius: 12px 12px 0 0; border-bottom: 3px solid #1a1a1a;">
                            <img src="https://storage.googleapis.com/careers-crm-data/careers-data/Mark_AI_Logo_02_20260123_140835_d7399e6b.png" alt="Mark AI" style="max-width: 180px; height: auto; margin-bottom: 20px;">
                            <h1 style="margin: 0; color: #1a1a1a; font-size: 28px; font-weight: 600;">New Booking Request</h1>
                            <p style="margin: 10px 0 0; color: #666666; font-size: 15px;">Your screen has been booked!</p>
                        </td>
                    </tr>

                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px;">
                            <p style="margin: 0 0 25px; color: #333333; font-size: 16px; line-height: 1.6;">Hello <strong>{owner_name}</strong>,</p>
                            <p style="margin: 0 0 30px; color: #555555; font-size: 15px; line-height: 1.6;">You have received a new booking request for your screen. Please review the details below:</p>

                            <!-- Screen Details Box - Clean Design -->
                            <div style="background-color: #f8f9fa; padding: 25px; border-radius: 8px; margin: 25px 0; border: 2px solid #e0e0e0;">
                                <h2 style="margin: 0 0 20px; color: #1a1a1a; font-size: 20px; font-weight: 600; border-bottom: 2px solid #1a1a1a; padding-bottom: 10px;">Booking Details</h2>

                                <div style="margin: 15px 0;">
                                    <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                        <tr>
                                            <td style="padding: 10px 0; color: #666; font-size: 14px; width: 40%;">Screen Name:</td>
                                            <td style="padding: 10px 0; color: #1a1a1a; font-size: 15px; font-weight: 600;">{booking_data.get('screen_name', 'N/A')}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 10px 0; color: #666; font-size: 14px;">Booking ID:</td>
                                            <td style="padding: 10px 0; color: #333; font-size: 14px; font-family: 'Courier New', monospace;">{booking_data.get('booking_id', 'N/A')}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 10px 0; color: #666; font-size: 14px;">Start Date:</td>
                                            <td style="padding: 10px 0; color: #1a1a1a; font-size: 14px; font-weight: 600;">{start_date}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 10px 0; color: #666; font-size: 14px;">End Date:</td>
                                            <td style="padding: 10px 0; color: #1a1a1a; font-size: 14px; font-weight: 600;">{end_date}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 10px 0; color: #666; font-size: 14px;">Status:</td>
                                            <td style="padding: 10px 0;">
                                                <span style="background-color: #fef3c7; color: #92400e; padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: 600; text-transform: uppercase;">{booking_data.get('status', 'Pending')}</span>
                                            </td>
                                        </tr>
                                    </table>
                                </div>
                            </div>

                            <!-- Time Slots -->
                            {time_slots_html}

                            <!-- Payment Info -->
                            {payment_html}

                            <!-- Action Button - Clean Design -->
                            <div style="text-align: center; margin: 35px 0 25px;">
                                <a href="{settings.FRONTEND_URL}/dashboard/bookings" style="display: inline-block; background-color: #1a1a1a; color: #ffffff; text-decoration: none; padding: 16px 45px; border-radius: 8px; font-size: 16px; font-weight: 600;">Review Booking</a>
                            </div>

                            <div style="background-color: #e3f2fd; padding: 16px; border-radius: 8px; border-left: 4px solid #2196f3; margin: 25px 0 0;">
                                <p style="margin: 0; color: #1565c0; font-size: 14px; line-height: 1.6;">
                                    <strong>⏱️ Action Required:</strong> Please review and approve this booking request in your dashboard. The advertiser is waiting for your confirmation.
                                </p>
                            </div>

                            <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">

                            <p style="margin: 0; color: #666; font-size: 14px; line-height: 1.6; text-align: center;">If you have any questions, feel free to contact our support team.</p>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 12px 12px; text-align: center; border-top: 1px solid #e0e0e0;">
                            <p style="margin: 0 0 8px; color: #666; font-size: 13px;">This is an automated notification from Mark AI</p>
                            <p style="margin: 0 0 8px; color: #666666; font-size: 13px;">Need help? Contact us at {settings.SMTP_FROM_EMAIL}</p>
                            <p style="margin: 0; color: #999999; font-size: 12px;">© {datetime.now().year} Mark AI. All rights reserved.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
        """

        return EmailService.send_email(owner_email, subject, body, html_body)

    @staticmethod
    def send_booking_confirmation_to_customer(customer_email: str, customer_name: str, booking_data: dict, invoice_url: Optional[str] = None) -> bool:
        """Send booking confirmation email to customer who made the booking"""
        subject = f"Booking Confirmed - {booking_data.get('screen_name', 'Screen')}"

        # Format dates
        start_date = booking_data.get('start_date', '')
        end_date = booking_data.get('end_date', '')
        if start_date:
            start_date = datetime.fromisoformat(start_date.replace('Z', '+00:00')).strftime('%d %b %Y, %I:%M %p')
        if end_date:
            end_date = datetime.fromisoformat(end_date.replace('Z', '+00:00')).strftime('%d %b %Y, %I:%M %p')

        # Invoice link HTML
        invoice_html = ""
        if invoice_url:
            invoice_html = f'''
            <div style="text-align: center; margin: 30px 0;">
                <a href="{invoice_url}" target="_blank" style="display: inline-block; background-color: #059669; color: #ffffff; text-decoration: none; padding: 14px 35px; border-radius: 8px; font-size: 15px; font-weight: 600;">Download Tax Invoice (PDF)</a>
            </div>
            '''

        body = f"""
Mark AI - Booking Confirmation

Hello {customer_name},

Your booking has been confirmed and payment received successfully!

Screen: {booking_data.get('screen_name', 'N/A')}
Booking ID: {booking_data.get('booking_id', 'N/A')}
Period: {start_date} to {end_date}
Amount Paid: Rs. {booking_data.get('total_amount', 0):.2f}

{'Tax invoice is attached.' if invoice_url else ''}

View your booking details in the dashboard: {settings.FRONTEND_URL}/dashboard/bookings

Thank you for choosing Mark AI!

Best regards,
Mark AI Team
        """

        html_body = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Booking Confirmation</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <table role="presentation" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">

                    <!-- Logo Header -->
                    <tr>
                        <td style="padding: 40px 40px 30px; text-align: center; background-color: #ffffff; border-radius: 12px 12px 0 0; border-bottom: 3px solid #1a1a1a;">
                            <img src="https://storage.googleapis.com/careers-crm-data/careers-data/Mark_AI_Logo_02_20260123_140835_d7399e6b.png" alt="Mark AI" style="max-width: 180px; height: auto; margin-bottom: 20px;">
                            <h1 style="margin: 0; color: #059669; font-size: 28px; font-weight: 600;">✓ Booking Confirmed!</h1>
                            <p style="margin: 10px 0 0; color: #666666; font-size: 15px;">Payment received successfully</p>
                        </td>
                    </tr>

                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px;">
                            <p style="margin: 0 0 25px; color: #333333; font-size: 16px; line-height: 1.6;">Hello <strong>{customer_name}</strong>,</p>
                            <p style="margin: 0 0 30px; color: #555555; font-size: 15px; line-height: 1.6;">Thank you for your booking! Your payment has been received and your advertisement is being processed.</p>

                            <!-- Success Box -->
                            <div style="background-color: #d1fae5; padding: 20px; border-radius: 8px; border-left: 4px solid #059669; margin: 25px 0;">
                                <p style="margin: 0; color: #065f46; font-size: 15px; line-height: 1.6; font-weight: 600;">
                                    ✓ Payment Successful - Booking Confirmed
                                </p>
                            </div>

                            <!-- Booking Details -->
                            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0; border: 1px solid #e0e0e0;">
                                <h2 style="margin: 0 0 15px; color: #1a1a1a; font-size: 18px; font-weight: 600;">Booking Details</h2>

                                <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                    <tr>
                                        <td style="padding: 8px 0; color: #666; font-size: 14px; width: 40%;">Screen:</td>
                                        <td style="padding: 8px 0; color: #1a1a1a; font-size: 14px; font-weight: 600;">{booking_data.get('screen_name', 'N/A')}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 8px 0; color: #666; font-size: 14px;">Booking ID:</td>
                                        <td style="padding: 8px 0; color: #333; font-size: 13px; font-family: 'Courier New', monospace;">{booking_data.get('booking_id', 'N/A')}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 8px 0; color: #666; font-size: 14px;">Start Date:</td>
                                        <td style="padding: 8px 0; color: #1a1a1a; font-size: 14px; font-weight: 600;">{start_date}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 8px 0; color: #666; font-size: 14px;">End Date:</td>
                                        <td style="padding: 8px 0; color: #1a1a1a; font-size: 14px; font-weight: 600;">{end_date}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 8px 0; color: #666; font-size: 14px;">Amount Paid:</td>
                                        <td style="padding: 8px 0; color: #059669; font-size: 16px; font-weight: 700;">Rs. {booking_data.get('total_amount', 0):.2f}</td>
                                    </tr>
                                </table>
                            </div>

                            {invoice_html}

                            <!-- Action Button -->
                            <div style="text-align: center; margin: 30px 0 25px;">
                                <a href="{settings.FRONTEND_URL}/dashboard/bookings" style="display: inline-block; background-color: #1a1a1a; color: #ffffff; text-decoration: none; padding: 16px 45px; border-radius: 8px; font-size: 16px; font-weight: 600;">View My Bookings</a>
                            </div>

                            <div style="background-color: #fff3cd; padding: 16px; border-radius: 8px; border-left: 4px solid #ffc107; margin: 25px 0 0;">
                                <p style="margin: 0; color: #92400e; font-size: 14px; line-height: 1.6;">
                                    <strong>⏱️ Next Steps:</strong> Your booking is now pending screen owner approval. You'll be notified once approved and your ad campaign will go live as scheduled.
                                </p>
                            </div>

                            <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">

                            <p style="margin: 0; color: #666; font-size: 14px; line-height: 1.6; text-align: center;">Questions? Contact our support team anytime.</p>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 12px 12px; text-align: center; border-top: 1px solid #e0e0e0;">
                            <p style="margin: 0 0 8px; color: #666; font-size: 13px;">Thank you for choosing Mark AI!</p>
                            <p style="margin: 0 0 8px; color: #666666; font-size: 13px;">Need help? Contact us at {settings.SMTP_FROM_EMAIL}</p>
                            <p style="margin: 0; color: #999999; font-size: 12px;">© {datetime.now().year} Mark AI. All rights reserved.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
        """

        return EmailService.send_email(customer_email, subject, body, html_body)


class OTPService:
    """Service for generating and managing OTP tokens"""
    
    @staticmethod
    def generate_otp(length: int = 6) -> str:
        """Generate a random OTP"""
        return ''.join(random.choices(string.digits, k=length))
    
    @staticmethod
    def generate_token() -> str:
        """Generate a random token for OTP/password reset"""
        return ''.join(random.choices(string.ascii_letters + string.digits, k=32))

