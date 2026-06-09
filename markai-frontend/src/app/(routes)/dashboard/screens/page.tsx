"use client";
import React, { useState, useEffect } from "react";
import { ScreenSearchBar } from "@/components/common/ScreenSearchBar";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Monitor, MapPin, Eye, Edit, Trash2, Plus, Loader2, UserPlus, Sparkles, User } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import toast from "react-hot-toast";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { cn } from "@/lib/utils";
import {
  getAllScreens,
  getScreensByOwnerId,
  createScreen,
  updateScreen,
  deleteScreen,
  getScreenById,
  getAllScreenOwners,
  uploadScreenImage,
  assignScreenOwner,
  type Screen,
  type ScreenOwner,
  type FrequencyDiscount,
} from "@/services/screenService";
import FrequencyDiscountEditor from "@/components/dashboard/FrequencyDiscountEditor";
import Image from "next/image";
import { Upload, X as XIcon } from "lucide-react";

const screenSchema = z.object({
  screen_name: z.string().min(2, "Screen name is required"),
  description: z.string().min(10, "Description must be at least 10 characters"),
  screen_owner_id: z.string().min(1, "Screen owner is required"),
  // Location
  street: z.string().min(1, "Street address is required"),
  city: z.string().min(1, "City is required"),
  country: z.string().min(1, "Country is required"),
  latitude: z.coerce.number().min(-90).max(90, "Invalid latitude"),
  longitude: z.coerce.number().min(-180).max(180, "Invalid longitude"),
  // Technical details
  width: z.coerce.number().min(1, "Width is required"),
  height: z.coerce.number().min(1, "Height is required"),
  size: z.string().min(1, "Size is required"),
  orientation: z.enum(["landscape", "portrait"] as const),
  // Pricing
  price: z.coerce.number().min(0, "Price must be positive"),
  base_hourly_rate: z.coerce.number().min(0, "Base hourly rate must be positive").optional(),
  currency: z.string().min(1, "Currency is required"),
  unit: z.string().min(1, "Unit is required"),
  // Campaign Insights
  weekly_footfall: z.coerce.number().min(0, "Footfall must be positive").optional(),
  campaign_benefits: z.string().optional(),
});

type ScreenFormData = z.infer<typeof screenSchema>;

const SCREENS_PER_PAGE = 9;

