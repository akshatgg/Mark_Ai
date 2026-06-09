"use client";
import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileText, Eye, CheckCircle, XCircle, Clock, Image as ImageIcon } from "lucide-react";
import Image from "next/image";
import toast from "react-hot-toast";

// Dummy data for creatives
const dummyCreatives = [
  {
    id: "1",
    campaignName: "Summer Collection 2024",
    advertiserName: "Fashion Brand Co.",
    advertiserEmail: "contact@fashionbrand.com",
    screenName: "MG Road Cafe Digital Display",
    creativeType: "Video",
    fileUrl: "/background.jpg",
    duration: "30 seconds",
    submittedDate: "2024-01-15",
    status: "pending",
    description: "Promotional video for summer collection featuring new arrivals",
  },
  {
    id: "2",
    campaignName: "Tech Product Launch",
    advertiserName: "Tech Innovations Ltd.",
    advertiserEmail: "marketing@techinnovations.com",
    screenName: "Times Square Billboard #1",
    creativeType: "Image",
    fileUrl: "/background.jpg",
    duration: "Static",
    submittedDate: "2024-01-14",
    status: "pending",
    description: "Product launch banner for new smartphone release",
  },
  {
    id: "3",
    campaignName: "Restaurant Grand Opening",
    advertiserName: "Gourmet Eats",
    advertiserEmail: "info@gourmet.com",
    screenName: "City Center Mall Display",
    creativeType: "Video",
    fileUrl: "/background.jpg",
    duration: "15 seconds",
    submittedDate: "2024-01-13",
    status: "approved",
    description: "Grand opening announcement video with special offers",
  },
  {
    id: "4",
    campaignName: "Fitness Center Membership",
    advertiserName: "FitLife Gym",
    advertiserEmail: "membership@fitlife.com",
    screenName: "Sports Complex Digital Board",
    creativeType: "Image",
    fileUrl: "/background.jpg",
    duration: "Static",
    submittedDate: "2024-01-12",
    status: "declined",
    description: "Membership promotion banner with pricing details",
  },
  {
    id: "5",
    campaignName: "Music Festival Promotion",
    advertiserName: "Event Management Pro",
    advertiserEmail: "events@eventpro.com",
    screenName: "Entertainment District Screen",
    creativeType: "Video",
    fileUrl: "/background.jpg",
    duration: "45 seconds",
    submittedDate: "2024-01-11",
    status: "pending",
    description: "Festival lineup announcement and ticket sales promotion",
  },
];

type CreativeStatus = "pending" | "approved" | "declined";

interface Creative {
  id: string;
  campaignName: string;
  advertiserName: string;
  advertiserEmail: string;
  screenName: string;
  creativeType: string;
  fileUrl: string;
  duration: string;
  submittedDate: string;
  status: CreativeStatus;
  description: string;
}

