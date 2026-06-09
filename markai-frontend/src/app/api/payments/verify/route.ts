import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { apiUrl } from "@/utility/apiUrl";
import { cookies } from "next/headers";

const BACKEND_URL = apiUrl || "https://mainbackend.mark-ai.tech";

export async function POST(request: NextRequest) {
  try {
    // Get Razorpay key secret at runtime (not at build time)
    const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET ||
                                 process.env.NEXT_PUBLIC_RAZORPAY_TEST_API_SECRET ||
                                 process.env.NEXT_PUBLIC_RAZORPAY_LIVE_API_SECRET;

    // Validate Razorpay credentials
    if (!RAZORPAY_KEY_SECRET) {
      return NextResponse.json(
        {
          success: false,
          error: "Razorpay credentials are not configured. Please check environment variables."
        },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { orderId, paymentId, signature, bookingId, authToken } = body;

    // Validate required fields
    if (!orderId || !paymentId || !signature) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required fields: orderId, paymentId, and signature are required."
        },
        { status: 400 }
      );
    }

    // Verify payment signature locally first
    const text = `${orderId}|${paymentId}`;
    const generatedSignature = crypto
      .createHmac("sha256", RAZORPAY_KEY_SECRET)
      .update(text)
      .digest("hex");

    // Compare signatures
    if (generatedSignature !== signature) {
      console.error("Payment signature mismatch:", {
        received: signature,
        generated: generatedSignature,
      });

      return NextResponse.json(
        {
          success: false,
          error: "Invalid payment signature. Payment verification failed.",
        },
        { status: 400 }
      );
    }

    // Signature is valid - now update booking in Flask backend
    console.log("Payment signature verified, updating backend...");

    // Get auth token from request body or cookies
    const cookieStore = await cookies();
    const token = authToken || cookieStore.get("token")?.value;

    if (!token) {
      console.warn("No auth token available for backend verification");
    }

    // Call Flask backend to verify and update booking
    if (bookingId && token) {
      try {
        const verifyResponse = await fetch(`${BACKEND_URL}/api/bookings/verify-payment`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({
            razorpay_order_id: orderId,
            razorpay_payment_id: paymentId,
            razorpay_signature: signature,
            booking_id: bookingId,
          }),
        });

        const verifyResult = await verifyResponse.json();
        console.log("Backend verification result:", verifyResult);

        if (verifyResponse.ok) {
          // Payment verified and booking updated in backend
          // NOTE: Auto-approval DISABLED - Admin/Owner must manually approve
          // This prevents CMS operations (layout creation, scheduling) during payment
          return NextResponse.json(
            {
              success: true,
              message: "Payment verified! Booking is pending approval.",
              paymentId: paymentId,
              orderId: orderId,
              bookingId: bookingId,
              scheduled: false,
            },
            { status: 200 }
          );
        } else {
          console.error("Backend verification failed:", verifyResult);
        }
      } catch (backendError) {
        console.error("Error calling backend:", backendError);
      }
    }

    // Fallback: Return success even if backend call failed
    // (signature was verified locally)
    return NextResponse.json(
      {
        success: true,
        message: "Payment verified successfully",
        paymentId: paymentId,
        orderId: orderId,
        bookingId: bookingId || null,
      },
      { status: 200 }
    );

  } catch (error: any) {
    console.error("Error verifying payment:", error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to verify payment",
      },
      { status: 500 }
    );
  }
}

