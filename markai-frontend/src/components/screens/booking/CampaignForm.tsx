"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Upload, Loader2, CheckCircle, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RazorpayPaymentButton } from "./RazorpayPaymentButton";
import toast from "react-hot-toast";
import { apiUrl } from "@/utility/apiUrl";

const BACKEND_URL = apiUrl || "https://api.mark-ai.tech/api";

interface CampaignFormData {
  name: string;
  businessName: string;
  objective: string;
  description: string;
  adType: string;
  // GST Details
  gstin: string;
  gstCompanyName: string;
  gstAddress: string;
  gstCity: string;
  gstState: string;
  gstPincode: string;
}

interface UploadedMedia {
  url: string;
  publicId: string;
  mediaType: string;
}

interface TimeSlot {
  start: string;
  end: string;
  screenId?: string;
}

interface ScreenData {
  screenId: string;
  screenName: string;
  xiboDisplayId?: number;
  xiboDisplayGroupId?: number;
  selectedSlots: string[];
  pricing: {
    baseHourlyRate: number;
    slotsCount: number;
    subtotal: number;
  };
}

interface TierBreakdownItem {
  frequency: string;
  label: string;
  units: number;
  days: number;
  slots: number;
  baseAmount: number;
  discountPercent: number;
  discountAmount: number;
  finalAmount: number;
}

interface CampaignFormProps {
  basePrice: number;
  selectedSlotsCount: number;
  onSubmit: (data: CampaignFormData, file: File | null) => void;
  isSubmitting?: boolean;
  screenId?: string;
  screenName?: string;
  startDate?: string;
  endDate?: string;
  xiboDisplayId?: number;
  xiboDisplayGroupId?: number;
  selectedTimeSlots?: TimeSlot[];
  // Multi-screen props
  screensData?: ScreenData[];
  totalAmount?: number;
  totalSlots?: number;
  isMultiScreen?: boolean;
  // Discount props
  discountPercent?: number;
  discountAmount?: number;
  appliedOfferLabel?: string;
  // Tiered pricing props
  tierBreakdown?: TierBreakdownItem[];
  isTieredPricing?: boolean;
}

// Get auth token from cookies
const getAuthToken = (): string | null => {
  if (typeof window !== "undefined") {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'token') {
        return decodeURIComponent(value);
      }
    }
  }
  return null;
};

