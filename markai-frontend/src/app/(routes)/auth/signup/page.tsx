"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Country, State, City } from "country-state-city";
import { OTPVerificationDialog } from "@/components/auth/OTPVerificationDialog";
import { useAuth } from "@/contexts/AuthContext";
import { sendOTP, verifyOTP, register } from "@/services/authService";
import toast from "react-hot-toast";

type Step = 1 | 2;

const countryOptions = Country.getAllCountries();
const defaultCountryCode = "IN";
const defaultStateCode = State.getStatesOfCountry(defaultCountryCode)[0]?.isoCode ?? "";

const SignUpForm = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login: authLogin } = useAuth();
  const [step, setStep] = useState<Step>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showOTPDialog, setShowOTPDialog] = useState(false);
  const [otpToken, setOtpToken] = useState("");
  const [error, setError] = useState("");
  const [isGoogleSignup, setIsGoogleSignup] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    name: "",
    password: "",
    confirmPassword: "",
    businessName: "",
    phone: "",
    country: defaultCountryCode,
    state: defaultStateCode,
    city: "",
    website: "",
    googleId: "",
  });

  // Check if this is a Google signup from URL params
  useEffect(() => {
    const google = searchParams.get("google");
    const email = searchParams.get("email");
    const name = searchParams.get("name");
    const googleId = searchParams.get("googleId");

    if (google === "true" && email && name && googleId) {
      setIsGoogleSignup(true);
      setFormData((prev) => ({
        ...prev,
        email: decodeURIComponent(email),
        name: decodeURIComponent(name),
        googleId: decodeURIComponent(googleId),
        password: "google-oauth", // Placeholder, not used for Google signup
      }));
    }
  }, [searchParams]);

  const currentCountry = useMemo(
    () => countryOptions.find((country) => country.isoCode === formData.country),
    [formData.country],
  );

  const stateOptions = useMemo(
    () => State.getStatesOfCountry(formData.country),
    [formData.country],
  );

  const cityOptions = useMemo(
    () => (formData.state ? City.getCitiesOfState(formData.country, formData.state) : []),
    [formData.country, formData.state],
  );

  useEffect(() => {
    if (stateOptions.length && !stateOptions.some((state) => state.isoCode === formData.state)) {
      setFormData((prev) => ({ ...prev, state: stateOptions[0]?.isoCode ?? "" }));
    }
  }, [stateOptions, formData.state]);

  useEffect(() => {
    if (cityOptions.length && !cityOptions.some((city) => city.name === formData.city)) {
      setFormData((prev) => ({ ...prev, city: cityOptions[0]?.name ?? "" }));
    }
  }, [cityOptions, formData.city]);

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setError("");
  };

  const handleNext = async () => {
    if (isGoogleSignup) {
      // Skip OTP for Google signup, go directly to step 2
      setStep(2);
      return;
    }

    // Validate passwords match
    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match");
      toast.error("Passwords do not match");
      return;
    }

    if (formData.password.length < 6) {
      setError("Password must be at least 6 characters long");
      toast.error("Password must be at least 6 characters long");
      return;
    }

    // For normal signup, send OTP first
    setIsSubmitting(true);
    setError("");

    try {
      const response = await sendOTP(formData.email);
      setOtpToken(response.token);
      setShowOTPDialog(true);
      toast.success("OTP sent to your email!");
    } catch (err: any) {
      const errorMessage = err.message || "Failed to send OTP";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOTPVerify = async (otp: string) => {
    try {
      await verifyOTP(otpToken, otp);
      toast.success("Email verified successfully!");
      setShowOTPDialog(false);
      setStep(2);
    } catch (err: any) {
      throw err; // Let OTP dialog handle the error
    }
  };

  const handleOTPResend = async () => {
    try {
      const response = await sendOTP(formData.email);
      setOtpToken(response.token);
      toast.success("OTP resent to your email!");
    } catch (err: any) {
      throw err;
    }
  };

  const handleBack = () => setStep(1);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      const currentCountry = countryOptions.find((c) => c.isoCode === formData.country);
      const currentState = stateOptions.find((s) => s.isoCode === formData.state);

      // Register user (both normal and Google signup use the same register API)
      const response = await register({
        email: formData.email,
        full_name: formData.name,
        password: isGoogleSignup ? "google-oauth" : formData.password, // Placeholder for Google, actual password for normal
        business_name: formData.businessName,
        phone: formData.phone,
        country: currentCountry?.name || "",
        state: currentState?.name || "",
        city: formData.city,
        website: formData.website || undefined,
        ...(isGoogleSignup && formData.googleId ? { google_id: formData.googleId } : {}), // Include google_id for Google signup
      });

      // Auto login after registration
      authLogin(response);
      toast.success("Account created successfully! Redirecting...");
      router.push("/dashboard");
    } catch (err: any) {
      const errorMessage = err.message || "Registration failed";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen pt-24 overflow-hidden transition-colors duration-300" >
      <div className="dark:block hidden absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(47,86,224,0.22),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,rgba(31,196,207,0.12),transparent_55%)]" />
      </div>
      <div className="relative z-10 flex flex-col lg:flex-row min-h-screen">
        <div className="flex-1 flex flex-col justify-center px-6 py-12 lg:px-16">
          <p className="text-sm uppercase tracking-[0.3em] mb-4 font-semibold brand-gradient-text">Mark AI for Brands</p>
          <h1 className="text-4xl lg:text-5xl heading-font font-semibold mb-6 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
            Create your campaign workspace in two simple steps.
          </h1>
          <p className="text-lg transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
            Unlock premium digital inventory, manage bookings, and collaborate with our team in real time.
          </p>
        </div>

        <div className="flex-1 px-6 py-16 lg:px-12 transition-colors duration-300" style={{  borderLeftColor: 'var(--border-primary)', borderLeftWidth: '1px', borderLeftStyle: 'solid' }}>
          <div className="flex items-center justify-between text-sm mb-6 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
            <span>Already have an account?</span>
            <Link href="/auth/login" className="font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }} onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent-purple)'} onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-primary)'}>
              Login
            </Link>
          </div>

          <div className="mb-8 flex items-center gap-4">
            {[1, 2].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center border transition-colors duration-300 ${
                    step === s ? "" : ""
                  }`}
                  style={step === s ? {
                    borderColor: 'var(--text-primary)',
                    backgroundColor: 'var(--text-inverse)',
                    color: 'var(--text-primary)'
                  } : {
                    borderColor: 'var(--border-primary)',
                    color: 'var(--text-tertiary)'
                  }}
                >
                  {s}
                </div>
                {s !== 2 && <div className="w-16 h-px transition-colors duration-300" style={{ backgroundColor: 'var(--border-primary)' }} />}
              </div>
            ))}
          </div>

          <form className="space-y-6" onSubmit={handleSubmit}>
            {step === 1 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-sm transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Work Email</Label>
                  <Input
                    type="email"
                    placeholder="Enter Your Email"
                    value={formData.email}
                    onChange={(event) => handleChange("email", event.target.value)}
                    style={{ backgroundColor: 'var(--bg-accent)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
                    className="py-3 transition-colors duration-300"
                    required
                    disabled={isGoogleSignup}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Full Name</Label>
                  <Input
                    type="text"
                    placeholder="Enter your Name"
                    value={formData.name}
                    onChange={(event) => handleChange("name", event.target.value)}
                    style={{ backgroundColor: 'var(--bg-accent)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
                    className="py-3 transition-colors duration-300"
                    required
                  />
                </div>
                {!isGoogleSignup && (
                  <>
                    <div className="space-y-2">
                      <Label className="text-sm transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>New Password</Label>
                      <PasswordInput
                        placeholder="Create a password"
                        value={formData.password}
                        onChange={(event) => handleChange("password", event.target.value)}
                        style={{ backgroundColor: 'var(--bg-accent)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
                        className="py-3 transition-colors duration-300"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Confirm Password</Label>
                      <PasswordInput
                        placeholder="Confirm your password"
                        value={formData.confirmPassword}
                        onChange={(event) => handleChange("confirmPassword", event.target.value)}
                        style={{ backgroundColor: 'var(--bg-accent)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
                        className="py-3 transition-colors duration-300"
                        required
                      />
                      {formData.password && formData.confirmPassword && formData.password !== formData.confirmPassword && (
                        <p className="text-xs text-red-400">Passwords do not match</p>
                      )}
                    </div>
                  </>
                )}
                {error && (
                  <p className="text-sm text-red-400">{error}</p>
                )}
                <Button
                  type="button"
                  onClick={handleNext}
                  disabled={isSubmitting}
                  className="brand-gradient-bg w-full rounded-full font-semibold py-3 disabled:opacity-70 transition-all duration-300 hover:scale-[1.02] hover:shadow-lg"
                >
                  {isSubmitting ? "Sending OTP..." : "Continue to Business Details"}
                </Button>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-sm transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Business Name</Label>
                  <Input
                    type="text"
                    placeholder="Enter your Business Name"
                    value={formData.businessName}
                    onChange={(event) => handleChange("businessName", event.target.value)}
                    style={{ backgroundColor: 'var(--bg-accent)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
                    className="py-3 transition-colors duration-300"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Phone</Label>
                  <Input
                    type="tel"
                    placeholder="Enter your Phone Number"
                    value={formData.phone}
                    onChange={(event) => handleChange("phone", event.target.value)}
                    style={{ backgroundColor: 'var(--bg-accent)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
                    className="py-3 transition-colors duration-300"
                    required
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Country</Label>
                    <Select
                      value={formData.country}
                      onValueChange={(value) => handleChange("country", value)}
                    >
                      <SelectTrigger
                        style={{ backgroundColor: 'var(--bg-accent)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
                        className="w-full py-3 transition-colors duration-300"
                      >
                        <SelectValue placeholder="Select country" />
                      </SelectTrigger>
                      <SelectContent
                        style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
                        className="z-50 transition-colors duration-300"
                      >
                        {countryOptions.map((country) => (
                          <SelectItem key={country.isoCode} value={country.isoCode}>
                            {country.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>State</Label>
                    <Select
                      value={formData.state}
                      onValueChange={(value) => handleChange("state", value)}
                    >
                      <SelectTrigger
                        style={{ backgroundColor: 'var(--bg-accent)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
                        className="w-full py-3 transition-colors duration-300"
                      >
                        <SelectValue placeholder="Select state" />
                      </SelectTrigger>
                      <SelectContent
                        style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
                        className="z-50 transition-colors duration-300"
                      >
                        {stateOptions.map((state) => (
                          <SelectItem key={state.isoCode} value={state.isoCode}>
                            {state.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>City</Label>
                    <Select
                      value={formData.city}
                      onValueChange={(value) => handleChange("city", value)}
                      disabled={!cityOptions.length}
                    >
                      <SelectTrigger
                        style={{ backgroundColor: 'var(--bg-accent)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
                        className="w-full py-3 disabled:opacity-60 transition-colors duration-300"
                      >
                        <SelectValue placeholder="Select city" />
                      </SelectTrigger>
                      <SelectContent
                        style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
                        className="z-50 w-full max-h-60 transition-colors duration-300"
                      >
                        {cityOptions.map((city) => (
                          <SelectItem key={city.name} value={city.name}>
                            {city.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Website (optional)</Label>
                    <Input
                      type="url"
                      placeholder="Enter your Website"
                      value={formData.website}
                      onChange={(event) => handleChange("website", event.target.value)}
                      style={{ backgroundColor: 'var(--bg-accent)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
                      className="py-3 transition-colors duration-300"
                    />
                  </div>
                </div>

                {error && (
                  <p className="text-sm text-red-400">{error}</p>
                )}

                <div className="flex items-center gap-4 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBack}
                    style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)', backgroundColor: 'transparent' }}
                    className="flex-1 py-3 transition-all duration-300 hover:opacity-80"
                  >
                    Back
                  </Button>
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="brand-gradient-bg flex-2 rounded-full font-semibold py-3 disabled:opacity-70 transition-all duration-300 hover:scale-[1.02] hover:shadow-lg"
                  >
                    {isSubmitting ? "Finishing..." : "Complete Registration"}
                  </Button>
                </div>
              </div>
            )}
          </form>
        </div>
      </div>

      {/* OTP Verification Dialog */}
      {!isGoogleSignup && (
        <OTPVerificationDialog
          open={showOTPDialog}
          onOpenChange={setShowOTPDialog}
          email={formData.email}
          onVerify={handleOTPVerify}
          onResend={handleOTPResend}
        />
      )}
    </div>
  );
};

const SignUpPage = () => {
  return (
    <Suspense
      fallback={
        <div className="relative min-h-screen overflow-hidden flex items-center justify-center transition-colors duration-300" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
          <div className="text-center">
            <p className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Loading...</p>
          </div>
        </div>
      }
    >
      <SignUpForm />
    </Suspense>
  );
};

export default SignUpPage;