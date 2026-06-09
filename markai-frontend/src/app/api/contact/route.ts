import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { fullName, email, topic, message } = body;

        // Validate required fields
        if (!fullName || !email || !topic || !message) {
            return NextResponse.json(
                { error: 'All fields are required' },
                { status: 400 }
            );
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return NextResponse.json(
                { error: 'Invalid email format' },
                { status: 400 }
            );
        }

        // Create transporter using SMTP credentials
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_SERVER,
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: false, // true for 465, false for other ports
            auth: {
                user: process.env.SMTP_USERNAME,
                pass: process.env.SMTP_PASSWORD,
            },
        });

        // Email content for admin notification
        const adminMailOptions = {
            from: `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_FROM_EMAIL}>`,
            to: process.env.SMTP_FROM_EMAIL, // Send to your contact email
            subject: `New Contact Form Submission: ${topic}`,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            line-height: 1.6;
                            color: #333;
                        }
                        .container {
                            max-width: 600px;
                            margin: 0 auto;
                            padding: 20px;
                            background-color: #f9f9f9;
                        }
                        .header {
                            background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
                            color: white;
                            padding: 20px;
                            text-align: center;
                            border-radius: 8px 8px 0 0;
                        }
                        .content {
                            background: white;
                            padding: 30px;
                            border-radius: 0 0 8px 8px;
                        }
                        .field {
                            margin-bottom: 20px;
                        }
                        .label {
                            font-weight: bold;
                            color: #8b5cf6;
                            margin-bottom: 5px;
                        }
                        .value {
                            color: #333;
                            padding: 10px;
                            background: #f3f4f6;
                            border-left: 3px solid #8b5cf6;
                            border-radius: 4px;
                        }
                        .message-box {
                            background: #f3f4f6;
                            padding: 15px;
                            border-left: 3px solid #8b5cf6;
                            border-radius: 4px;
                            white-space: pre-wrap;
                        }
                        .footer {
                            text-align: center;
                            margin-top: 20px;
                            padding-top: 20px;
                            border-top: 1px solid #e5e7eb;
                            color: #6b7280;
                            font-size: 12px;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1 style="margin: 0;">New Contact Form Submission</h1>
                        </div>
                        <div class="content">
                            <div class="field">
                                <div class="label">Full Name:</div>
                                <div class="value">${fullName}</div>
                            </div>

                            <div class="field">
                                <div class="label">Email:</div>
                                <div class="value">
                                    <a href="mailto:${email}" style="color: #8b5cf6; text-decoration: none;">
                                        ${email}
                                    </a>
                                </div>
                            </div>

                            <div class="field">
                                <div class="label">Topic:</div>
                                <div class="value">${topic}</div>
                            </div>

                            <div class="field">
                                <div class="label">Message:</div>
                                <div class="message-box">${message}</div>
                            </div>

                            <div class="footer">
                                <p>This email was sent from the Mark AI contact form.</p>
                                <p>Received at: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
                            </div>
                        </div>
                    </div>
                </body>
                </html>
            `,
            text: `
New Contact Form Submission

Full Name: ${fullName}
Email: ${email}
Topic: ${topic}

Message:
${message}

---
Received at: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
            `,
        };

        // Send email to admin
        await transporter.sendMail(adminMailOptions);

        // Send auto-reply to user
        const userMailOptions = {
            from: `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_FROM_EMAIL}>`,
            to: email,
            subject: `Thank you for contacting Mark AI`,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            line-height: 1.6;
                            color: #333;
                        }
                        .container {
                            max-width: 600px;
                            margin: 0 auto;
                            padding: 20px;
                            background-color: #f9f9f9;
                        }
                        .header {
                            background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
                            color: white;
                            padding: 30px;
                            text-align: center;
                            border-radius: 8px 8px 0 0;
                        }
                        .content {
                            background: white;
                            padding: 30px;
                            border-radius: 0 0 8px 8px;
                        }
                        .button {
                            display: inline-block;
                            padding: 12px 30px;
                            background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
                            color: white;
                            text-decoration: none;
                            border-radius: 6px;
                            margin-top: 20px;
                        }
                        .footer {
                            text-align: center;
                            margin-top: 20px;
                            padding-top: 20px;
                            border-top: 1px solid #e5e7eb;
                            color: #6b7280;
                            font-size: 12px;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1 style="margin: 0;">Thank You for Reaching Out!</h1>
                        </div>
                        <div class="content">
                            <p>Hi ${fullName},</p>

                            <p>Thank you for contacting Mark AI. We've received your message regarding "<strong>${topic}</strong>" and our team will get back to you shortly.</p>

                            <p>We typically respond within 24 hours during business days.</p>

                            <p><strong>Your Message Summary:</strong></p>
                            <div style="background: #f3f4f6; padding: 15px; border-left: 3px solid #8b5cf6; border-radius: 4px; margin: 15px 0;">
                                ${message}
                            </div>

                            <p>In the meantime, feel free to explore our platform:</p>

                            <div style="text-align: center;">
                                <a href="https://mark-ai.tech/dashboard" class="button" style="color: white;">Browse Screens</a>
                            </div>

                            <div class="footer">
                                <p><strong>Mark AI</strong></p>
                                <p>India's First Browser-Native DOOH Marketplace</p>
                                <p>contact@mark-ai.tech | https://mark-ai.tech</p>
                            </div>
                        </div>
                    </div>
                </body>
                </html>
            `,
            text: `
Hi ${fullName},

Thank you for contacting Mark AI. We've received your message regarding "${topic}" and our team will get back to you shortly.

We typically respond within 24 hours during business days.

Your Message Summary:
${message}

In the meantime, feel free to explore our platform at https://mark-ai.tech

---
Mark AI
India's First Browser-Native DOOH Marketplace
contact@mark-ai.tech | https://mark-ai.tech
            `,
        };

        // Send auto-reply to user
        await transporter.sendMail(userMailOptions);

        return NextResponse.json(
            {
                success: true,
                message: 'Your message has been sent successfully! We\'ll get back to you soon.'
            },
            { status: 200 }
        );

    } catch (error: any) {
        console.error('Contact form error:', error);

        return NextResponse.json(
            {
                error: 'Failed to send message. Please try again later.',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            },
            { status: 500 }
        );
    }
}
