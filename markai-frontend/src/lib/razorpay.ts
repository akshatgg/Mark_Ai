import { loadScript } from "./loadScript";
import { RAZORPAY_KEY_ID } from "@/utility/apiUrl";

declare global {
  interface Window {
    Razorpay: any;
  }
}

export interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  image?: string;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  handler: (response: RazorpayResponse) => void;
  modal?: {
    ondismiss: () => void;
  };
  theme?: {
    color?: string;
  };
  config?: {
    display?: {
      blocks?: {
        [key: string]: any;
      };
      sequence?: string[];
      preferences?: {
        show_default_blocks?: boolean;
      };
    };
  };
  notes?: {
    [key: string]: string;
  };
}

export interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

// Load Razorpay script dynamically
export const loadRazorpayScript = (): Promise<boolean> => {
  return new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }

    loadScript("https://checkout.razorpay.com/v1/checkout.js")
      .then(() => {
        resolve(true);
      })
      .catch(() => {
        resolve(false);
      });
  });
};

// Initialize Razorpay payment
export const initiateRazorpayPayment = async (
  options: RazorpayOptions
): Promise<void> => {
  const scriptLoaded = await loadRazorpayScript();

  if (!scriptLoaded) {
    throw new Error("Failed to load Razorpay script");
  }

  if (!window.Razorpay) {
    throw new Error("Razorpay is not available");
  }

  const razorpayOptions: any = {
    key: options.key || RAZORPAY_KEY_ID,
    amount: options.amount,
    currency: options.currency || "INR",
    name: options.name || "Mark AI",
    description: options.description,
    order_id: options.order_id,
    image: options.image || "/mark_ai_logo2-removebg-preview.png",
    prefill: options.prefill || {},
    handler: options.handler,
    modal: {
      ondismiss: () => {
        if (options.modal?.ondismiss) {
          options.modal.ondismiss();
        }
      },
    },
    theme: {
      color: options.theme?.color || "#7B43FF",
    },
    notes: options.notes || {},
  };

  // Add config if provided, otherwise use default (all payment methods including international)
  if (options.config) {
    razorpayOptions.config = options.config;
  }

  const razorpay = new window.Razorpay(razorpayOptions);

  razorpay.open();
};

