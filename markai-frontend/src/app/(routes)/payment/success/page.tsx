"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { verifyPayment } from "@/services/paymentService";
import toast from "react-hot-toast";

function PaymentSuccessContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isVerifying, setIsVerifying] = useState(true);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paymentId = searchParams.get("payment_id");
  const orderId = searchParams.get("order_id");
  const signature = searchParams.get("signature");

  useEffect(() => {
    // Verify payment on mount
    const handlePaymentVerification = async () => {
      if (!paymentId || !orderId || !signature) {
        setError("Missing payment parameters");
        setIsVerifying(false);
        return;
      }

      try {
        setIsVerifying(true);
        setError(null);

        // Verify payment using the payment service
        const result = await verifyPayment({
          orderId: orderId || "",
          paymentId: paymentId || "",
          signature: signature || "",
        });

        console.log("Payment verification result:", result);

        // Defensive check: Ensure result exists and has expected structure
        if (!result) {
          throw new Error("No response from payment verification service");
        }

        if (typeof result !== 'object') {
          throw new Error("Invalid response format from payment verification");
        }

        // Check success status
        if (result.success === true) {
          setIsSuccess(true);
          toast.success(result.message || "Payment verified successfully!");
        } else {
          // Payment verification failed
          const errorMessage = result.message || "Payment verification failed. Please contact support if payment was deducted.";
          setError(errorMessage);
          toast.error(errorMessage);
        }
      } catch (err: any) {
        console.error("Payment verification error:", err);
        const errorMessage = err?.message || err?.error || "Failed to verify payment. Please contact support.";
        setError(errorMessage);
        toast.error(errorMessage);
      } finally {
        setIsVerifying(false);
      }
    };

    handlePaymentVerification();
  }, [paymentId, orderId, signature]);

  return (
    <div className="relative min-h-screen flex items-center justify-center transition-colors duration-300" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div className="dark:block hidden absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(123,67,255,0.15),transparent_50%)]" />

      <div className="relative z-10 w-full max-w-md mx-auto px-6">
        <div className="backdrop-blur-lg border rounded-2xl p-8 text-center space-y-6 transition-all duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
          {isVerifying ? (
            <>
              <div className="flex justify-center">
                <Loader2 className="w-16 h-16 animate-spin transition-colors duration-300" style={{ color: 'var(--accent-purple)' }} />
              </div>
              <div>
                <h1 className="text-2xl font-bold mb-2 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Verifying Payment...</h1>
                <p className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Please wait while we verify your payment.</p>
              </div>
            </>
          ) : isSuccess ? (
            <>
              <div className="flex justify-center">
                <div className="relative">
                  <CheckCircle2 className="w-20 h-20 text-green-500" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-24 h-24 bg-green-500/20 rounded-full animate-ping" />
                  </div>
                </div>
              </div>
              <div>
                <h1 className="text-3xl font-bold mb-2 text-green-400">Payment Successful!</h1>
                <p className="mb-4 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                  Your campaign has been booked successfully. You will receive a confirmation email shortly.
                </p>
                {paymentId && (
                  <div className="rounded-lg p-4 mb-4 text-left transition-colors duration-300" style={{ backgroundColor: 'var(--bg-accent)' }}>
                    <p className="text-sm mb-1 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Payment ID:</p>
                    <p className="text-sm font-mono break-all transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>{paymentId}</p>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-3">
                <Button
                  onClick={() => router.push("/dashboard/bookings")}
                  className="w-full transition-all duration-200"
                  style={{
                    backgroundColor: 'var(--text-primary)',
                    color: 'var(--text-inverse)'
                  }}
                >
                  View My Bookings
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
                <Link href="/browse-screens">
                  <Button
                    variant="outline"
                    className="w-full border transition-colors duration-300"
                    style={{
                      borderColor: 'var(--border-primary)',
                      color: 'var(--text-primary)'
                    }}
                  >
                    Browse More Screens
                  </Button>
                </Link>
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-center">
                <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center">
                  <span className="text-4xl text-red-500">✕</span>
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-bold mb-2 text-red-400">Payment Failed</h1>
                <p className="mb-4 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                  {error || "There was an issue with your payment. Please try again."}
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <Link href="/browse-screens">
                  <Button className="w-full transition-all duration-200" style={{
                    backgroundColor: 'var(--text-primary)',
                    color: 'var(--text-inverse)'
                  }}>
                    Try Again
                  </Button>
                </Link>
                <Link href="/contact">
                  <Button
                    variant="outline"
                    className="w-full border transition-colors duration-300"
                    style={{
                      borderColor: 'var(--border-primary)',
                      color: 'var(--text-primary)'
                    }}
                  >
                    Contact Support
                  </Button>
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="relative min-h-screen flex items-center justify-center transition-colors duration-300" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
          <div className="dark:block hidden absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(123,67,255,0.15),transparent_50%)]" />
          <div className="relative z-10 w-full max-w-md mx-auto px-6">
            <div className="backdrop-blur-lg border rounded-2xl p-8 text-center space-y-6 transition-all duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
              <div className="flex justify-center">
                <Loader2 className="w-16 h-16 animate-spin transition-colors duration-300" style={{ color: 'var(--accent-purple)' }} />
              </div>
              <div>
                <h1 className="text-2xl font-bold mb-2 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Loading...</h1>
                <p className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Please wait.</p>
              </div>
            </div>
          </div>
        </div>
      }
    >
      <PaymentSuccessContent />
    </Suspense>
  );
}

