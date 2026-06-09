"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { initiateRazorpayPayment, type RazorpayOptions, type RazorpayResponse } from "@/lib/razorpay";
import { createPaymentOrder, verifyPayment } from "@/services/paymentService";
import { useAuth } from "@/contexts/AuthContext";
import toast from "react-hot-toast";

interface RazorpayPaymentButtonProps {
  amount: number;
  currency?: string;
  screenId: string;
  campaignData: any;
  disabled?: boolean;
  className?: string;
}

interface RazorpayPaymentButtonPropsExtended extends RazorpayPaymentButtonProps {
  style?: React.CSSProperties;
}

export const RazorpayPaymentButton = ({
  amount,
  currency = "INR",
  screenId,
  campaignData,
  disabled = false,
  className = "",
  style,
}: RazorpayPaymentButtonPropsExtended) => {
  const router = useRouter();
  const { user } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);

  const handlePayment = async () => {
    try {
      setIsProcessing(true);

      // Step 1: Create order on backend
      const orderResponse = await createPaymentOrder(
        amount,
        currency,
        screenId,
        campaignData
      );

      // Step 2: Initialize Razorpay payment
      const razorpayOptions: RazorpayOptions = {
        key: orderResponse.key,
        amount: orderResponse.amount,
        currency: orderResponse.currency,
        name: "Mark AI",
        description: `Campaign booking for screen ${screenId}`,
        order_id: orderResponse.orderId,
        prefill: {
          name: user?.name || campaignData.name || "",
          email: user?.email || "",
          contact: "",
        },
        handler: async (response: RazorpayResponse) => {
          try {
            // Step 3: Verify payment on backend
            await verifyPayment({
              orderId: response.razorpay_order_id,
              paymentId: response.razorpay_payment_id,
              signature: response.razorpay_signature,
            });

            // Step 4: Redirect to success page
            router.push(
              `/payment/success?payment_id=${response.razorpay_payment_id}&order_id=${response.razorpay_order_id}&signature=${response.razorpay_signature}`
            );
          } catch (error: any) {
            console.error("Payment verification error:", error);
            toast.error(error.message || "Payment verification failed");
            router.push("/payment/success?error=verification_failed");
          }
        },
        modal: {
          ondismiss: () => {
            setIsProcessing(false);
            toast.error("Payment cancelled");
          },
        },
        theme: {
          // Brand blue — mirrors --brand-blue in theme.css (Razorpay only accepts hex strings)
          color: "#2f56e0",
        },
      };

      await initiateRazorpayPayment(razorpayOptions);
    } catch (error: any) {
      console.error("Payment initiation error:", error);
      toast.error(error.message || "Failed to initiate payment");
      setIsProcessing(false);
    }
  };

  return (
    <Button
      type="button"
      onClick={handlePayment}
      disabled={disabled || isProcessing}
      className={`transition-colors duration-300 ${className}`}
      style={style}
    >
      {isProcessing ? (
        <>
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          Processing...
        </>
      ) : (
        "Make Payment"
      )}
    </Button>
  );
};