const ScreensPage = () => {
  const { user, fullUserData } = useAuth();
  const [screens, setScreens] = useState<Screen[]>([]);
  const [screenOwners, setScreenOwners] = useState<ScreenOwner[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOwners, setLoadingOwners] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [uploadingImages, setUploadingImages] = useState<boolean[]>([]);
  const [editingScreenId, setEditingScreenId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  // Assign owner dialog state
  const [isAssignOwnerOpen, setIsAssignOwnerOpen] = useState(false);
  const [selectedScreenForAssign, setSelectedScreenForAssign] = useState<Screen | null>(null);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>("");
  const [isAssigning, setIsAssigning] = useState(false);
  // Frequency discounts state
  const [frequencyDiscounts, setFrequencyDiscounts] = useState<FrequencyDiscount>({
    hourly: 0,
    daily: 0,
    weekly: 0,
    fortnightly: 0,
    monthly: 0,
  });

  const isAdmin = fullUserData?.is_admin === true;
  const isScreenOwner = fullUserData?.is_screen_owner === true;

  const form = useForm<ScreenFormData>({
    resolver: zodResolver(screenSchema) as any,
    defaultValues: {
      screen_name: "",
      description: "",
      screen_owner_id: user?._id || "",
      street: "",
      city: "",
      country: "India",
      latitude: 0,
      longitude: 0,
      width: 1920,
      height: 1080,
      size: "",
      orientation: "landscape",
      price: 0,
      base_hourly_rate: 30,
      currency: "INR",
      unit: "per week",
      weekly_footfall: 15000,
      campaign_benefits: "",
    },
  });

  const fetchScreenOwners = async () => {
    try {
      setLoadingOwners(true);
      const response = await getAllScreenOwners(100, 0);
      setScreenOwners(response.users || []);
    } catch (error) {
      console.error("Error fetching screen owners:", error);
      toast.error(error instanceof Error ? error.message : "Failed to fetch screen owners");
    } finally {
      setLoadingOwners(false);
    }
  };

  const fetchScreens = async () => {
    try {
      setLoading(true);
      const skip = (currentPage - 1) * SCREENS_PER_PAGE;

      if (isAdmin) {
        const response = await getAllScreens(SCREENS_PER_PAGE, skip, undefined, undefined, searchTerm);
        setScreens(response.screens || []);

        // Use pagination object if available, otherwise fallback to count
        if (response.pagination) {
          const total = response.pagination.total || 0;
          const pages = response.pagination.pages || Math.ceil(total / SCREENS_PER_PAGE);
          setTotalCount(total);
          setTotalPages(pages);
        } else {
          const count = response.count || 0;
          setTotalCount(count);
          setTotalPages(Math.ceil(count / SCREENS_PER_PAGE));
        }
      } else if (isScreenOwner && user?._id) {
        const response = await getScreensByOwnerId(user._id, SCREENS_PER_PAGE, skip, searchTerm);
        setScreens(response.screens || []);

        // Use pagination object if available, otherwise fallback to count
        if (response.pagination) {
          const total = response.pagination.total || 0;
          const pages = response.pagination.pages || Math.ceil(total / SCREENS_PER_PAGE);
          setTotalCount(total);
          setTotalPages(pages);
        } else {
          const count = response.count || 0;
          setTotalCount(count);
          setTotalPages(Math.ceil(count / SCREENS_PER_PAGE));
        }
      }
    } catch (error) {
      console.error("Error fetching screens:", error);
      toast.error(error instanceof Error ? error.message : "Failed to fetch screens");
    } finally {
      setLoading(false);
    }
  };

  // Fetch screens when page or search changes
  useEffect(() => {
    if (isAdmin || (isScreenOwner && user?._id)) {
      fetchScreens();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, isScreenOwner, user?._id, currentPage, searchTerm]);

  // Reset to page 1 when search term changes
  useEffect(() => {
    if (searchTerm !== "") {
      setCurrentPage(1);
    }
  }, [searchTerm]);


  useEffect(() => {
    // Only admins need to fetch screen owners list (for assigning screens)
    if (isAdmin) {
      fetchScreenOwners();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  useEffect(() => {
    if (user?._id && !isAdmin) {
      form.setValue("screen_owner_id", user._id);
    }
  }, [user?._id, isAdmin, form]);

  const handleImageUpload = async (file: File, index: number) => {
    try {
      setUploadingImages((prev) => {
        const newState = [...prev];
        newState[index] = true;
        return newState;
      });

      const response = await uploadScreenImage(file, "screens");
      setUploadedImages((prev) => {
        const newState = [...prev];
        newState[index] = response.url;
        return newState;
      });
      toast.success(`Image ${index + 1} uploaded successfully`);
    } catch (error) {
      console.error("Error uploading image:", error);
      toast.error(error instanceof Error ? error.message : "Failed to upload image");
    } finally {
      setUploadingImages((prev) => {
        const newState = [...prev];
        newState[index] = false;
        return newState;
      });
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const file = e.target.files?.[0];
    if (file) {
      await handleImageUpload(file, index);
    }
  };

  const addImageSlot = () => {
    setUploadedImages((prev) => [...prev, ""]);
    setUploadingImages((prev) => [...prev, false]);
  };

  const removeImage = (index: number) => {
    const imageToRemove = uploadedImages[index];
    if (imageToRemove && imageToRemove.trim() !== "") {
      // Show confirmation for removing existing uploaded images
      if (confirm("Are you sure you want to remove this image?")) {
        setUploadedImages((prev) => prev.filter((_, i) => i !== index));
        setUploadingImages((prev) => prev.filter((_, i) => i !== index));
        toast.success("Image removed");
      }
    } else {
      // Just remove empty slot
      setUploadedImages((prev) => prev.filter((_, i) => i !== index));
      setUploadingImages((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const handleOpenModal = () => {
    if (isAdmin && screenOwners.length === 0) {
      fetchScreenOwners();
    }
    setEditingScreenId(null);
    setIsModalOpen(true);
    setUploadedImages([""]); // Start with one image slot
    setUploadingImages([false]);
    setFrequencyDiscounts({
      hourly: 0,
      daily: 0,
      weekly: 0,
      fortnightly: 0,
      monthly: 0,
    });
    form.reset({
      screen_name: "",
      description: "",
      screen_owner_id: user?._id || "",
      street: "",
      city: "",
      country: "India",
      latitude: 0,
      longitude: 0,
      width: 1920,
      height: 1080,
      size: "",
      orientation: "landscape",
      price: 0,
      base_hourly_rate: 30,
      currency: "INR",
      unit: "per week",
      weekly_footfall: 15000,
      campaign_benefits: "",
    });
  };

  const handleEdit = async (screenId: string) => {
    try {
      setIsSubmitting(true);
      // Call GET /api/screens/:id to fetch screen details
      const response = await getScreenById(screenId);
      
      // Extract screen object from response (response.screen or direct response)
      const screen = (response as any).screen || response;
      
      console.log("Screen data loaded:", screen); // Debug log
      
      // Map the API response structure to form fields
      const screenName = screen.screen_name || screen.venue_name || "";
      const description = screen.description || "";
      
      // Location mapping
      const location = screen.location || {};
      const street = location.street || location.address?.full_address || "";
      const city = location.city || "";
      const country = location.country || "India";
      const latitude = location.latitude ?? location.geolocation?.latitude ?? 0;
      const longitude = location.longitude ?? location.geolocation?.longitude ?? 0;
      
      // Technical details mapping
      const technicalDetails = screen.technical_details || {};
      const width = technicalDetails.width ? Number(technicalDetails.width) : 1920;
      const height = technicalDetails.height ? Number(technicalDetails.height) : 1080;
      const size = technicalDetails.size || "";
      const orientation = (technicalDetails.orientation || "landscape") as "landscape" | "portrait";
      
      // Pricing mapping
      const pricing = screen.pricing || {};
      const price = pricing.price ? Number(pricing.price) : (screen.frequency_pricing?.[0]?.price ? Number(screen.frequency_pricing[0].price) : 0);
      const baseHourlyRate = pricing.base_hourly_rate ? Number(pricing.base_hourly_rate) : 30;
      const currency = pricing.currency || "INR";
      const unit = pricing.unit || "per week";

      // Frequency discounts mapping
      const existingDiscounts = pricing.frequency_discounts || {
        hourly: 0,
        daily: 0,
        weekly: 0,
        fortnightly: 0,
        monthly: 0,
      };
      setFrequencyDiscounts(existingDiscounts);

      // Campaign Insights mapping
      const campaignInsights = screen.campaign_insights || {};
      const weeklyFootfall = campaignInsights.weekly_footfall ? Number(campaignInsights.weekly_footfall) : 15000;
      const benefits = campaignInsights.benefits || [];
      const campaignBenefits = Array.isArray(benefits) ? benefits.join("\n") : "";

      // Get images from screen_images array (new API) or media_gallery (old API)
      const screenImages = screen.screen_images || [];
      const mediaGalleryImages = screen.media_gallery?.filter((media: any) => media.type === "image").map((media: any) => media.url) || [];
      const allImages = screenImages.length > 0 ? screenImages : mediaGalleryImages;

      // Reset form with all pre-filled values
      form.reset({
        screen_name: screenName,
        description: description,
        screen_owner_id: screen.screen_owner_id || user?._id || "",
        street: street,
        city: city,
        country: country,
        latitude: Number(latitude) || 0,
        longitude: Number(longitude) || 0,
        width: width,
        height: height,
        size: size,
        orientation: orientation,
        price: price,
        base_hourly_rate: baseHourlyRate,
        currency: currency,
        unit: unit,
        weekly_footfall: weeklyFootfall,
        campaign_benefits: campaignBenefits,
      });

      // Load existing images - always show them, even if empty array
      if (allImages.length > 0) {
        setUploadedImages([...allImages]);
        setUploadingImages(new Array(allImages.length).fill(false));
      } else {
        // If no images, start with one empty slot for adding new images
        setUploadedImages([""]);
        setUploadingImages([false]);
      }

      setEditingScreenId(screenId);
      setIsModalOpen(true);
      toast.success("Screen data loaded successfully");
    } catch (error) {
      console.error("Error loading screen:", error);
      toast.error(error instanceof Error ? error.message : "Failed to load screen");
    } finally {
      setIsSubmitting(false);
    }
  };

  const onSubmit = async (data: ScreenFormData) => {
    try {
      setIsSubmitting(true);

      // Filter out empty image URLs
      const validImages = uploadedImages.filter((url) => url.trim() !== "");

      if (validImages.length === 0) {
        toast.error("Please upload at least one screen image");
        setIsSubmitting(false);
        return;
      }

      // Parse campaign benefits from text (newline separated) to array
      const benefitsArray = data.campaign_benefits
        ? data.campaign_benefits.split("\n").filter((b: string) => b.trim() !== "")
        : [];

      const screenData: any = {
        screen_name: data.screen_name,
        description: data.description,
        screen_images: validImages,
        location: {
          street: data.street,
          city: data.city,
          country: data.country,
          latitude: data.latitude,
          longitude: data.longitude,
        },
        technical_details: {
          width: data.width,
          height: data.height,
          size: data.size,
          orientation: data.orientation,
        },
        pricing: {
          price: data.price,
          base_hourly_rate: data.base_hourly_rate || 30,
          frequency_discounts: frequencyDiscounts,
          currency: data.currency,
          unit: data.unit,
        },
        campaign_insights: {
          weekly_footfall: data.weekly_footfall || 15000,
          benefits: benefitsArray,
        },
        status: "active",
      };

      // Add screen_owner_id only for create, not for update
      if (!editingScreenId) {
        screenData.screen_owner_id = data.screen_owner_id;
      }

      if (editingScreenId) {
        await updateScreen(editingScreenId, screenData);
        toast.success("Screen updated successfully");
      } else {
        await createScreen(screenData);
        toast.success("Screen created successfully");
      }

      setIsModalOpen(false);
      setEditingScreenId(null);
      setUploadedImages([]);
      setUploadingImages([]);
      setFrequencyDiscounts({
        hourly: 0,
        daily: 0,
        weekly: 0,
        fortnightly: 0,
        monthly: 0,
      });
      form.reset({
        screen_name: "",
        description: "",
        screen_owner_id: user?._id || "",
        street: "",
        city: "",
        country: "India",
        latitude: 0,
        longitude: 0,
        width: 1920,
        height: 1080,
        size: "",
        orientation: "landscape",
        price: 0,
        base_hourly_rate: 30,
        currency: "INR",
        unit: "per week",
        weekly_footfall: 15000,
        campaign_benefits: "",
      });
      fetchScreens();
    } catch (error) {
      console.error(`Error ${editingScreenId ? "updating" : "creating"} screen:`, error);
      toast.error(error instanceof Error ? error.message : `Failed to ${editingScreenId ? "update" : "create"} screen`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (screenId: string) => {
    if (!confirm("Are you sure you want to delete this screen? This action cannot be undone.")) {
      return;
    }

    try {
      await deleteScreen(screenId);
      toast.success("Screen deleted successfully");
      fetchScreens();
    } catch (error) {
      console.error("Error deleting screen:", error);
      toast.error(error instanceof Error ? error.message : "Failed to delete screen");
    }
  };

  const handleOpenAssignOwner = (screen: Screen) => {
    if (screenOwners.length === 0) {
      fetchScreenOwners();
    }
    setSelectedScreenForAssign(screen);
    setSelectedOwnerId(screen.screen_owner_id || "");
    setIsAssignOwnerOpen(true);
  };

  const handleAssignOwner = async () => {
    if (!selectedScreenForAssign || !selectedOwnerId) {
      toast.error("Please select a screen owner");
      return;
    }

    try {
      setIsAssigning(true);
      await assignScreenOwner(selectedScreenForAssign._id, selectedOwnerId);
      toast.success("Screen owner assigned successfully");
      setIsAssignOwnerOpen(false);
      setSelectedScreenForAssign(null);
      setSelectedOwnerId("");
      fetchScreens();
    } catch (error) {
      console.error("Error assigning screen owner:", error);
      toast.error(error instanceof Error ? error.message : "Failed to assign screen owner");
    } finally {
      setIsAssigning(false);
    }
  };

  const getStatusColor = (status?: string) => {
    return status === "active" || !status
      ? "bg-green-500/20 text-green-400 border-green-500/30"
      : "bg-gray-500/20 text-gray-400 border-gray-500/30";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
            {isAdmin ? "Manage Screens" : "Screen Management"}
          </h1>
          <p className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
            {isAdmin
              ? "View and manage all screens in the platform"
              : "Manage your registered screens"}
          </p>
        </div>
        <Button
          onClick={handleOpenModal}
          className="bg-white text-black"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add New Screen
        </Button>
      </div>

      {/* Server-side Search with ScreenSearchBar */}
      <div className="max-w-md">
        <ScreenSearchBar
          onSearch={setSearchTerm}
          placeholder="Search screens by name, location, or city..."
          className="w-full"
          debounceMs={500}
        />
      </div>

      {loading ? (
        <Card className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
          <CardContent className="p-6">
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : screens.length === 0 ? (
        <Card className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
          <CardContent className="py-12 text-center">
            <Monitor className="w-12 h-12 mx-auto mb-4 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
            <p className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
              {searchTerm ? "No screens found matching your search" : "No screens found"}
            </p>
            {searchTerm && (
              <p className="text-sm mt-2 transition-colors duration-300" style={{ color: 'var(--text-muted)' }}>
                Try a different search term
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent transition-colors duration-300" style={{ borderColor: 'var(--border-primary)' }}>
                  <TableHead className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Screen Name</TableHead>
                  <TableHead className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Location</TableHead>
                  <TableHead className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Status</TableHead>
                  <TableHead className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Screen Owner</TableHead>
                  <TableHead className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Price</TableHead>
                  <TableHead className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Created</TableHead>
                  <TableHead className="text-right transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {screens.map((screen) => {
                  const screenName = (screen as any).screen_name || screen.venue_name || "N/A";
                  const location = screen.location;
                  const locationText = location
                    ? [location.city, location.state, (location as any).country]
                        .filter(Boolean)
                        .join(", ") || "N/A"
                    : "N/A";

                  // Calculate dynamic per-hour price
                  const pricing = (screen as any).pricing || {};
                  let baseHourlyRate = pricing.base_hourly_rate;

                  // Backward compatibility: Calculate from legacy weekly price
                  if (!baseHourlyRate && pricing.price) {
                    const unit = pricing.unit || "per week";
                    if (unit.includes("week")) {
                      baseHourlyRate = Math.round(pricing.price / 168);
                    } else if (unit.includes("day")) {
                      baseHourlyRate = Math.round(pricing.price / 24);
                    } else if (unit.includes("month")) {
                      baseHourlyRate = Math.round(pricing.price / 720);
                    } else {
                      baseHourlyRate = pricing.price;
                    }
                  }

                  const currency = pricing.currency || "INR";
                  const currencySymbol = currency === "INR" ? "₹" : "$";
                  const price = baseHourlyRate
                    ? `${currencySymbol}${baseHourlyRate.toLocaleString()}/hour`
                    : "N/A";

                  const createdAt = screen.createdAt
                    ? new Date(screen.createdAt).toLocaleDateString()
                    : "N/A";

                  // Find the assigned screen owner
                  const assignedOwner = screen.screen_owner_id
                    ? screenOwners.find(owner => owner._id === screen.screen_owner_id)
                    : null;
                  const ownerEmail = assignedOwner?.email || "Unassigned";
                  const ownerName = assignedOwner?.full_name || "";

                  return (
                    <TableRow key={screen._id} className="transition-colors duration-300" style={{ borderColor: 'var(--border-primary)' }}>
                      <TableCell className="font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center shrink-0">
                            <Monitor className="w-5 h-5 text-purple-400" />
                          </div>
                          <div>
                            <div className="font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>{screenName}</div>
                            <div className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>ID: {screen._id.slice(-8)}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4 shrink-0 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
                          <span className="text-sm">{locationText}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(screen.status)}>
                          {screen.status || "active"}
                        </Badge>
                      </TableCell>
                      <TableCell className="transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                        {assignedOwner ? (
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                              <User className="w-3 h-3 text-blue-400" />
                            </div>
                            <div>
                              <div className="text-sm transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>{ownerEmail}</div>
                              {ownerName && (
                                <div className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>{ownerName}</div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm italic transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell className="transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>{price}</TableCell>
                      <TableCell className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>{createdAt}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => window.open(`/screens/${screen._id}`, "_blank")}
                            className="transition-colors duration-300"
                            style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                            title="View screen"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEdit(screen._id)}
                            className="transition-colors duration-300"
                            style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                            title="Edit screen"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          {isAdmin && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleOpenAssignOwner(screen)}
                                className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                                title="Assign screen owner"
                              >
                                <UserPlus className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDelete(screen._id)}
                                className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                                title="Delete screen"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>

          {/* Pagination */}
          {!loading && totalPages > 1 && (
            <div className="p-6 border-t transition-colors duration-300" style={{ borderColor: 'var(--border-primary)' }}>
              <div className="flex justify-center">
                <Pagination>
                  <PaginationContent className="gap-1">
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          if (currentPage > 1) {
                            setCurrentPage(currentPage - 1);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }
                        }}
                        className={cn(
                          "transition-colors duration-300",
                          currentPage === 1 && "pointer-events-none opacity-50"
                        )}
                        style={{ color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
                      />
                    </PaginationItem>

                    {/* Page Numbers */}
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => {
                      const showPage =
                        pageNum === 1 ||
                        pageNum === totalPages ||
                        (pageNum >= currentPage - 1 && pageNum <= currentPage + 1);

                      if (!showPage) {
                        if (
                          (pageNum === currentPage - 2 && currentPage > 3) ||
                          (pageNum === currentPage + 2 && currentPage < totalPages - 2)
                        ) {
                          return (
                            <PaginationItem key={`ellipsis-${pageNum}`}>
                              <PaginationEllipsis className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
                            </PaginationItem>
                          );
                        }
                        return null;
                      }

                      return (
                        <PaginationItem key={pageNum}>
                          <PaginationLink
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              setCurrentPage(pageNum);
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            isActive={currentPage === pageNum}
                            className={cn(
                              "min-w-10 transition-colors duration-300",
                              currentPage === pageNum
                                ? "bg-white text-black hover:bg-white/90 border-white"
                                : ""
                            )}
                            style={currentPage !== pageNum ? { color: 'var(--text-primary)', borderColor: 'var(--border-primary)' } : {}}
                          >
                            {pageNum}
                          </PaginationLink>
                        </PaginationItem>
                      );
                    })}

                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          if (currentPage < totalPages) {
                            setCurrentPage(currentPage + 1);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }
                        }}
                        className={cn(
                          "transition-colors duration-300",
                          currentPage === totalPages && "pointer-events-none opacity-50"
                        )}
                        style={{ color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
              <div className="mt-4 text-center text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                Showing page {currentPage} of {totalPages} ({totalCount} total screens)
              </div>
            </div>
          )}
        </Card>
      )}

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>
          <DialogHeader>
            <DialogTitle className="text-2xl transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
              {editingScreenId ? "Edit Screen" : "Add New Screen"}
            </DialogTitle>
            <DialogDescription className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
              {editingScreenId
                ? "Update screen information"
                : "Create a new screen for advertising"}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* Screen Owner Field - Only show on create, not on edit */}
              {!editingScreenId && (
                <>
                  {isAdmin && (
                    <FormField
                      control={form.control}
                      name="screen_owner_id"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Screen Owner *</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                            disabled={loadingOwners}
                          >
                            <FormControl>
                              <SelectTrigger className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>
                                <SelectValue placeholder="Select screen owner" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
                              {loadingOwners ? (
                                <div className="p-2 text-center transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Loading owners...</div>
                              ) : screenOwners.length === 0 ? (
                                <div className="p-2 text-center transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>No screen owners found</div>
                              ) : (
                                screenOwners.map((owner) => (
                                  <SelectItem
                                    key={owner._id}
                                    value={owner._id}
                                    className="transition-colors duration-300"
                                    style={{ color: 'var(--text-primary)' }}
                                  >
                                    {owner.business_name || owner.full_name} ({owner.email})
                                  </SelectItem>
                                ))
                              )}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                  {!isAdmin && isScreenOwner && (
                    <FormField
                      control={form.control}
                      name="screen_owner_id"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Screen Owner</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="text"
                              disabled
                              value={fullUserData?.full_name || fullUserData?.business_name || ""}
                              className="opacity-70 transition-colors duration-300"
                              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                            />
                          </FormControl>
                          <Input {...field} type="hidden" value={user?._id || ""} />
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </>
              )}

              {/* Basic Information */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <Monitor className="w-5 h-5 transition-colors duration-300" style={{ color: 'var(--text-primary)' }} />
                  <h3 className="text-lg font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Basic Information</h3>
                </div>
                <FormField
                  control={form.control}
                  name="screen_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Screen Name *</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          className="transition-colors duration-300"
                          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                          placeholder="e.g., Times Square Billboard #1"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Description *</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          className="resize-none transition-colors duration-300"
                          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                          placeholder="Describe your screen location and visibility."
                          rows={4}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Location */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <MapPin className="w-5 h-5 transition-colors duration-300" style={{ color: 'var(--text-primary)' }} />
                  <h3 className="text-lg font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Location</h3>
                </div>
                <FormField
                  control={form.control}
                  name="street"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Street Address *</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          className="transition-colors duration-300"
                          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                          placeholder="123 Main St"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>City *</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            className="transition-colors duration-300"
                            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                            placeholder="New York"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="country"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Country *</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            className="transition-colors duration-300"
                            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                            placeholder="USA"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="latitude"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Latitude *</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            step="any"
                            className="transition-colors duration-300"
                            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                            placeholder="40.7580"
                            value={field.value || ""}
                            onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : 0)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="longitude"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Longitude *</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            step="any"
                            className="transition-colors duration-300"
                            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                            placeholder="-73.9855"
                            value={field.value || ""}
                            onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : 0)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Technical Specifications */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Technical Specifications</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="width"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Width (pixels) *</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            className="transition-colors duration-300"
                            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                            placeholder="1920"
                            value={field.value || ""}
                            onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : 0)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="height"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Height (pixels) *</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            className="transition-colors duration-300"
                            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                            placeholder="1080"
                            value={field.value || ""}
                            onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : 0)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="size"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Size (inches) *</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            className="transition-colors duration-300"
                            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                            placeholder="55"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="orientation"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Orientation *</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>
                              <SelectValue placeholder="Select orientation" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
                            <SelectItem value="landscape" className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                              Landscape
                            </SelectItem>
                            <SelectItem value="portrait" className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                              Portrait
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Pricing */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Pricing</h3>
                <FormField
                  control={form.control}
                  name="base_hourly_rate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Base Hourly Rate *</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                            {form.watch("currency") === "INR" ? "₹" : "$"}
                          </span>
                          <Input
                            {...field}
                            type="number"
                            step="0.01"
                            className="pl-8 transition-colors duration-300"
                            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                            placeholder="30.00"
                            value={field.value || ""}
                            onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : 0)}
                          />
                        </div>
                      </FormControl>
                      <p className="text-xs mt-1 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                        Set your base hourly rate. Discounts will be applied to longer durations automatically.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="currency"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Currency *</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            className="transition-colors duration-300"
                            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                            placeholder="INR"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="unit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Unit *</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            className="transition-colors duration-300"
                            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                            placeholder="per week"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Frequency Discounts */}
                <div className="space-y-3 border-t pt-4 mt-4 transition-colors duration-300" style={{ borderColor: 'var(--border-primary)' }}>
                  <h4 className="text-md font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Duration-Based Discounts</h4>
                  <FrequencyDiscountEditor
                    baseHourlyRate={form.watch("base_hourly_rate") || 30}
                    currency={form.watch("currency") || "INR"}
                    discounts={frequencyDiscounts}
                    onDiscountsChange={setFrequencyDiscounts}
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              {/* Campaign Insights - Only for Admin */}
              {isAdmin && (
                <div className="space-y-4 border-t pt-4 transition-colors duration-300" style={{ borderColor: 'var(--border-primary)' }}>
                  <div className="flex items-center gap-2 mb-4">
                    <Sparkles className="w-5 h-5 transition-colors duration-300" style={{ color: 'var(--text-primary)' }} />
                    <h3 className="text-lg font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Campaign Insights</h3>
                  </div>
                  <FormField
                    control={form.control}
                    name="weekly_footfall"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Weekly Footfall</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            className="transition-colors duration-300"
                            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                            placeholder="15000"
                            value={field.value || ""}
                            onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : 0)}
                          />
                        </FormControl>
                        <p className="text-xs mt-1 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                          Number of people who see this screen weekly
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="campaign_benefits"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Campaign Benefits</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            className="resize-none transition-colors duration-300"
                            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                            placeholder="Enter campaign benefits (one per line)&#10;e.g., High visibility digital display&#10;Real-time content updates&#10;Premium audience reach"
                            rows={6}
                          />
                        </FormControl>
                        <p className="text-xs mt-1 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                          Enter each benefit on a new line
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {/* Image Upload */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Screen Images</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addImageSlot}
                    className="transition-colors duration-300"
                    style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Add Image
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {uploadedImages.map((imageUrl, index) => (
                    <div key={index} className="space-y-2">
                      {imageUrl && imageUrl.trim() !== "" ? (
                        <div className="relative group">
                          <div className="relative w-full h-48 rounded-lg overflow-hidden border transition-colors duration-300" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-card)' }}>
                            <Image
                              src={imageUrl}
                              alt={`Screen image ${index + 1}`}
                              fill
                              className="object-cover"
                              unoptimized
                              onError={(e) => {
                                console.error("Image load error:", imageUrl);
                                (e.target as HTMLImageElement).style.display = "none";
                              }}
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeImage(index)}
                            className="absolute top-2 right-2 bg-red-500/90 hover:bg-red-600 text-white shadow-lg z-10"
                            title="Remove image"
                          >
                            <XIcon className="w-4 h-4" />
                          </Button>
                          <div className="absolute bottom-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
                            Image {index + 1}
                          </div>
                        </div>
                      ) : (
                        <div className="relative">
                          <label
                            htmlFor={`image-upload-${index}`}
                            className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-lg cursor-pointer transition-colors duration-300"
                            style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-card)' }}
                          >
                            {uploadingImages[index] ? (
                              <div className="flex flex-col items-center gap-2">
                                <Loader2 className="w-8 h-8 animate-spin transition-colors duration-300" style={{ color: 'var(--text-primary)' }} />
                                <span className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Uploading...</span>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center gap-2">
                                <Upload className="w-8 h-8 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
                                <span className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Click to upload</span>
                              </div>
                            )}
                            <input
                              id={`image-upload-${index}`}
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => handleFileChange(e, index)}
                              disabled={uploadingImages[index]}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <DialogFooter className="mt-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsModalOpen(false);
                    setEditingScreenId(null);
                    setUploadedImages([]);
                    setUploadingImages([]);
                    form.reset({
                      screen_name: "",
                      description: "",
                      screen_owner_id: user?._id || "",
                      street: "",
                      city: "",
                      country: "India",
                      latitude: 0,
                      longitude: 0,
                      width: 1920,
                      height: 1080,
                      size: "",
                      orientation: "landscape",
                      price: 0,
                      currency: "INR",
                      unit: "per week",
                      weekly_footfall: 15000,
                      campaign_benefits: "",
                    });
                  }}
                  className="transition-colors duration-300"
                  style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting || (isAdmin && loadingOwners)}
                  className="bg-white text-black hover:bg-gray-100"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {editingScreenId ? "Updating..." : "Creating..."}
                    </>
                  ) : editingScreenId ? (
                    "Update Screen"
                  ) : (
                    "Create Screen"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Assign Owner Dialog */}
      <Dialog open={isAssignOwnerOpen} onOpenChange={setIsAssignOwnerOpen}>
        <DialogContent className="max-w-md transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>
          <DialogHeader>
            <DialogTitle className="text-xl transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Assign Screen Owner</DialogTitle>
            <DialogDescription className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
              Assign a screen owner to manage this screen
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {selectedScreenForAssign && (
              <div className="p-3 rounded-lg border transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
                <p className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Screen</p>
                <p className="font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                  {(selectedScreenForAssign as any).screen_name || selectedScreenForAssign.venue_name || "Unnamed Screen"}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Select Screen Owner</label>
              <Select
                value={selectedOwnerId}
                onValueChange={setSelectedOwnerId}
                disabled={loadingOwners}
              >
                <SelectTrigger className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>
                  <SelectValue placeholder="Select a screen owner" />
                </SelectTrigger>
                <SelectContent className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
                  {loadingOwners ? (
                    <div className="p-2 text-center transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Loading owners...</div>
                  ) : screenOwners.length === 0 ? (
                    <div className="p-2 text-center transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>No screen owners found</div>
                  ) : (
                    screenOwners.map((owner) => (
                      <SelectItem
                        key={owner._id}
                        value={owner._id}
                        className="transition-colors duration-300"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {owner.business_name || owner.full_name} ({owner.email})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsAssignOwnerOpen(false);
                setSelectedScreenForAssign(null);
                setSelectedOwnerId("");
              }}
              className="transition-colors duration-300"
              style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAssignOwner}
              disabled={isAssigning || !selectedOwnerId}
              className="bg-white text-black hover:bg-gray-100"
            >
              {isAssigning ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Assigning...
                </>
              ) : (
                "Assign Owner"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ScreensPage;
