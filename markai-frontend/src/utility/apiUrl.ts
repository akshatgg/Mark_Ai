// Your main backend URL
export const apiUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "https://mainbackend.mark-ai.tech";

// Xibo CMS URL for campaigns, displays, and analytics
export const xiboUrl = process.env.NEXT_PUBLIC_XIBO_URL;

// Xibo API Credentials
export const XIBO_CLIENT_ID = process.env.NEXT_PUBLIC_XIBO_CLIENT_ID || "f9a1e40b125374db1aaa5fa031e5b2a5e8d4b057";
export const XIBO_CLIENT_SECRET = process.env.NEXT_PUBLIC_XIBO_CLIENT_SECRET || "de1b935dff37189ca95d69d4d8e1aa16600e5216a6ede875fb77e526c0e011394491a9eb83257a2672e4c725db6920d75f1d9cfe9ea4da6804730e02875b7edae0f026c7db6ce7c10b062cc15175727b06b637a97fe609b956dbba10b8a841f1cb6b875d98d7c260ad9505071ac68b4f93ee6e72d4b75c133f52eadf50293c";

// Razorpay Keys
export const RAZORPAY_KEY_ID = process.env.NEXT_PUBLIC_RAZORPAY_TEST_API_KEY || "rzp_live_S7I0t5kdD1YPXG";
export const RAZORPAY_KEY_SECRET = process.env.NEXT_PUBLIC_RAZORPAY_TEST_API_SECRET || "BLqoTPrDcTV7XFbK9DGATYHD";