const CreativesPage = () => {
  const { fullUserData } = useAuth();
  const [creatives, setCreatives] = useState<Creative[]>(() => dummyCreatives as Creative[]);
  const [selectedCreative, setSelectedCreative] = useState<Creative | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const isScreenOwner = fullUserData?.is_screen_owner === true;

  if (!isScreenOwner) {
    return (
      <div className="space-y-6">
        <Card className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
          <CardContent className="py-12 text-center">
            <p className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Access denied. This page is only for screen owners.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getStatusColor = (status: CreativeStatus) => {
    switch (status) {
      case "approved":
        return "bg-green-500/20 text-green-400 border-green-500/30";
      case "declined":
        return "bg-red-500/20 text-red-400 border-red-500/30";
      case "pending":
        return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      default:
        return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    }
  };

  const handleView = (creative: Creative) => {
    setSelectedCreative(creative);
    setIsDialogOpen(true);
  };

  const handleApprove = async (creativeId: string) => {
    try {
      setIsProcessing(true);
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000));
      
      setCreatives((prev) =>
        prev.map((c) => (c.id === creativeId ? { ...c, status: "approved" as CreativeStatus } : c))
      );
      
      toast.success("Creative approved successfully");
      setIsDialogOpen(false);
      setSelectedCreative(null);
    } catch (error) {
      toast.error("Failed to approve creative");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDecline = async (creativeId: string) => {
    try {
      setIsProcessing(true);
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000));
      
      setCreatives((prev) =>
        prev.map((c) => (c.id === creativeId ? { ...c, status: "declined" as CreativeStatus } : c))
      );
      
      toast.success("Creative declined");
      setIsDialogOpen(false);
      setSelectedCreative(null);
    } catch (error) {
      toast.error("Failed to decline creative");
    } finally {
      setIsProcessing(false);
    }
  };

  const pendingCount = creatives.filter((c) => c.status === "pending").length;
  const approvedCount = creatives.filter((c) => c.status === "approved").length;
  const declinedCount = creatives.filter((c) => c.status === "declined").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Review Creatives</h1>
        <p className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Review and approve/decline creative submissions from advertisers</p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Pending Review</CardTitle>
            <Clock className="h-4 w-4 text-yellow-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-400">{pendingCount}</div>
            <p className="text-xs mt-1 transition-colors duration-300" style={{ color: 'var(--text-muted)' }}>Awaiting your approval</p>
          </CardContent>
        </Card>

        <Card className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Approved</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-400">{approvedCount}</div>
            <p className="text-xs mt-1 transition-colors duration-300" style={{ color: 'var(--text-muted)' }}>Total approved</p>
          </CardContent>
        </Card>

        <Card className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Declined</CardTitle>
            <XCircle className="h-4 w-4 text-red-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-400">{declinedCount}</div>
            <p className="text-xs mt-1 transition-colors duration-300" style={{ color: 'var(--text-muted)' }}>Total declined</p>
          </CardContent>
        </Card>
      </div>

      {/* Creatives Table */}
      <Card className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
        <CardHeader>
          <CardTitle className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Creative Submissions</CardTitle>
          <CardDescription className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
            Review and manage creative submissions for your screens
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="transition-colors duration-300 hover:bg-transparent" style={{ borderColor: 'var(--border-primary)' }}>
                <TableHead className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Campaign</TableHead>
                <TableHead className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Advertiser</TableHead>
                <TableHead className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Screen</TableHead>
                <TableHead className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Type</TableHead>
                <TableHead className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Submitted</TableHead>
                <TableHead className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Status</TableHead>
                <TableHead className="transition-colors duration-300 text-right" style={{ color: 'var(--text-primary)' }}>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {creatives.map((creative) => (
                <TableRow key={creative.id} className="transition-colors duration-300" style={{ borderColor: 'var(--border-primary)' }}>
                  <TableCell className="font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
                      {creative.campaignName}
                    </div>
                  </TableCell>
                  <TableCell className="transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                    <div>
                      <div className="font-medium">{creative.advertiserName}</div>
                      <div className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>{creative.advertiserEmail}</div>
                    </div>
                  </TableCell>
                  <TableCell className="transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>{creative.screenName}</TableCell>
                  <TableCell className="transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                    <div className="flex items-center gap-2">
                      {creative.creativeType === "Video" ? (
                        <FileText className="w-4 h-4" />
                      ) : (
                        <ImageIcon className="w-4 h-4" />
                      )}
                      {creative.creativeType}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                    {new Date(creative.submittedDate).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Badge className={getStatusColor(creative.status)}>
                      {creative.status.charAt(0).toUpperCase() + creative.status.slice(1)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleView(creative)}
                      className="transition-colors duration-300"
                      style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                    >
                      <Eye className="w-4 h-4 mr-1" />
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* View Creative Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="transition-colors duration-300 max-w-4xl max-h-[90vh] overflow-y-auto" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>
          <DialogHeader>
            <DialogTitle className="text-2xl transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>{selectedCreative?.campaignName}</DialogTitle>
            <DialogDescription className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
              Review creative submission details
            </DialogDescription>
          </DialogHeader>

          {selectedCreative && (
            <div className="space-y-6">
              {/* Creative Preview */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Creative Preview</h3>
                <div className="relative w-full h-64 rounded-lg overflow-hidden transition-colors duration-300" style={{ borderColor: 'var(--border-primary)', border: '1px solid', backgroundColor: 'var(--bg-card)' }}>
                  <Image
                    src={selectedCreative.fileUrl}
                    alt={selectedCreative.campaignName}
                    fill
                    className="object-contain"
                    unoptimized
                  />
                </div>
              </div>

              {/* Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <p className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Advertiser</p>
                  <p className="font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>{selectedCreative.advertiserName}</p>
                  <p className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>{selectedCreative.advertiserEmail}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Screen</p>
                  <p className="font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>{selectedCreative.screenName}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Creative Type</p>
                  <p className="font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>{selectedCreative.creativeType}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Duration</p>
                  <p className="font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>{selectedCreative.duration}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Submitted Date</p>
                  <p className="font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                    {new Date(selectedCreative.submittedDate).toLocaleDateString()}
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Status</p>
                  <Badge className={getStatusColor(selectedCreative.status)}>
                    {selectedCreative.status.charAt(0).toUpperCase() + selectedCreative.status.slice(1)}
                  </Badge>
                </div>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <p className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Description</p>
                <p className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>{selectedCreative.description}</p>
              </div>
            </div>
          )}

          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              className="transition-colors duration-300"
              style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
            >
              Close
            </Button>
            {selectedCreative?.status === "pending" && (
              <>
                <Button
                  variant="outline"
                  onClick={() => handleDecline(selectedCreative.id)}
                  disabled={isProcessing}
                  className="border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors duration-300"
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  Decline
                </Button>
                <Button
                  onClick={() => handleApprove(selectedCreative.id)}
                  disabled={isProcessing}
                  className="bg-green-500 text-white hover:bg-green-600 transition-colors duration-300"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  {isProcessing ? "Processing..." : "Approve"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CreativesPage;

