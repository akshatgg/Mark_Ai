"use client";
import React, { useState, useEffect } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Building2, Mail, Phone, MapPin, Eye, Edit, Plus, Loader2, Shield } from "lucide-react";
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
  getAllScreenOwners,
  createScreenOwner,
  updateScreenOwner,
  type ScreenOwner,
} from "@/services/screenService";

const screenOwnerSchema = z.object({
  email: z.string().email("Invalid email address"),
  full_name: z.string().min(2, "Full name must be at least 2 characters"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  business_name: z.string().min(2, "Business name is required"),
  phone: z.string().min(10, "Phone number is required"),
  country: z.string().min(2, "Country is required"),
  state: z.string().min(2, "State is required"),
  city: z.string().min(2, "City is required"),
  website: z.string().url("Invalid URL").optional().or(z.literal("")),
});

type ScreenOwnerFormData = z.infer<typeof screenOwnerSchema>;

const SCREEN_OWNERS_PER_PAGE = 10;

const ScreenOwnersPage = () => {
  const { fullUserData } = useAuth();
  const [screenOwners, setScreenOwners] = useState<ScreenOwner[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [selectedOwner, setSelectedOwner] = useState<ScreenOwner | null>(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const isAdmin = fullUserData?.is_admin === true;

  const form = useForm<ScreenOwnerFormData>({
    resolver: zodResolver(screenOwnerSchema),
    defaultValues: {
      email: "",
      full_name: "",
      password: "",
      business_name: "",
      phone: "",
      country: "",
      state: "",
      city: "",
      website: "",
    },
  });

  // Edit form (without email and password validation)
  const editSchema = z.object({
    full_name: z.string().min(2, "Full name must be at least 2 characters"),
    business_name: z.string().min(2, "Business name is required"),
    phone: z.string().min(10, "Phone number is required"),
    country: z.string().min(2, "Country is required"),
    state: z.string().min(2, "State is required"),
    city: z.string().min(2, "City is required"),
    website: z.string().url("Invalid URL").optional().or(z.literal("")),
    is_active: z.boolean(),
  });

  type EditFormData = z.infer<typeof editSchema>;

  const editForm = useForm<EditFormData>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      full_name: "",
      business_name: "",
      phone: "",
      country: "",
      state: "",
      city: "",
      website: "",
      is_active: true,
    },
  });

  const fetchScreenOwners = async () => {
    try {
      setLoading(true);
      const skip = (currentPage - 1) * SCREEN_OWNERS_PER_PAGE;
      const response = await getAllScreenOwners(SCREEN_OWNERS_PER_PAGE, skip);
      setScreenOwners(response.users || []);
      
      // Use pagination object if available, otherwise fallback to count
      if (response.pagination) {
        const total = response.pagination.total || 0;
        const pages = response.pagination.pages || Math.ceil(total / SCREEN_OWNERS_PER_PAGE);
        setTotalCount(total);
        setTotalPages(pages);
      } else {
        const count = response.count || 0;
        setTotalCount(count);
        setTotalPages(Math.ceil(count / SCREEN_OWNERS_PER_PAGE));
      }
    } catch (error) {
      console.error("Error fetching screen owners:", error);
      toast.error(error instanceof Error ? error.message : "Failed to fetch screen owners");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      fetchScreenOwners();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, currentPage]);

  const onSubmit = async (data: ScreenOwnerFormData) => {
    try {
      setIsSubmitting(true);
      await createScreenOwner({
        ...data,
        website: data.website || undefined,
      });
      toast.success("Screen owner created successfully");
      setIsModalOpen(false);
      form.reset();
      fetchScreenOwners();
    } catch (error) {
      console.error("Error creating screen owner:", error);
      toast.error(error instanceof Error ? error.message : "Failed to create screen owner");
    } finally {
      setIsSubmitting(false);
    }
  };

  const onEditSubmit = async (data: EditFormData) => {
    if (!selectedOwner) return;

    try {
      setIsUpdating(true);
      await updateScreenOwner(selectedOwner._id, {
        ...data,
        website: data.website || undefined,
      });
      toast.success("Screen owner updated successfully");
      setIsEditModalOpen(false);
      editForm.reset();
      fetchScreenOwners();
    } catch (error) {
      console.error("Error updating screen owner:", error);
      toast.error(error instanceof Error ? error.message : "Failed to update screen owner");
    } finally {
      setIsUpdating(false);
    }
  };

  const getStatusColor = (status?: string) => {
    return status === "active" || !status
      ? "bg-green-500/20 text-green-400 border-green-500/30"
      : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  };

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold heading-font mb-2 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Access Denied</h1>
          <p className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>You don't have permission to view this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold heading-font mb-2 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Screen Owners</h1>
          <p className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
            View and manage all screen owners in the platform
          </p>
        </div>
        <Button
          onClick={() => setIsModalOpen(true)}
          className="transition-all duration-300"
          style={{
            backgroundColor: 'var(--accent-blue)',
            color: 'var(--text-inverse)'
          }}
          onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
          onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Screen Owner
        </Button>
      </div>

      <Card className="border transition-all duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6">
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-12 w-12 rounded-lg" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-8 w-24" />
                  </div>
                ))}
              </div>
            </div>
          ) : screenOwners.length === 0 ? (
            <div className="py-12 text-center">
              <Building2 className="w-12 h-12 mx-auto mb-4 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
              <p className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>No screen owners found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-b transition-colors duration-300" style={{ borderColor: 'var(--border-primary)' }}>
                  <TableHead className="font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Business/Owner</TableHead>
                  <TableHead className="font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Email</TableHead>
                  <TableHead className="font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Phone</TableHead>
                  <TableHead className="font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Location</TableHead>
                  <TableHead className="font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Website</TableHead>
                  <TableHead className="font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Status</TableHead>
                  <TableHead className="font-semibold text-right transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {screenOwners.map((owner) => (
                  <TableRow
                    key={owner._id}
                    className="border-b transition-colors duration-300"
                    style={{ borderColor: 'var(--border-primary)' }}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-colors duration-300" style={{ backgroundColor: 'var(--bg-accent)' }}>
                          <Building2 className="w-5 h-5 transition-colors duration-300" style={{ color: 'var(--accent-blue)' }} />
                        </div>
                        <div>
                          <p className="font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                            {owner.business_name || owner.full_name}
                          </p>
                          {owner.business_name && (
                            <p className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>{owner.full_name}</p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                        <Mail className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
                        <span className="text-sm">{owner.email}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {owner.phone ? (
                        <div className="flex items-center gap-2 transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                          <Phone className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
                          <span className="text-sm">{owner.phone}</span>
                        </div>
                      ) : (
                        <span className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {(owner.city || owner.state || owner.country) ? (
                        <div className="flex items-center gap-2 transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                          <MapPin className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
                          <span className="text-sm">
                            {[owner.city, owner.state, owner.country]
                              .filter(Boolean)
                              .join(", ")}
                          </span>
                        </div>
                      ) : (
                        <span className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {owner.website ? (
                        <a
                          href={owner.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm transition-colors duration-300 hover:underline"
                          style={{ color: 'var(--accent-blue)' }}
                        >
                          {owner.website}
                        </a>
                      ) : (
                        <span className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={owner.is_active !== false ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}>
                        {owner.is_active !== false ? "Active" : "Revoked"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="transition-all duration-300"
                          style={{
                            borderColor: 'var(--border-primary)',
                            color: 'var(--text-primary)'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--bg-accent)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }}
                          onClick={() => {
                            setSelectedOwner(owner);
                            setIsViewModalOpen(true);
                          }}
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          View
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="transition-all duration-300"
                          style={{
                            borderColor: 'var(--border-primary)',
                            color: 'var(--text-primary)'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--bg-accent)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }}
                          onClick={() => {
                            setSelectedOwner(owner);
                            editForm.reset({
                              full_name: owner.full_name,
                              business_name: owner.business_name || "",
                              phone: owner.phone || "",
                              country: owner.country || "",
                              state: owner.state || "",
                              city: owner.city || "",
                              website: owner.website || "",
                              is_active: owner.is_active !== false,
                            });
                            setIsEditModalOpen(true);
                          }}
                        >
                          <Edit className="w-4 h-4 mr-1" />
                          Edit
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          
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
                          "transition-all duration-300",
                          currentPage === 1 && "pointer-events-none opacity-50"
                        )}
                        style={{
                          color: 'var(--text-primary)',
                          borderColor: 'var(--border-primary)'
                        }}
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
                              "min-w-10 transition-all duration-300",
                              currentPage === pageNum && "hover:opacity-90"
                            )}
                            style={
                              currentPage === pageNum
                                ? {
                                    backgroundColor: 'var(--accent-blue)',
                                    color: 'var(--text-inverse)',
                                    borderColor: 'var(--accent-blue)'
                                  }
                                : {
                                    color: 'var(--text-primary)',
                                    borderColor: 'var(--border-primary)'
                                  }
                            }
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
                          "transition-all duration-300",
                          currentPage === totalPages && "pointer-events-none opacity-50"
                        )}
                        style={{
                          color: 'var(--text-primary)',
                          borderColor: 'var(--border-primary)'
                        }}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
              <div className="mt-4 text-center text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                Showing page {currentPage} of {totalPages} ({totalCount} total screen owners)
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto transition-all duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>
          <DialogHeader>
            <DialogTitle className="text-2xl transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Add Screen Owner</DialogTitle>
            <DialogDescription className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
              Create a new screen owner account
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="full_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Full Name</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          className="transition-all duration-300"
                          style={{
                            backgroundColor: 'var(--bg-secondary)',
                            borderColor: 'var(--border-primary)',
                            color: 'var(--text-primary)'
                          }}
                          placeholder="John Doe"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Email</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="email"
                          className="transition-all duration-300"
                          style={{
                            backgroundColor: 'var(--bg-secondary)',
                            borderColor: 'var(--border-primary)',
                            color: 'var(--text-primary)'
                          }}
                          placeholder="john@example.com"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Password</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          className="transition-all duration-300"
                          style={{
                            backgroundColor: 'var(--bg-secondary)',
                            borderColor: 'var(--border-primary)',
                            color: 'var(--text-primary)'
                          }}
                          placeholder="••••••••"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="business_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Business Name</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          className="transition-all duration-300"
                          style={{
                            backgroundColor: 'var(--bg-secondary)',
                            borderColor: 'var(--border-primary)',
                            color: 'var(--text-primary)'
                          }}
                          placeholder="Business Name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Phone</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          className="transition-all duration-300"
                          style={{
                            backgroundColor: 'var(--bg-secondary)',
                            borderColor: 'var(--border-primary)',
                            color: 'var(--text-primary)'
                          }}
                          placeholder="+567890"
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
                      <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Country</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          className="transition-all duration-300"
                          style={{
                            backgroundColor: 'var(--bg-secondary)',
                            borderColor: 'var(--border-primary)',
                            color: 'var(--text-primary)'
                          }}
                          placeholder="United States"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="state"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>State</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          className="transition-all duration-300"
                          style={{
                            backgroundColor: 'var(--bg-secondary)',
                            borderColor: 'var(--border-primary)',
                            color: 'var(--text-primary)'
                          }}
                          placeholder="New York"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>City</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          className="transition-all duration-300"
                          style={{
                            backgroundColor: 'var(--bg-secondary)',
                            borderColor: 'var(--border-primary)',
                            color: 'var(--text-primary)'
                          }}
                          placeholder="New York City"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="website"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Website (Optional)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="url"
                          className="transition-all duration-300"
                          style={{
                            backgroundColor: 'var(--bg-secondary)',
                            borderColor: 'var(--border-primary)',
                            color: 'var(--text-primary)'
                          }}
                          placeholder="https://example.com"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsModalOpen(false);
                    form.reset();
                  }}
                  className="transition-all duration-300"
                  style={{
                    borderColor: 'var(--border-primary)',
                    color: 'var(--text-primary)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--bg-accent)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="transition-all duration-300"
                  style={{
                    backgroundColor: 'var(--accent-blue)',
                    color: 'var(--text-inverse)'
                  }}
                  onMouseEnter={(e) => !isSubmitting && (e.currentTarget.style.opacity = '0.9')}
                  onMouseLeave={(e) => !isSubmitting && (e.currentTarget.style.opacity = '1')}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Screen Owner"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* View Screen Owner Details Modal */}
      <Dialog open={isViewModalOpen} onOpenChange={setIsViewModalOpen}>
        <DialogContent className="max-w-2xl transition-all duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>
          <DialogHeader>
            <DialogTitle className="text-2xl transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Screen Owner Details</DialogTitle>
            <DialogDescription className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
              View screen owner information
            </DialogDescription>
          </DialogHeader>
          {selectedOwner && (
            <div className="space-y-6">
              {/* Business Info */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center gap-2 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                  <Building2 className="w-5 h-5 transition-colors duration-300" style={{ color: 'var(--accent-blue)' }} />
                  Business Information
                </h3>
                <div className="grid grid-cols-2 gap-4 p-4 rounded-lg border transition-all duration-300" style={{ backgroundColor: 'var(--bg-accent)', borderColor: 'var(--border-primary)' }}>
                  <div>
                    <p className="text-sm mb-1 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Business Name</p>
                    <p className="font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                      {selectedOwner.business_name || "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm mb-1 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Owner Name</p>
                    <p className="font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>{selectedOwner.full_name}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-sm mb-1 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Website</p>
                    {selectedOwner.website ? (
                      <a
                        href={selectedOwner.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline transition-colors duration-300"
                        style={{ color: 'var(--accent-blue)' }}
                      >
                        {selectedOwner.website}
                      </a>
                    ) : (
                      <p className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>-</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Contact Info */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center gap-2 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                  <Mail className="w-5 h-5 text-green-400" />
                  Contact Information
                </h3>
                <div className="grid grid-cols-2 gap-4 p-4 rounded-lg border transition-all duration-300" style={{ backgroundColor: 'var(--bg-accent)', borderColor: 'var(--border-primary)' }}>
                  <div>
                    <p className="text-sm mb-1 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Email</p>
                    <p className="font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>{selectedOwner.email}</p>
                  </div>
                  <div>
                    <p className="text-sm mb-1 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Phone</p>
                    <p className="font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                      {selectedOwner.phone || "-"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Location Info */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center gap-2 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                  <MapPin className="w-5 h-5 transition-colors duration-300" style={{ color: 'var(--accent-purple)' }} />
                  Location
                </h3>
                <div className="grid grid-cols-3 gap-4 p-4 rounded-lg border transition-all duration-300" style={{ backgroundColor: 'var(--bg-accent)', borderColor: 'var(--border-primary)' }}>
                  <div>
                    <p className="text-sm mb-1 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>City</p>
                    <p className="font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                      {selectedOwner.city || "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm mb-1 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>State</p>
                    <p className="font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                      {selectedOwner.state || "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm mb-1 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Country</p>
                    <p className="font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                      {selectedOwner.country || "-"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Account Status */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Account Status</h3>
                <div className="p-4 rounded-lg border transition-all duration-300" style={{ backgroundColor: 'var(--bg-accent)', borderColor: 'var(--border-primary)' }}>
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                    Active
                  </Badge>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              onClick={() => setIsViewModalOpen(false)}
              className="transition-all duration-300"
              style={{
                backgroundColor: 'var(--accent-blue)',
                color: 'var(--text-inverse)'
              }}
              onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
              onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Screen Owner Modal */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto transition-all duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>
          <DialogHeader>
            <DialogTitle className="text-2xl transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Edit Screen Owner</DialogTitle>
            <DialogDescription className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
              Update screen owner details and access status
            </DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
              {/* Access Status Toggle - Prominently displayed */}
              <div className="p-4 rounded-lg bg-linear-to-r from-red-500/10 to-orange-500/10 border border-red-500/20">
                <FormField
                  control={editForm.control}
                  name="is_active"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between space-y-0">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base flex items-center gap-2">
                          <Shield className="w-5 h-5 text-orange-400" />
                          <span className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Account Access</span>
                        </FormLabel>
                        <p className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                          {field.value
                            ? "This screen owner can login and access the platform"
                            : "Access is revoked - screen owner cannot login"}
                        </p>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          className="data-[state=checked]:bg-green-600 data-[state=unchecked]:bg-red-600/80 border-2 data-[state=checked]:border-green-400 data-[state=unchecked]:border-red-400 scale-125"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <div className="mt-2 text-xs text-gray-500">
                  {editForm.watch("is_active") ? (
                    <span className="text-green-400">✓ Active - User has full access</span>
                  ) : (
                    <span className="text-red-400">⚠ Revoked - User cannot login</span>
                  )}
                </div>
              </div>

              {/* Basic Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={editForm.control}
                  name="full_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Full Name</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          className="transition-all duration-300"
                          style={{
                            backgroundColor: 'var(--bg-secondary)',
                            borderColor: 'var(--border-primary)',
                            color: 'var(--text-primary)'
                          }}
                          placeholder="John Doe"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="business_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Business Name</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          className="transition-all duration-300"
                          style={{
                            backgroundColor: 'var(--bg-secondary)',
                            borderColor: 'var(--border-primary)',
                            color: 'var(--text-primary)'
                          }}
                          placeholder="Business Name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Phone</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          className="transition-all duration-300"
                          style={{
                            backgroundColor: 'var(--bg-secondary)',
                            borderColor: 'var(--border-primary)',
                            color: 'var(--text-primary)'
                          }}
                          placeholder="+1234567890"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="country"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Country</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          className="transition-all duration-300"
                          style={{
                            backgroundColor: 'var(--bg-secondary)',
                            borderColor: 'var(--border-primary)',
                            color: 'var(--text-primary)'
                          }}
                          placeholder="United States"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="state"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>State</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          className="transition-all duration-300"
                          style={{
                            backgroundColor: 'var(--bg-secondary)',
                            borderColor: 'var(--border-primary)',
                            color: 'var(--text-primary)'
                          }}
                          placeholder="New York"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>City</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          className="transition-all duration-300"
                          style={{
                            backgroundColor: 'var(--bg-secondary)',
                            borderColor: 'var(--border-primary)',
                            color: 'var(--text-primary)'
                          }}
                          placeholder="New York City"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="website"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Website (Optional)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="url"
                          className="transition-all duration-300"
                          style={{
                            backgroundColor: 'var(--bg-secondary)',
                            borderColor: 'var(--border-primary)',
                            color: 'var(--text-primary)'
                          }}
                          placeholder="https://example.com"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsEditModalOpen(false);
                    editForm.reset();
                  }}
                  className="transition-all duration-300"
                  style={{
                    borderColor: 'var(--border-primary)',
                    color: 'var(--text-primary)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--bg-accent)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isUpdating}
                  className="transition-all duration-300"
                  style={{
                    backgroundColor: 'var(--accent-blue)',
                    color: 'var(--text-inverse)'
                  }}
                  onMouseEnter={(e) => !isUpdating && (e.currentTarget.style.opacity = '0.9')}
                  onMouseLeave={(e) => !isUpdating && (e.currentTarget.style.opacity = '1')}
                >
                  {isUpdating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    "Update Screen Owner"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ScreenOwnersPage;
