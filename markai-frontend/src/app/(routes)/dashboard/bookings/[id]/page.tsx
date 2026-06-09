"use client";
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  Clock,
  IndianRupee,
  Image as ImageIcon,
  ExternalLink,
  Monitor,
  Loader2,
  Download,
  Play,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getBookings,
  groupBookingsByGroupId,
  getBookingStatusInfo,
  type Booking,
  type GroupedBooking,
} from "@/services/bookingService";
import { useAuth } from "@/contexts/AuthContext";
import { generateInvoice } from "@/utils/invoiceGenerator";
import toast from "react-hot-toast";

const formatDate = (dateStr: string) => {
  if (!dateStr) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
};

const formatTime = (dateStr: string) => {
  if (!dateStr) return "";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(dateStr));
  } catch {
    return "";
  }
};

const formatCurrency = (amount: number, currency: string = "INR") => {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
};

interface SlotDisplay {
  date: string;
  start: string;
  end: string;
}

const collectSlotsForBooking = (booking: Booking): SlotDisplay[] => {
  if (!booking.time_slots || booking.time_slots.length === 0) return [];
  return booking.time_slots
    .map((slot) => ({
      date: formatDate(slot.start),
      start: formatTime(slot.start),
      end: formatTime(slot.end),
    }))
    .slice(0, 24);
};

