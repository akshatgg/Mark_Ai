"use client";
import { useState, useEffect } from "react";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { User, Mail, Phone, MapPin, Shield, Building2, Eye, Calendar, CheckCircle, XCircle } from "lucide-react";
import { ScreenSearchBar } from "@/components/common/ScreenSearchBar";
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
  getAllNormalUsers,
  getAllScreenOwners,
  type ScreenOwner,
} from "@/services/screenService";

const USERS_PER_PAGE = 10;

const UsersPage = () => {
  const { fullUserData } = useAuth();
  const [normalUsers, setNormalUsers] = useState<ScreenOwner[]>([]);
  const [screenOwners, setScreenOwners] = useState<ScreenOwner[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"advertisers" | "screen-owners">("advertisers");
  const [searchTerm, setSearchTerm] = useState("");

  // View modal state
  const [selectedUser, setSelectedUser] = useState<ScreenOwner | null>(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);

  // Pagination state for advertisers
  const [advertiserCurrentPage, setAdvertiserCurrentPage] = useState(1);
  const [advertiserTotalCount, setAdvertiserTotalCount] = useState(0);
  const [advertiserTotalPages, setAdvertiserTotalPages] = useState(0);

  // Pagination state for screen owners
  const [ownerCurrentPage, setOwnerCurrentPage] = useState(1);
  const [ownerTotalCount, setOwnerTotalCount] = useState(0);
  const [ownerTotalPages, setOwnerTotalPages] = useState(0);

  const isAdmin = fullUserData?.is_admin === true;

  const fetchNormalUsers = async () => {
    try {
      setLoading(true);
      const skip = (advertiserCurrentPage - 1) * USERS_PER_PAGE;
      const response = await getAllNormalUsers(USERS_PER_PAGE, skip, searchTerm);
      const users = response.users || [];
      setNormalUsers(users);

      // Use pagination object if available, otherwise fallback to count
      if (response.pagination) {
        const total = response.pagination.total || 0;
        const pages = response.pagination.pages || Math.ceil(total / USERS_PER_PAGE);
        setAdvertiserTotalCount(total);
        setAdvertiserTotalPages(pages);
      } else {
        const count = response.count || 0;
        setAdvertiserTotalCount(count);
        setAdvertiserTotalPages(Math.ceil(count / USERS_PER_PAGE));
      }
    } catch (error) {
      console.error("Error fetching normal users:", error);
      toast.error(error instanceof Error ? error.message : "Failed to fetch users");
    } finally {
      setLoading(false);
    }
  };

  const fetchScreenOwners = async () => {
    try {
      setLoading(true);
      const skip = (ownerCurrentPage - 1) * USERS_PER_PAGE;
      const response = await getAllScreenOwners(USERS_PER_PAGE, skip, searchTerm);
      const owners = response.users || [];
      setScreenOwners(owners);

      // Use pagination object if available, otherwise fallback to count
      if (response.pagination) {
        const total = response.pagination.total || 0;
        const pages = response.pagination.pages || Math.ceil(total / USERS_PER_PAGE);
        setOwnerTotalCount(total);
        setOwnerTotalPages(pages);
      } else {
        const count = response.count || 0;
        setOwnerTotalCount(count);
        setOwnerTotalPages(Math.ceil(count / USERS_PER_PAGE));
      }
    } catch (error) {
      console.error("Error fetching screen owners:", error);
      toast.error(error instanceof Error ? error.message : "Failed to fetch screen owners");
    } finally {
      setLoading(false);
    }
  };

  // Fetch both counts on initial load
  useEffect(() => {
    if (isAdmin) {
      // Fetch advertiser count
      const fetchAdvertiserCount = async () => {
        try {
          const response = await getAllNormalUsers(1, 0);
          if (response.pagination) {
            setAdvertiserTotalCount(response.pagination.total || 0);
            setAdvertiserTotalPages(response.pagination.pages || 1);
          } else {
            setAdvertiserTotalCount(response.count || 0);
            setAdvertiserTotalPages(Math.ceil((response.count || 0) / USERS_PER_PAGE));
          }
        } catch (error) {
          console.error("Error fetching advertiser count:", error);
        }
      };

      // Fetch screen owner count
      const fetchOwnerCount = async () => {
        try {
          const response = await getAllScreenOwners(1, 0);
          if (response.pagination) {
            setOwnerTotalCount(response.pagination.total || 0);
            setOwnerTotalPages(response.pagination.pages || 1);
          } else {
            setOwnerTotalCount(response.count || 0);
            setOwnerTotalPages(Math.ceil((response.count || 0) / USERS_PER_PAGE));
          }
        } catch (error) {
          console.error("Error fetching screen owner count:", error);
        }
      };

      fetchAdvertiserCount();
      fetchOwnerCount();
    }
  }, [isAdmin]);

  // Fetch data for active tab
  useEffect(() => {
    if (isAdmin) {
      if (activeTab === "advertisers") {
        fetchNormalUsers();
      } else {
        fetchScreenOwners();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, activeTab, advertiserCurrentPage, ownerCurrentPage, searchTerm]);

  // Reset to page 1 when search term changes
  useEffect(() => {
    if (searchTerm !== "") {
      setAdvertiserCurrentPage(1);
      setOwnerCurrentPage(1);
    }
  }, [searchTerm]);

  const getTypeColor = (type: string) => {
    switch (type) {
      case "admin":
        return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      case "screen_owner":
        return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      default:
        return "bg-[var(--brand-blue)]/15 text-[var(--brand-blue)] border-[var(--brand-blue)]/30";
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "admin":
        return Shield;
      case "screen_owner":
        return Building2;
      default:
        return User;
    }
  };

  const currentUsers = activeTab === "advertisers" ? normalUsers : screenOwners;
  const currentPage = activeTab === "advertisers" ? advertiserCurrentPage : ownerCurrentPage;
  const setCurrentPage = activeTab === "advertisers" ? setAdvertiserCurrentPage : setOwnerCurrentPage;
  const totalPages = activeTab === "advertisers" ? advertiserTotalPages : ownerTotalPages;
  const totalCount = activeTab === "advertisers" ? advertiserTotalCount : ownerTotalCount;

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
      <div>
        <h1 className="text-3xl font-bold heading-font mb-2 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>All Users</h1>
        <p className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
          View and manage all users in the platform
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b transition-colors duration-300" style={{ borderColor: 'var(--border-primary)' }}>
        <button
          onClick={() => setActiveTab("advertisers")}
          className="px-4 py-2 text-sm font-medium transition-all duration-300 border-b-2"
          style={{
            borderColor: activeTab === "advertisers" ? 'var(--accent-purple)' : 'transparent',
            color: activeTab === "advertisers" ? 'var(--text-primary)' : 'var(--text-tertiary)'
          }}
          onMouseEnter={(e) => {
            if (activeTab !== "advertisers") e.currentTarget.style.color = 'var(--text-primary)'
          }}
          onMouseLeave={(e) => {
            if (activeTab !== "advertisers") e.currentTarget.style.color = 'var(--text-tertiary)'
          }}
        >
          Advertisers ({advertiserTotalCount})
        </button>
        <button
          onClick={() => setActiveTab("screen-owners")}
          className="px-4 py-2 text-sm font-medium transition-all duration-300 border-b-2"
          style={{
            borderColor: activeTab === "screen-owners" ? 'var(--accent-blue)' : 'transparent',
            color: activeTab === "screen-owners" ? 'var(--text-primary)' : 'var(--text-tertiary)'
          }}
          onMouseEnter={(e) => {
            if (activeTab !== "screen-owners") e.currentTarget.style.color = 'var(--text-primary)'
          }}
          onMouseLeave={(e) => {
            if (activeTab !== "screen-owners") e.currentTarget.style.color = 'var(--text-tertiary)'
          }}
        >
          Screen Owners ({ownerTotalCount})
        </button>
      </div>

      {/* Server-side Search Bar Component */}
      <ScreenSearchBar
        onSearch={setSearchTerm}
        placeholder={`Search ${activeTab === "advertisers" ? "advertisers" : "screen owners"} by name, email, phone, or business...`}
        className="max-w-md"
        debounceMs={500}
      />

      {/* Data Table */}
      {loading ? (
        <Card className="border transition-all duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
          <CardContent className="p-6">
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="w-10 h-10 rounded-lg" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                  <Skeleton className="h-8 w-24 rounded-full" />
                  <Skeleton className="h-8 w-20" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : currentUsers.length === 0 ? (
        <Card className="border transition-all duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
          <CardContent className="py-12 text-center">
            <User className="w-12 h-12 mx-auto mb-4 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
            <p className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
              {searchTerm
                ? "No users found matching your search"
                : `No ${activeTab === "advertisers" ? "advertisers" : "screen owners"} found`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border transition-all duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
          <Table>
            <TableHeader>
              <TableRow className="border-b transition-colors duration-300" style={{ borderColor: 'var(--border-primary)' }}>
                <TableHead className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>User</TableHead>
                <TableHead className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Email</TableHead>
                <TableHead className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Phone</TableHead>
                <TableHead className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Location</TableHead>
                <TableHead className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Business</TableHead>
                <TableHead className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Type</TableHead>
                <TableHead className="text-right transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentUsers.map((user) => {
                const userType = user.is_admin
                  ? "admin"
                  : user.is_screen_owner
                  ? "screen_owner"
                  : "advertiser";
                const TypeIcon = getTypeIcon(userType);
                return (
                  <TableRow key={user._id} className="border-b transition-colors duration-300" style={{ borderColor: 'var(--border-primary)' }}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center transition-colors duration-300" style={{ backgroundColor: 'var(--bg-accent)' }}>
                          <TypeIcon className="w-5 h-5 transition-colors duration-300" style={{ color: 'var(--accent-purple)' }} />
                        </div>
                        <div>
                          <div className="font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                            {user.full_name}
                          </div>
                          <div className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                            ID: {user._id.slice(-8)}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                      <div className="flex items-center gap-2">
                        <Mail className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
                        <span className="text-sm">{user.email}</span>
                      </div>
                    </TableCell>
                    <TableCell className="transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                      {user.phone ? (
                        <div className="flex items-center gap-2">
                          <Phone className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
                          <span className="text-sm">{user.phone}</span>
                        </div>
                      ) : (
                        <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>-</span>
                      )}
                    </TableCell>
                    <TableCell className="transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                      {user.city || user.state ? (
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
                          <span className="text-sm">
                            {[user.city, user.state].filter(Boolean).join(", ")}
                          </span>
                        </div>
                      ) : (
                        <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>-</span>
                      )}
                    </TableCell>
                    <TableCell className="transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                      <span className="text-sm">{user.business_name || "-"}</span>
                    </TableCell>
                    <TableCell>
                      <Badge className={getTypeColor(userType)}>
                        {userType === "screen_owner"
                          ? "Screen Owner"
                          : userType === "admin"
                          ? "Admin"
                          : "Advertiser"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="transition-all duration-300"
                        style={{ color: 'var(--text-secondary)' }}
                        onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent-blue)'}
                        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                        onClick={() => {
                          setSelectedUser(user);
                          setIsViewModalOpen(true);
                        }}
                        title="View Details"
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

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
                                    backgroundColor: activeTab === "advertisers" ? 'var(--accent-purple)' : 'var(--accent-blue)',
                                    color: 'var(--text-inverse)',
                                    borderColor: activeTab === "advertisers" ? 'var(--accent-purple)' : 'var(--accent-blue)'
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
                Showing page {currentPage} of {totalPages} ({totalCount} total {activeTab === "advertisers" ? "advertisers" : "screen owners"})
              </div>
            </div>
          )}
        </Card>
      )}

      {/* View User Modal */}
      <Dialog open={isViewModalOpen} onOpenChange={setIsViewModalOpen}>
        <DialogContent className="max-w-2xl transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
              <User className="w-5 h-5" />
              User Details
            </DialogTitle>
            <DialogDescription className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
              View detailed information about this user
            </DialogDescription>
          </DialogHeader>

          {selectedUser && (
            <div className="space-y-6 mt-4">
              {/* User Header */}
              <div className="flex items-center gap-4 p-4 rounded-lg transition-colors duration-300" style={{ backgroundColor: 'var(--bg-accent)' }}>
                <div className="w-16 h-16 rounded-full flex items-center justify-center transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)' }}>
                  {selectedUser.is_admin ? (
                    <Shield className="w-8 h-8" style={{ color: 'var(--accent-yellow)' }} />
                  ) : selectedUser.is_screen_owner ? (
                    <Building2 className="w-8 h-8" style={{ color: 'var(--accent-blue)' }} />
                  ) : (
                    <User className="w-8 h-8" style={{ color: 'var(--accent-purple)' }} />
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                    {selectedUser.full_name || "N/A"}
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge className={getTypeColor(
                      selectedUser.is_admin ? "admin" : selectedUser.is_screen_owner ? "screen_owner" : "advertiser"
                    )}>
                      {selectedUser.is_admin ? "Admin" : selectedUser.is_screen_owner ? "Screen Owner" : "Advertiser"}
                    </Badge>
                    {selectedUser.is_active !== undefined && (
                      <Badge className={selectedUser.is_active
                        ? "bg-green-500/20 text-green-400 border-green-500/30"
                        : "bg-red-500/20 text-red-400 border-red-500/30"
                      }>
                        {selectedUser.is_active ? "Active" : "Inactive"}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Contact Information */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold uppercase tracking-wide transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                  Contact Information
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center gap-3 p-3 rounded-lg transition-colors duration-300" style={{ backgroundColor: 'var(--bg-accent)' }}>
                    <Mail className="w-5 h-5" style={{ color: 'var(--accent-blue)' }} />
                    <div>
                      <p className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Email</p>
                      <p className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                        {selectedUser.email || "N/A"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg transition-colors duration-300" style={{ backgroundColor: 'var(--bg-accent)' }}>
                    <Phone className="w-5 h-5" style={{ color: 'var(--accent-green)' }} />
                    <div>
                      <p className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Phone</p>
                      <p className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                        {selectedUser.phone || "N/A"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Location Information */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold uppercase tracking-wide transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                  Location Information
                </h4>
                <div className="flex items-center gap-3 p-3 rounded-lg transition-colors duration-300" style={{ backgroundColor: 'var(--bg-accent)' }}>
                  <MapPin className="w-5 h-5" style={{ color: 'var(--accent-purple)' }} />
                  <div>
                    <p className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>City, State</p>
                    <p className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                      {[selectedUser.city, selectedUser.state].filter(Boolean).join(", ") || "N/A"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Business Information */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold uppercase tracking-wide transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                  Business Information
                </h4>
                <div className="flex items-center gap-3 p-3 rounded-lg transition-colors duration-300" style={{ backgroundColor: 'var(--bg-accent)' }}>
                  <Building2 className="w-5 h-5" style={{ color: 'var(--accent-blue)' }} />
                  <div>
                    <p className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Business Name</p>
                    <p className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                      {selectedUser.business_name || "N/A"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Account Information */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold uppercase tracking-wide transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                  Account Information
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center gap-3 p-3 rounded-lg transition-colors duration-300" style={{ backgroundColor: 'var(--bg-accent)' }}>
                    <Calendar className="w-5 h-5" style={{ color: 'var(--text-tertiary)' }} />
                    <div>
                      <p className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>User ID</p>
                      <p className="text-sm font-medium font-mono transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                        {selectedUser._id}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg transition-colors duration-300" style={{ backgroundColor: 'var(--bg-accent)' }}>
                    {selectedUser.is_active !== false ? (
                      <CheckCircle className="w-5 h-5" style={{ color: 'var(--accent-green)' }} />
                    ) : (
                      <XCircle className="w-5 h-5" style={{ color: 'var(--accent-red)' }} />
                    )}
                    <div>
                      <p className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Account Status</p>
                      <p className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                        {selectedUser.is_active !== false ? "Active" : "Inactive"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Close Button */}
              <div className="flex justify-end pt-4 border-t transition-colors duration-300" style={{ borderColor: 'var(--border-primary)' }}>
                <Button
                  variant="outline"
                  onClick={() => setIsViewModalOpen(false)}
                  className="transition-colors duration-300"
                  style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UsersPage;
