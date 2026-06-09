"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export const PaymentDialog = ({ open, onOpenChange, onSuccess }: PaymentDialogProps) => {
  const [isProcessing, setIsProcessing] = useState(true);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (open) {
      setIsProcessing(true);
      setIsSuccess(false);

      // Simulate payment processing for 2-3 seconds
      const processingTimer = setTimeout(() => {
        setIsProcessing(false);
        setIsSuccess(true);
      }, 2500);

      return () => clearTimeout(processingTimer);
    } else {
      // Reset states when dialog closes
      setIsProcessing(true);
      setIsSuccess(false);
    }
  }, [open]);

  const handleClose = () => {
    if (!isProcessing && isSuccess) {
      onSuccess?.();
      onOpenChange(false);
    } else if (!isProcessing) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md transition-colors duration-300" style={{ backgroundColor: 'var(--bg-primary)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>
        <DialogHeader className="space-y-2 text-center">
          {isProcessing ? (
            <>
              <div className="flex justify-center mb-4">
                <div className="relative">
                  <Loader2 className="w-16 h-16 text-[var(--brand-blue)] animate-spin" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-12 h-12 border-4 border-[var(--brand-blue)]/30 border-t-[var(--brand-blue)] rounded-full animate-spin" />
                  </div>
                </div>
              </div>
              <DialogTitle className="text-2xl heading-font transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Processing Payment</DialogTitle>
              <DialogDescription className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                Please wait while we process your payment...
              </DialogDescription>
            </>
          ) : (
            <>
              <div className="flex justify-center mb-4">
                <div className="relative">
                  <CheckCircle2 className="w-16 h-16 text-green-500" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-20 h-20 bg-green-500/20 rounded-full animate-ping" />
                  </div>
                </div>
              </div>
              <DialogTitle className="text-2xl heading-font text-green-400">
                Payment Successful!
              </DialogTitle>
              <DialogDescription className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                Your campaign has been booked successfully. You will receive a confirmation email shortly.
              </DialogDescription>
            </>
          )}
        </DialogHeader>

        {isSuccess && (
          <div className="mt-6 flex justify-center">
            <button
              onClick={handleClose}
              className="px-6 py-3 font-semibold rounded-lg hover:opacity-90 transition-all duration-300"
              style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)' }}
            >
              Close
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

