import { NextRequest, NextResponse } from "next/server";
import Razorpay from "razorpay";
import { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, apiUrl } from "@/utility/apiUrl";
import { cookies } from "next/headers";

const BACKEND_URL = apiUrl || "https://mainbackend.mark-ai.tech/";

export async function POST(request: NextRequest) {

  console.log("Razorpay API Key ID:", RAZORPAY_KEY_ID );
  console.log("Razorpay API Key Secret:", RAZORPAY_KEY_SECRET );
  
  // Validate Razorpay credentials
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    return NextResponse.json(
      { error: "Razorpay credentials are not configured. Please check environment variables." },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { amount, currency = "INR", screenId, campaignData, authToken } = body;

    // Validate required fields
    if (!amount || amount <= 0) {
      return NextResponse.json(
        { error: "Invalid amount. Amount must be greater than 0." },
        { status: 400 }
      );
    }

    if (!screenId) {
      return NextResponse.json(
        { error: "Screen ID is required." },
        { status: 400 }
      );
    }

    // Get auth token from request body or cookies
    const cookieStore = await cookies();
    const token = authToken || cookieStore.get("token")?.value;

    if (!token) {
      return NextResponse.json(
        { error: "Authentication required. Please login first." },
        { status: 401 }
      );
    }

    // Ensure amount is in paise (smallest currency unit)
    const amountInPaise = Math.round(amount);
    const amountInRupees = amountInPaise / 100;

    // IMPORTANT: Frontend sends total amount WITH GST (18%) already included
    // Backend expects base_amount WITHOUT GST, so we need to reverse-calculate it
    // Formula: base_amount = total_amount / 1.18
    const baseAmountWithoutGst = Math.round((amountInRupees / 1.18) * 100) / 100;

    // Build booking request body
    const bookingRequestBody: any = {
      start_date: campaignData?.startDate || new Date().toISOString(),
      end_date: campaignData?.endDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      base_amount: baseAmountWithoutGst,  // Send base_amount WITHOUT GST - backend will calculate GST
      total_amount: amountInRupees,  // Total with GST for reference
      currency: currency,
      media_url: campaignData?.mediaUrl,
      media_type: campaignData?.mediaType,
      cloudinary_public_id: campaignData?.cloudinaryPublicId,
      // Campaign details
      campaign_name: campaignData?.objective || campaignData?.name,
      business_name: campaignData?.businessName,
      // GST Details (optional)
      gstin: campaignData?.gstin || null,
      gstCompanyName: campaignData?.gstCompanyName || null,
      gstAddress: campaignData?.gstAddress || null,
      gstCity: campaignData?.gstCity || null,
      gstState: campaignData?.gstState || null,
      gstPincode: campaignData?.gstPincode || null,
      // Screenox Day Part for time restriction
      schedule_day_part_id: campaignData?.scheduleDayPartId || null,
      notes: JSON.stringify({
        campaignName: campaignData?.name || "",
        businessName: campaignData?.businessName || "",
        objective: campaignData?.objective || "",
        adType: campaignData?.adType || "",
        selectedSlotsCount: campaignData?.selectedSlotsCount || 0,
        description: campaignData?.description || "",
      }),
    };

    // Check if this is a multi-screen booking
    if (campaignData?.bookingType === "multi_screen" && campaignData?.screens && campaignData.screens.length > 0) {
      // Multi-screen booking
      bookingRequestBody.bookingType = "multi_screen";
      bookingRequestBody.screens = campaignData.screens;
    } else {
      // Single screen booking (legacy)
      bookingRequestBody.bookingType = "single";
      bookingRequestBody.screen_id = screenId;
      bookingRequestBody.screen_name = campaignData?.screenName || "Screen";
      bookingRequestBody.xibo_display_id = campaignData?.xiboDisplayId;
      bookingRequestBody.xibo_display_group_id = campaignData?.xiboDisplayGroupId;
      bookingRequestBody.time_slots = campaignData?.timeSlots || [];
    }

    // Step 1: Create booking in Flask backend (this also creates Razorpay order)
    const bookingResponse = await fetch(`${BACKEND_URL}/api/bookings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(bookingRequestBody),
    });

    const bookingResult = await bookingResponse.json();

    if (!bookingResponse.ok) {
      console.error("Failed to create booking:", bookingResult);

      // If GST validation errors exist, return them specifically
      if (bookingResult.validation_errors) {
        return NextResponse.json(
          {
            error: "GST validation failed",
            validation_errors: bookingResult.validation_errors,
            details: bookingResult.validation_errors.join(", ")
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        {
          error: bookingResult.error || "Failed to create booking",
          details: JSON.stringify(bookingResult)
        },
        { status: bookingResponse.status }
      );
    }

    console.log("Booking created:", bookingResult);

    // Return order details from backend
    // For multi-screen bookings, get the primary booking ID
    const primaryBookingId = bookingResult.bookings
      ? bookingResult.bookings[0]?._id
      : bookingResult.booking?._id;

    if (bookingResult.razorpay_order) {
      return NextResponse.json(
        {
          orderId: bookingResult.razorpay_order.id,
          amount: bookingResult.razorpay_order.amount,
          currency: bookingResult.razorpay_order.currency,
          key: bookingResult.razorpay_order.key_id,
          bookingId: primaryBookingId,
          bookingGroupId: bookingResult.booking_group_id, // For multi-screen bookings
          status: "created",
        },
        { status: 200 }
      );
    }

    // Fallback: Create Razorpay order directly if backend didn't create one
    const razorpay = new Razorpay({
      key_id: RAZORPAY_KEY_ID,
      key_secret: RAZORPAY_KEY_SECRET,
    });

    const timestamp = Date.now().toString();
    const receipt = `rcpt_${timestamp.slice(-10)}_${screenId.slice(-12)}`;

    // Get booking ID - handle both single and multi-screen bookings
    const fallbackBookingId = bookingResult.bookings?.[0]?._id || bookingResult.booking?._id;

    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: currency,
      receipt: receipt,
      notes: { screenId, bookingId: fallbackBookingId },
    });

    return NextResponse.json(
      {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        bookingId: fallbackBookingId,
        status: order.status,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Error creating payment order:", error);

    if (error.error) {
      return NextResponse.json(
        { error: error.error.description || error.error.reason || "Failed to create payment order" },
        { status: error.statusCode || 500 }
      );
    }

    return NextResponse.json(
      { error: error.message || "Failed to create payment order" },
      { status: 500 }
    );
  }
}