const BookingDetailPage = () => {
  const params = useParams();
  const router = useRouter();
  const { fullUserData } = useAuth();

  const isAdmin = fullUserData?.is_admin === true;
  const isScreenOwner = fullUserData?.is_screen_owner === true;

  const idParam = useMemo(() => {
    if (!params || typeof params.id === "undefined") return null;
    return Array.isArray(params.id) ? params.id[0] : params.id;
  }, [params]);

  const [grouped, setGrouped] = useState<GroupedBooking | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!idParam) return;
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await getBookings(200, 0);
        const groups = groupBookingsByGroupId(res.bookings || []);
        const match = groups.find(
          (g) =>
            g.booking_group_id === idParam ||
            g.bookings.some((b) => b._id === idParam)
        );
        if (!match) {
          setNotFound(true);
        } else {
          setGrouped(match);
        }
      } catch (err) {
        console.error("Failed to load booking:", err);
        toast.error("Failed to load booking");
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [idParam]);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2
          className="w-8 h-8 animate-spin"
          style={{ color: "var(--brand-blue)" }}
        />
      </div>
    );
  }

  if (notFound || !grouped) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-20">
        <AlertCircle
          className="w-12 h-12 mb-3"
          style={{ color: "var(--color-text-faint)" }}
        />
        <h2 className="text-xl font-semibold text-base">Booking not found</h2>
        <p className="mt-1 text-sm text-subtle">
          It may have been removed or you don&apos;t have access to it.
        </p>
        <Link href="/dashboard/bookings" className="mt-6">
          <Button
            className="rounded-full text-white"
            style={{
              background: "var(--brand-gradient)",
              boxShadow: "0 12px 30px -10px var(--brand-glow-blue)",
            }}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to bookings
          </Button>
        </Link>
      </div>
    );
  }

  const primary = grouped.bookings[0];
  const statusInfo = getBookingStatusInfo(primary);
  const shortId = (grouped.booking_group_id || primary._id).slice(-8);
  const screenLabel = grouped.is_multi_screen
    ? `Multi-Screen Booking (${grouped.bookings.length} screens)`
    : primary.screen_name;
  const paid = grouped.payment_status === "paid";

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/dashboard/bookings"
        className="inline-flex items-center gap-2 rounded-full border border-base bg-elev px-4 py-1.5 text-sm font-medium text-subtle transition hover:bg-surface"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to bookings
      </Link>

      {/* Hero — clean editorial header (no icon tile) */}
      <header className="pb-6" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-faint">
              Booking · <span className="font-mono">#{shortId}</span>
            </p>
            <h1 className="mt-2 text-3xl md:text-4xl font-bold tracking-tight text-base truncate">
              {screenLabel}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge className={statusInfo.color}>{statusInfo.label}</Badge>
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold"
                style={{
                  color: paid
                    ? "var(--status-approved-text)"
                    : "var(--status-pending-text)",
                  backgroundColor: paid
                    ? "var(--status-approved-bg)"
                    : "var(--status-pending-bg)",
                }}
              >
                {paid ? "Paid" : grouped.payment_status}
              </span>
              <span className="text-xs text-subtle inline-flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                {formatDate(primary.start_date)} → {formatDate(primary.end_date)}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {paid && (isAdmin || !isScreenOwner) && (
              <Button
                onClick={async () => {
                  try {
                    await generateInvoice(primary);
                    toast.success("Invoice downloaded");
                  } catch (e) {
                    console.error(e);
                    toast.error("Failed to generate invoice");
                  }
                }}
                className="rounded-full text-white"
                style={{
                  background: "var(--brand-gradient)",
                  boxShadow: "0 12px 30px -10px var(--brand-glow-blue)",
                }}
              >
                <Download className="w-4 h-4 mr-2" />
                Invoice
              </Button>
            )}
            {primary.media_url && (
              <a
                href={primary.media_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button
                  variant="outline"
                  className="rounded-full border-base"
                >
                  <Play className="w-4 h-4 mr-2" />
                  View creative
                </Button>
              </a>
            )}
          </div>
        </div>
      </header>

      {/* Summary grid — clean editorial stats with a thin top accent */}
      <div className="grid gap-4 md:grid-cols-3">
        <StatCell
          label="Campaign window"
          value={`${formatDate(primary.start_date)} → ${formatDate(primary.end_date)}`}
        />
        {(isAdmin || !isScreenOwner) && (
          <StatCell
            label="Total amount"
            value={formatCurrency(grouped.total_amount, primary.currency)}
          />
        )}
        <StatCell
          label="Total slots"
          value={String(
            grouped.bookings.reduce(
              (acc, b) => acc + (b.time_slots?.length || 0),
              0
            )
          )}
        />
      </div>

      {/* Creative */}
      {primary.media_url && (
        <Card className="card-surface">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-subtle">
              Creative
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <ImageIcon
                className="w-4 h-4 shrink-0"
                style={{ color: "var(--color-text-faint)" }}
              />
              <p className="text-sm font-semibold text-base truncate">
                Uploaded media
              </p>
            </div>
            <a
              href={primary.media_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold inline-flex items-center gap-1 shrink-0"
              style={{ color: "var(--brand-blue)" }}
            >
              Open
              <ExternalLink className="w-3 h-3" />
            </a>
          </CardContent>
        </Card>
      )}

      {/* Screens & slots */}
      <Card className="card-surface">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-subtle">
            Screens &amp; time slots
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {grouped.bookings.map((b, i) => {
            const slots = collectSlotsForBooking(b);
            return (
              <div
                key={b._id || i}
                className="rounded-xl"
                style={{
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-surface)',
                }}
              >
                <div className="flex items-center justify-between flex-wrap gap-2 p-4">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-faint">
                      Screen
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-base truncate">
                      {b.screen_name || "Screen"}
                    </p>
                    <p className="mt-0.5 text-xs text-subtle">
                      {formatDate(b.start_date)} → {formatDate(b.end_date)}
                    </p>
                  </div>
                  <span
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                    style={{
                      color: 'var(--color-text-subtle)',
                      backgroundColor: 'var(--color-surface-elev)',
                    }}
                  >
                    {slots.length} slot{slots.length === 1 ? "" : "s"}
                  </span>
                </div>

                {slots.length > 0 && (
                  <div
                    className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-px p-px"
                    style={{ backgroundColor: 'var(--color-border)' }}
                  >
                    {slots.map((s, idx) => (
                      <div
                        key={idx}
                        className="px-4 py-3"
                        style={{ backgroundColor: 'var(--color-surface)' }}
                      >
                        <p className="text-[11px] text-faint">{s.date}</p>
                        <p className="mt-0.5 text-xs font-semibold text-base">
                          {s.start} – {s.end}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
};

const StatCell = ({ label, value }: { label: string; value: string }) => (
  <div className="card-surface p-5 relative overflow-hidden">
    <span
      aria-hidden
      className="absolute inset-x-0 top-0 h-px"
      style={{ background: "var(--brand-gradient)" }}
    />
    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-subtle">
      {label}
    </p>
    <p className="mt-3 text-2xl font-bold tracking-tight text-base">{value}</p>
  </div>
);

export default BookingDetailPage;