export const CampaignForm = ({
  basePrice,
  selectedSlotsCount,
  onSubmit,
  isSubmitting = false,
  screenId,
  screenName,
  startDate,
  endDate,
  xiboDisplayId,
  xiboDisplayGroupId,
  selectedTimeSlots = [],
  screensData = [],
  totalAmount,
  totalSlots,
  isMultiScreen = false,
  discountPercent = 0,
  discountAmount = 0,
  appliedOfferLabel = "",
  tierBreakdown = [],
  isTieredPricing = false,
}: CampaignFormProps) => {
  const params = useParams();
  const screenIdParam = screenId || (params?.id as string) || "";

  const [formData, setFormData] = useState<CampaignFormData>({
    name: "",
    businessName: "",
    objective: "",
    description: "",
    adType: "",
    // GST Details
    gstin: "",
    gstCompanyName: "",
    gstAddress: "",
    gstCity: "",
    gstState: "",
    gstPincode: "",
  });

  const [showGstForm, setShowGstForm] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedMedia, setUploadedMedia] = useState<UploadedMedia | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // GST Validation states
  const [gstValidationErrors, setGstValidationErrors] = useState<string[]>([]);
  const [gstValidationWarnings, setGstValidationWarnings] = useState<string[]>([]);
  const [isValidatingGst, setIsValidatingGst] = useState(false);
  const [gstinValid, setGstinValid] = useState<boolean | null>(null);
  const [suggestedState, setSuggestedState] = useState<string>("");


  const baseAmount = isMultiScreen && totalAmount !== undefined ? totalAmount : basePrice * selectedSlotsCount;
  const finalSlotsCount = isMultiScreen && totalSlots !== undefined ? totalSlots : selectedSlotsCount;

  // GST Calculation (18% - ALWAYS APPLIED)
  const gstAmount = Math.round(baseAmount * 0.18 * 100) / 100;
  const totalFare = Math.round((baseAmount + gstAmount) * 100) / 100;

  // Upload file to Cloudinary via backend
  const uploadMediaToCloudinary = async (file: File): Promise<UploadedMedia | null> => {
    const token = getAuthToken();
    if (!token) {
      toast.error("Please login to upload media");
      return null;
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${BACKEND_URL}/api/media/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to upload media');
      }

      // Determine media type based on file extension/type
      let mediaType = 'image';
      if (file.type.startsWith('video/') || file.name.toLowerCase().endsWith('.mp4')) {
        mediaType = 'video';
      }

      return {
        url: result.media.url,
        publicId: result.media.public_id,
        mediaType: mediaType,
      };
    } catch (error: any) {
      console.error("Media upload error:", error);
      setUploadError(error.message || "Failed to upload media");
      toast.error(error.message || "Failed to upload media");
      return null;
    } finally {
      setIsUploading(false);
    }
  };

  // Validate GST details with backend
  const validateGstDetails = async () => {
    if (!formData.gstin) {
      setGstValidationErrors([]);
      setGstValidationWarnings([]);
      setGstinValid(null);
      return;
    }

    // Basic format check before API call
    const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    if (!gstinPattern.test(formData.gstin)) {
      setGstValidationErrors(["Invalid GSTIN format. Expected: 27AABCU9603R1ZV"]);
      setGstinValid(false);
      return;
    }

    setIsValidatingGst(true);

    try {
      const response = await fetch(`${BACKEND_URL}/api/bookings/validate-gst`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          gstin: formData.gstin,
          gstCompanyName: formData.gstCompanyName,
          gstAddress: formData.gstAddress,
          gstCity: formData.gstCity,
          gstState: formData.gstState,
          gstPincode: formData.gstPincode,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        setGstValidationErrors(result.errors || []);
        setGstValidationWarnings(result.warnings || []);
        setGstinValid(result.valid);

        // Set suggested state from GSTIN
        if (result.gstin_state) {
          setSuggestedState(result.gstin_state);

          // Auto-fill state if empty
          if (!formData.gstState && result.gstin_state) {
            setFormData((prev) => ({ ...prev, gstState: result.gstin_state }));
          }
        }

        if (result.valid) {
          toast.success("GST details validated successfully!");
        } else if (result.errors && result.errors.length > 0) {
          toast.error(result.errors[0]);
        }
      } else {
        setGstValidationErrors([result.error || "Validation failed"]);
        setGstinValid(false);
      }
    } catch (error) {
      console.error("GST validation error:", error);
      setGstValidationErrors(["Failed to validate GST details"]);
      setGstinValid(false);
    } finally {
      setIsValidatingGst(false);
    }
  };

  // Debounce GST validation
  useEffect(() => {
    if (!showGstForm) return;

    const timer = setTimeout(() => {
      validateGstDetails();
    }, 800); // Validate after 800ms of no typing

    return () => clearTimeout(timer);
  }, [formData.gstin, formData.gstCompanyName, formData.gstAddress, formData.gstCity, formData.gstState, formData.gstPincode, showGstForm]);

  // Prepare campaign data for payment (includes media URL)
  const getCampaignData = () => {
    const baseData = {
      ...formData,
      selectedSlotsCount: finalSlotsCount,
      base_amount: baseAmount,  // Send base amount to backend
      totalFare,  // Total with GST (for backwards compatibility)
      startDate: startDate || new Date().toISOString(),
      endDate: endDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      // Media info from Cloudinary upload
      mediaUrl: uploadedMedia?.url || null,
      mediaType: uploadedMedia?.mediaType || formData.adType || null,
      cloudinaryPublicId: uploadedMedia?.publicId || null,
      // GST Details (optional, for tax invoice)
      gstin: formData.gstin || null,
      gstCompanyName: formData.gstCompanyName || null,
      gstAddress: formData.gstAddress || null,
      gstCity: formData.gstCity || null,
      gstState: formData.gstState || null,
      gstPincode: formData.gstPincode || null,
      // Individual time slots for separate schedules
      timeSlots: selectedTimeSlots,
    };

    if (isMultiScreen && screensData.length > 0) {
      // Multi-screen booking
      return {
        ...baseData,
        bookingType: "multi_screen",
        screens: screensData,
      };
    } else {
      // Single screen booking (legacy)
      return {
        ...baseData,
        bookingType: "single",
        screenId: screenIdParam,
        screenName: screenName || "Screen",
        xiboDisplayId: xiboDisplayId,
        xiboDisplayGroupId: xiboDisplayGroupId,
      };
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file type - Images and Videos allowed
      const supportedTypes = [
        // Images
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'image/webp',
        // Videos
        'video/mp4',
        'video/webm',
        'video/quicktime',
      ];
      const supportedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.webm', '.mov'];
      const fileName = file.name.toLowerCase();
      const hasValidExtension = supportedExtensions.some(ext => fileName.endsWith(ext));

      if (!supportedTypes.includes(file.type) && !hasValidExtension) {
        toast.error("Unsupported file format. Please use JPG, PNG, GIF, MP4, or WebM.");
        return;
      }

      // Validate file size (max 100MB)
      const maxSize = 100 * 1024 * 1024;
      if (file.size > maxSize) {
        toast.error("File too large. Maximum size is 100MB.");
        return;
      }

      setUploadedFile(file);

      // Automatically upload to Cloudinary
      const result = await uploadMediaToCloudinary(file);
      if (result) {
        setUploadedMedia(result);
        toast.success("Media uploaded successfully!");
      }
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Form validation is handled, payment will be triggered by RazorpayPaymentButton
  };

  // Check if form is valid for payment
  const isFormValid = formData.name && formData.businessName && formData.objective &&
                      formData.description && formData.adType && uploadedMedia &&
                      selectedSlotsCount > 0;

  return (
    <div className="backdrop-blur-lg rounded-2xl p-6 sticky top-8 transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border-primary)' }}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label className="text-sm transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>Name</Label>
          <Input
            type="text"
            placeholder="Your full name"
            value={formData.name}
            onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
            className="transition-colors duration-300"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
            required
          />
        </div>

        <div className="space-y-2">
          <Label className="text-sm transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>Business Name</Label>
          <Input
            type="text"
            placeholder="Your business name"
            value={formData.businessName}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, businessName: e.target.value }))
            }
            className="transition-colors duration-300"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
            required
          />
        </div>

        <div className="space-y-2">
          <Label className="text-sm transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>Objective</Label>
          <Input
            type="text"
            placeholder="Campaign objective"
            value={formData.objective}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, objective: e.target.value }))
            }
            className="transition-colors duration-300"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
            required
          />
        </div>

        <div className="space-y-2">
          <Label className="text-sm transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>Ad Type</Label>
          <Select
            value={formData.adType}
            onValueChange={(value) => setFormData((prev) => ({ ...prev, adType: value }))}
          >
            <SelectTrigger className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>
              <SelectValue placeholder="Select ad type" />
            </SelectTrigger>
            <SelectContent className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>
              <SelectItem value="image">Image (JPG, PNG, GIF)</SelectItem>
              <SelectItem value="video">Video (MP4, WebM)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-sm transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>Upload Ad Creative *</Label>
          <div className="relative">
            <input
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/gif,image/webp,.jpg,.jpeg,.png,.gif,.webp,video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
              onChange={handleFileUpload}
              className="hidden"
              id="file-upload"
              disabled={isUploading}
            />
            <label
              htmlFor="file-upload"
              className={`flex items-center gap-2 p-4 border-2 border-dashed rounded-lg cursor-pointer transition-colors duration-300 ${
                uploadedMedia
                  ? "border-green-500/50 bg-green-500/10"
                  : uploadError
                  ? "border-red-500/50 bg-red-500/10"
                  : ""
              }`}
              style={!uploadedMedia && !uploadError ? { borderColor: 'var(--border-primary)' } : {}}
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
                  <span className="text-sm text-purple-400">Uploading to cloud...</span>
                </>
              ) : uploadedMedia ? (
                <>
                  <CheckCircle className="w-5 h-5 text-green-400" />
                  <span className="text-sm text-green-400">
                    {uploadedFile?.name} (Uploaded)
                  </span>
                </>
              ) : uploadError ? (
                <>
                  <XCircle className="w-5 h-5 text-red-400" />
                  <span className="text-sm text-red-400">{uploadError}</span>
                </>
              ) : (
                <>
                  <Upload className="w-5 h-5 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
                  <span className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                    Click to upload (JPG, PNG, GIF, MP4, WebM - max 100MB)
                  </span>
                </>
              )}
            </label>
          </div>
          {uploadedMedia && (
            <p className="text-xs text-gray-500">
              Your ad will be displayed on the screen during your booking period.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-sm transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>Description</Label>
          <Textarea
            placeholder="Describe your campaign..."
            value={formData.description}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, description: e.target.value }))
            }
            className="min-h-[100px] transition-colors duration-300"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
            required
          />
        </div>

        {/* GST Details (Optional - for tax invoice) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>GST Details (Optional)</Label>
            <button
              type="button"
              onClick={() => setShowGstForm(!showGstForm)}
              className="text-xs text-purple-400 hover:text-purple-300 underline transition-colors duration-300"
            >
              {showGstForm ? "Hide" : "Add for Tax Invoice"}
            </button>
          </div>

          {showGstForm && (
            <div className="space-y-3 p-4 rounded-lg transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border-primary)' }}>
              <p className="text-xs mb-2 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                Provide your GST details to receive a tax invoice
              </p>

              <div className="space-y-2">
                <Label className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>GSTIN *</Label>
                <div className="relative">
                  <Input
                    type="text"
                    placeholder="27AABCU9603R1ZV"
                    value={formData.gstin}
                    onChange={(e) => {
                      setFormData((prev) => ({ ...prev, gstin: e.target.value.toUpperCase() }));
                      setGstinValid(null); // Reset validation state on change
                    }}
                    className={`text-sm pr-10 transition-colors duration-300 ${
                      gstinValid === true ? 'border-green-500' :
                      gstinValid === false ? 'border-red-500' : ''
                    }`}
                    style={gstinValid === null ? { backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' } : {}}
                    maxLength={15}
                  />
                  {isValidatingGst && (
                    <Loader2 className="w-4 h-4 text-purple-400 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
                  )}
                  {!isValidatingGst && gstinValid === true && (
                    <CheckCircle className="w-4 h-4 text-green-400 absolute right-3 top-1/2 -translate-y-1/2" />
                  )}
                  {!isValidatingGst && gstinValid === false && (
                    <XCircle className="w-4 h-4 text-red-400 absolute right-3 top-1/2 -translate-y-1/2" />
                  )}
                </div>
                {gstValidationErrors.length > 0 && (
                  <div className="space-y-1">
                    {gstValidationErrors.map((error, idx) => (
                      <p key={idx} className="text-xs text-red-400">{error}</p>
                    ))}
                  </div>
                )}
                {gstValidationWarnings.length > 0 && (
                  <div className="space-y-1">
                    {gstValidationWarnings.map((warning, idx) => (
                      <p key={idx} className="text-xs text-yellow-400">{warning}</p>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Company Name *</Label>
                <Input
                  type="text"
                  placeholder="Your Company Pvt Ltd"
                  value={formData.gstCompanyName}
                  onChange={(e) => setFormData((prev) => ({ ...prev, gstCompanyName: e.target.value }))}
                  className="text-sm transition-colors duration-300"
                  style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Address *</Label>
                <Textarea
                  placeholder="Company registered address"
                  value={formData.gstAddress}
                  onChange={(e) => setFormData((prev) => ({ ...prev, gstAddress: e.target.value }))}
                  className="text-sm min-h-[60px] transition-colors duration-300"
                  style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>City *</Label>
                  <Input
                    type="text"
                    placeholder="Mumbai"
                    value={formData.gstCity}
                    onChange={(e) => setFormData((prev) => ({ ...prev, gstCity: e.target.value }))}
                    className="text-sm transition-colors duration-300"
                    style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>PIN Code *</Label>
                  <Input
                    type="text"
                    placeholder="400001"
                    value={formData.gstPincode}
                    onChange={(e) => setFormData((prev) => ({ ...prev, gstPincode: e.target.value }))}
                    className="text-sm transition-colors duration-300"
                    style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                    maxLength={6}
                    pattern="[0-9]{6}"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>State *</Label>
                  {suggestedState && formData.gstState !== suggestedState && (
                    <span className="text-xs text-blue-400">
                      GSTIN suggests: {suggestedState}
                    </span>
                  )}
                </div>
                <Select
                  value={formData.gstState}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, gstState: value }))}
                >
                  <SelectTrigger className={`text-sm transition-colors duration-300 ${
                    suggestedState && formData.gstState === suggestedState ? 'border-green-500' :
                    suggestedState && formData.gstState && formData.gstState !== suggestedState ? 'border-yellow-500' : ''
                  }`} style={!suggestedState || !formData.gstState || formData.gstState === suggestedState ? { backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' } : {}}>
                    <SelectValue placeholder="Select state" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px] transition-colors duration-300" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>
                    <SelectItem value="Andhra Pradesh">Andhra Pradesh</SelectItem>
                    <SelectItem value="Arunachal Pradesh">Arunachal Pradesh</SelectItem>
                    <SelectItem value="Assam">Assam</SelectItem>
                    <SelectItem value="Bihar">Bihar</SelectItem>
                    <SelectItem value="Chhattisgarh">Chhattisgarh</SelectItem>
                    <SelectItem value="Goa">Goa</SelectItem>
                    <SelectItem value="Gujarat">Gujarat</SelectItem>
                    <SelectItem value="Haryana">Haryana</SelectItem>
                    <SelectItem value="Himachal Pradesh">Himachal Pradesh</SelectItem>
                    <SelectItem value="Jharkhand">Jharkhand</SelectItem>
                    <SelectItem value="Karnataka">Karnataka</SelectItem>
                    <SelectItem value="Kerala">Kerala</SelectItem>
                    <SelectItem value="Madhya Pradesh">Madhya Pradesh</SelectItem>
                    <SelectItem value="Maharashtra">Maharashtra</SelectItem>
                    <SelectItem value="Manipur">Manipur</SelectItem>
                    <SelectItem value="Meghalaya">Meghalaya</SelectItem>
                    <SelectItem value="Mizoram">Mizoram</SelectItem>
                    <SelectItem value="Nagaland">Nagaland</SelectItem>
                    <SelectItem value="Odisha">Odisha</SelectItem>
                    <SelectItem value="Punjab">Punjab</SelectItem>
                    <SelectItem value="Rajasthan">Rajasthan</SelectItem>
                    <SelectItem value="Sikkim">Sikkim</SelectItem>
                    <SelectItem value="Tamil Nadu">Tamil Nadu</SelectItem>
                    <SelectItem value="Telangana">Telangana</SelectItem>
                    <SelectItem value="Tripura">Tripura</SelectItem>
                    <SelectItem value="Uttar Pradesh">Uttar Pradesh</SelectItem>
                    <SelectItem value="Uttarakhand">Uttarakhand</SelectItem>
                    <SelectItem value="West Bengal">West Bengal</SelectItem>
                    <SelectItem value="Delhi">Delhi</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>


        {/* Fare Calculation */}
        <div className="p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg space-y-3 transition-colors duration-300">
          {isMultiScreen && screensData.length > 1 ? (
            <>
              {/* Multi-Screen Breakdown */}
              <div className="space-y-2 mb-3 pb-3 transition-colors duration-300" style={{ borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: 'var(--border-primary)' }}>
                <p className="text-xs font-semibold text-purple-300 uppercase tracking-wide mb-2">
                  {screensData.length} Screens Selected
                </p>
                {screensData.map((screen) => (
                  <div key={screen.screenId} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="truncate max-w-[180px] transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                        {screen.screenName}
                      </span>
                      <span className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                        {screen.pricing.slotsCount} slot{screen.pricing.slotsCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                        ₹{screen.pricing.baseHourlyRate.toLocaleString()} × {screen.pricing.slotsCount}
                      </span>
                      <span className="font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                        ₹{screen.pricing.subtotal.toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Total Summary */}
              <div className="flex justify-between text-sm">
                <span className="transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>Total Slots</span>
                <span className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>{finalSlotsCount}</span>
              </div>
              <div className="pt-3 mt-2 space-y-2 transition-colors duration-300" style={{ borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'var(--border-primary)' }}>
                <div className="flex justify-between text-sm">
                  <span className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Subtotal (Base)</span>
                  <span className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>₹{(baseAmount + discountAmount).toLocaleString()}</span>
                </div>
                {/* Tiered Pricing Breakdown */}
                {isTieredPricing && tierBreakdown.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-blue-300 uppercase tracking-wide">
                      Tiered Discount Breakdown
                    </p>
                    {tierBreakdown.map((tier, index) => (
                      <div key={index} className="flex justify-between text-sm">
                        <span className="text-green-400 flex items-center gap-1">
                          {tier.units} {tier.label}{tier.units > 1 ? 's' : ''} ({tier.discountPercent}% off)
                        </span>
                        <span className="text-green-400">-₹{tier.discountAmount.toLocaleString()}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-sm pt-1" style={{ borderTopWidth: '1px', borderTopStyle: 'dashed', borderTopColor: 'var(--border-primary)' }}>
                      <span className="text-green-400 font-semibold">Total Savings (~{discountPercent}%)</span>
                      <span className="text-green-400 font-semibold">-₹{discountAmount.toLocaleString()}</span>
                    </div>
                  </div>
                ) : discountAmount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-green-400 flex items-center gap-1">
                      {appliedOfferLabel} ({discountPercent}% OFF)
                    </span>
                    <span className="text-green-400">-₹{discountAmount.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-orange-400">GST (18%)</span>
                  <span className="text-orange-400">₹{gstAmount.toLocaleString()}</span>
                </div>
                <div className="pt-2 transition-colors duration-300" style={{ borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'var(--border-primary)' }}>
                  <div className="flex justify-between items-center">
                    <span className="font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Total Amount</span>
                    <span className="text-2xl font-bold text-purple-400">
                      ₹{totalFare.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Single Screen Display */}
              <div className="flex justify-between text-sm">
                <span className="transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>Base Price per Slot</span>
                <span className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>₹{basePrice.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>Selected Slots</span>
                <span className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>{finalSlotsCount}</span>
              </div>
              <div className="pt-2 mt-2 space-y-2 transition-colors duration-300" style={{ borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'var(--border-primary)' }}>
                <div className="flex justify-between text-sm">
                  <span className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Subtotal (Base)</span>
                  <span className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>₹{(baseAmount + discountAmount).toLocaleString()}</span>
                </div>
                {/* Tiered Pricing Breakdown for Single Screen */}
                {isTieredPricing && tierBreakdown.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-blue-300 uppercase tracking-wide">
                      Tiered Discount Breakdown
                    </p>
                    {tierBreakdown.map((tier, index) => (
                      <div key={index} className="flex justify-between text-sm">
                        <span className="text-green-400 flex items-center gap-1">
                          {tier.units} {tier.label}{tier.units > 1 ? 's' : ''} ({tier.discountPercent}% off)
                        </span>
                        <span className="text-green-400">-₹{tier.discountAmount.toLocaleString()}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-sm pt-1" style={{ borderTopWidth: '1px', borderTopStyle: 'dashed', borderTopColor: 'var(--border-primary)' }}>
                      <span className="text-green-400 font-semibold">Total Savings (~{discountPercent}%)</span>
                      <span className="text-green-400 font-semibold">-₹{discountAmount.toLocaleString()}</span>
                    </div>
                  </div>
                ) : discountAmount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-green-400 flex items-center gap-1">
                      {appliedOfferLabel} ({discountPercent}% OFF)
                    </span>
                    <span className="text-green-400">-₹{discountAmount.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-orange-400">GST (18%)</span>
                  <span className="text-orange-400">₹{gstAmount.toLocaleString()}</span>
                </div>
                <div className="pt-2 transition-colors duration-300" style={{ borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'var(--border-primary)' }}>
                  <div className="flex justify-between items-center">
                    <span className="font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Total Amount</span>
                    <span className="text-2xl font-bold text-purple-400">
                      ₹{totalFare.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Validation message */}
        {!uploadedMedia && finalSlotsCount > 0 && (
          <p className="text-sm text-yellow-400">
            Please upload your ad creative before proceeding to payment.
          </p>
        )}

        <RazorpayPaymentButton
          amount={totalFare}
          currency="INR"
          screenId={screenIdParam}
          campaignData={getCampaignData()}
          disabled={isSubmitting || !isFormValid || isUploading}
          className="w-full font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-300"
          style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)' }}
        />
      </form>
    </div>
  );
};
