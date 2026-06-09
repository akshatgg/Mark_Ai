"use client";

import { useState, useEffect } from "react";
import { Clock, X, Calendar as CalendarIcon, CheckSquare, Square, ChevronDown, ChevronLeft, ChevronRight, CalendarRange } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type TimeSlot = {
  id: string;
  start: string;
  end: string;
  duration: number;
};

export type DaySlot = {
  date: string;
  dayName: string;
  dateDisplay: string;
  slots: TimeSlot[];
};

const generateTimeSlots = (date: Date): TimeSlot[] => {
  const slots: TimeSlot[] = [];
  
  // Generate hourly slots from 8 AM to 11 PM (8-9, 9-10, 10-11, ..., 23-24)
  for (let hour = 8; hour < 24; hour++) {
    const startHour = hour.toString().padStart(2, "0");
    const endHour = (hour + 1).toString().padStart(2, "0");
    
    slots.push({
      id: `${date.toISOString()}-${hour}`,
      start: `${startHour}:00`,
      end: hour === 23 ? "23:59" : `${endHour}:00`,
      duration: hour === 23 ? 59 : 60,
    });
  }
  
  return slots;
};

// Generate slots for a date range (inclusive)
const generateDateRangeSlots = (startDate: Date, endDate: Date): DaySlot[] => {
  const days: DaySlot[] = [];
  const currentDate = new Date(startDate);
  currentDate.setHours(0, 0, 0, 0);

  const lastDate = new Date(endDate);
  lastDate.setHours(0, 0, 0, 0);

  while (currentDate <= lastDate) {
    const dayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    const dayName = dayNames[currentDate.getDay()];
    const dayNum = currentDate.getDate();
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthName = monthNames[currentDate.getMonth()];

    const slots = generateTimeSlots(new Date(currentDate));

    days.push({
      date: currentDate.toISOString().split("T")[0],
      dayName,
      dateDisplay: `${dayNum} ${monthName}`,
      slots,
    });

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return days;
};

const generateWeekSlots = (startDate: Date = new Date()): DaySlot[] => {
  const days: DaySlot[] = [];
  const today = new Date(startDate);
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);

    const dayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    const dayName = dayNames[date.getDay()];
    const dayNum = date.getDate();
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthName = monthNames[date.getMonth()];

    const slots = generateTimeSlots(date);

    days.push({
      date: date.toISOString().split("T")[0],
      dayName,
      dateDisplay: `${dayNum} ${monthName}`,
      slots,
    });
  }

  return days;
};

interface BookingSlotSelectorProps {
  selectedSlots: Set<string>;
  onSlotToggle: (slotId: string) => void;
  fromDate?: Date | null;
  toDate?: Date | null;
  onDateRangeChange?: (fromDate: Date | null, toDate: Date | null) => void;
  weekSlots?: DaySlot[];
}

export const BookingSlotSelector = ({
  selectedSlots,
  onSlotToggle,
  fromDate: externalFromDate,
  toDate: externalToDate,
  onDateRangeChange,
  weekSlots: initialWeekSlots,
}: BookingSlotSelectorProps) => {
  // DATE RANGE STATE - Primary selection (controlled if external props provided)
  const [internalFromDate, setInternalFromDate] = useState<Date | null>(null);
  const [internalToDate, setInternalToDate] = useState<Date | null>(null);
  const [fromDatePickerOpen, setFromDatePickerOpen] = useState(false);
  const [toDatePickerOpen, setToDatePickerOpen] = useState(false);

  // Use external date values if provided, otherwise use internal state
  const fromDate = externalFromDate !== undefined ? externalFromDate : internalFromDate;
  const toDate = externalToDate !== undefined ? externalToDate : internalToDate;

  // Helper to set date (calls external handler if provided)
  const setFromDate = (date: Date | null) => {
    if (onDateRangeChange) {
      onDateRangeChange(date, toDate);
    } else {
      setInternalFromDate(date);
    }
  };

  const setToDate = (date: Date | null) => {
    if (onDateRangeChange) {
      onDateRangeChange(fromDate, date);
    } else {
      setInternalToDate(date);
    }
  };

  // SLOTS STATE - Generated from date range
  const [startDate, setStartDate] = useState<Date>(new Date());
  const [weekSlots, setWeekSlots] = useState<DaySlot[]>([]);
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [monthSelectorOpen, setMonthSelectorOpen] = useState(false);
  const [weekSelectorOpen, setWeekSelectorOpen] = useState(false);

  // Generate slots when date range is selected
  useEffect(() => {
    if (fromDate && toDate && fromDate <= toDate) {
      const generatedSlots = generateDateRangeSlots(fromDate, toDate);
      setWeekSlots(generatedSlots);
      setStartDate(fromDate);
      // Auto-select first day
      if (generatedSlots.length > 0) {
        setSelectedDay(generatedSlots[0].date);
      }
    } else if (!fromDate && !toDate) {
      // Reset slots when dates are cleared
      setWeekSlots([]);
      setSelectedDay("");
    }
  }, [fromDate, toDate]);

  // Handle from date selection
  const handleFromDateSelect = (date: Date | undefined) => {
    if (date) {
      const newFromDate = new Date(date);
      newFromDate.setHours(0, 0, 0, 0);
      setFromDate(newFromDate);

      // If toDate is before fromDate, reset toDate
      if (toDate && toDate < newFromDate) {
        setToDate(null);
      }

      setFromDatePickerOpen(false);
    }
  };

  // Handle to date selection
  const handleToDateSelect = (date: Date | undefined) => {
    if (date) {
      const newToDate = new Date(date);
      newToDate.setHours(23, 59, 59, 999);
      setToDate(newToDate);
      setToDatePickerOpen(false);
    }
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      setStartDate(date);
      const newWeekSlots = generateWeekSlots(date);
      setWeekSlots(newWeekSlots);
      setSelectedDay(newWeekSlots[0]?.date || "");
      setCalendarOpen(false);
    }
  };

  const currentDaySlots = weekSlots.find((d) => d.date === selectedDay)?.slots || [];

  // Handle selecting the same time slot across all days
  const handleSelectSlotForAllDays = (timeSlot: string) => {
    // timeSlot format: "08:00" (just the start time)
    weekSlots.forEach((day) => {
      const matchingSlot = day.slots.find(slot => slot.start === timeSlot);
      if (matchingSlot && !selectedSlots.has(matchingSlot.id)) {
        onSlotToggle(matchingSlot.id);
      }
    });
  };

  // Handle deselecting the same time slot from all days
  const handleDeselectSlotForAllDays = (timeSlot: string) => {
    // timeSlot format: "08:00" (just the start time)
    weekSlots.forEach((day) => {
      const matchingSlot = day.slots.find(slot => slot.start === timeSlot);
      if (matchingSlot && selectedSlots.has(matchingSlot.id)) {
        onSlotToggle(matchingSlot.id);
      }
    });
  };

  // Check if a time slot is selected across all days
  const isSlotSelectedInAllDays = (timeSlot: string): boolean => {
    return weekSlots.every(day => {
      const matchingSlot = day.slots.find(slot => slot.start === timeSlot);
      return matchingSlot ? selectedSlots.has(matchingSlot.id) : false;
    });
  };

  // Select/Deselect all slots for a specific date (toggle behavior)
  const handleSelectAllForDate = (date: string) => {
    const daySlot = weekSlots.find((d) => d.date === date);
    if (!daySlot) return;

    const allSelected = areAllDateSlotsSelected(date);

    if (allSelected) {
      // Deselect all slots for this date
      daySlot.slots.forEach((slot) => {
        if (selectedSlots.has(slot.id)) {
          onSlotToggle(slot.id);
        }
      });
    } else {
      // Select all slots for this date
      daySlot.slots.forEach((slot) => {
        if (!selectedSlots.has(slot.id)) {
          onSlotToggle(slot.id);
        }
      });
    }
  };

  // Check if all slots for the entire week are selected
  const areAllWeekSlotsSelected = (): boolean => {
    const allSlots = weekSlots.flatMap((day) => day.slots);
    if (allSlots.length === 0) return false;
    return allSlots.every((slot) => selectedSlots.has(slot.id));
  };

  // Select/Deselect all slots for the entire week (toggle behavior)
  const handleSelectAllWeek = () => {
    const allSelected = areAllWeekSlotsSelected();

    if (allSelected) {
      // Deselect all slots for the entire week
      weekSlots.forEach((day) => {
        day.slots.forEach((slot) => {
          if (selectedSlots.has(slot.id)) {
            onSlotToggle(slot.id);
          }
        });
      });
    } else {
      // Select all slots for the entire week
      weekSlots.forEach((day) => {
        day.slots.forEach((slot) => {
          if (!selectedSlots.has(slot.id)) {
            onSlotToggle(slot.id);
          }
        });
      });
    }
  };

  // Check if all slots for a date are selected
  const areAllDateSlotsSelected = (date: string): boolean => {
    const daySlot = weekSlots.find((d) => d.date === date);
    if (!daySlot) return false;
    if (daySlot.slots.length === 0) return false;
    return daySlot.slots.every((slot) => selectedSlots.has(slot.id));
  };

  // Navigate to next/previous week
  const handlePreviousWeek = () => {
    const newDate = new Date(startDate);
    newDate.setDate(newDate.getDate() - 7);
    setStartDate(newDate);
    const newWeekSlots = generateWeekSlots(newDate);
    setWeekSlots(newWeekSlots);
    setSelectedDay(newWeekSlots[0]?.date || "");
  };

  const handleNextWeek = () => {
    const newDate = new Date(startDate);
    newDate.setDate(newDate.getDate() + 7);
    setStartDate(newDate);
    const newWeekSlots = generateWeekSlots(newDate);
    setWeekSlots(newWeekSlots);
    setSelectedDay(newWeekSlots[0]?.date || "");
  };

  // Generate slots for an entire month
  const generateMonthSlots = (year: number, month: number): DaySlot[] => {
    const slots: DaySlot[] = [];
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    for (let date = new Date(firstDay); date <= lastDay; date.setDate(date.getDate() + 1)) {
      const currentDate = new Date(date);
      const dayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
      const dayName = dayNames[currentDate.getDay()];
      const dayNum = currentDate.getDate();
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const monthName = monthNames[currentDate.getMonth()];
      const timeSlots = generateTimeSlots(currentDate);

      slots.push({
        date: currentDate.toISOString().split("T")[0],
        dayName,
        dateDisplay: `${dayNum} ${monthName}`,
        slots: timeSlots,
      });
    }

    return slots;
  };

  // Select all slots for a specific month
  const handleSelectMonth = (year: number, month: number) => {
    // Generate all slots for the selected month
    const monthSlots = generateMonthSlots(year, month);

    // Select all slots in the month
    monthSlots.forEach((day) => {
      day.slots.forEach((slot) => {
        if (!selectedSlots.has(slot.id)) {
          onSlotToggle(slot.id);
        }
      });
    });

    setMonthSelectorOpen(false);
  };

  // Get available months (current month + next 6 months)
  const getAvailableMonths = () => {
    const months = [];
    const today = new Date();

    for (let i = 0; i < 6; i++) {
      const date = new Date(today.getFullYear(), today.getMonth() + i, 1);
      months.push({
        label: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        year: date.getFullYear(),
        month: date.getMonth(),
      });
    }

    return months;
  };

  // Get available weeks (current week + next 8 weeks)
  const getAvailableWeeks = () => {
    const weeks = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 8; i++) {
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() + (i * 7));

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);

      weeks.push({
        label: `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
        startDate: new Date(weekStart),
      });
    }

    return weeks;
  };

  // Select all slots for a specific week
  const handleSelectWeek = (weekStartDate: Date) => {
    // Generate all slots for the selected week
    const weekSlotsToSelect = generateWeekSlots(weekStartDate);

    // Select all slots in the week
    weekSlotsToSelect.forEach((day) => {
      day.slots.forEach((slot) => {
        if (!selectedSlots.has(slot.id)) {
          onSlotToggle(slot.id);
        }
      });
    });

    // Navigate to the selected week
    setStartDate(weekStartDate);
    setWeekSlots(weekSlotsToSelect);
    setSelectedDay(weekSlotsToSelect[0]?.date || "");
    setWeekSelectorOpen(false);
  };

  // Clear all selected slots
  const handleClearAll = () => {
    Array.from(selectedSlots).forEach((slotId) => {
      onSlotToggle(slotId);
    });
  };

  // Group selected slots by contiguous date ranges for compact display
  const getGroupedSelectedSlots = () => {
    if (selectedSlots.size === 0) return [];

    // Parse all selected slots into structured data
    const parsedSlots = Array.from(selectedSlots).map((slotId) => {
      const isoDateMatch = slotId.match(/^(.+T\d{2}:\d{2}:\d{2}\.\d{3}Z)-(\d+)$/);
      if (!isoDateMatch) return null;

      const isoDateStr = isoDateMatch[1];
      const hour = parseInt(isoDateMatch[2]);
      const date = new Date(isoDateStr);

      return {
        slotId,
        date: date,
        dateStr: date.toISOString().split('T')[0],
        hour,
        timestamp: date.getTime() + (hour * 60 * 60 * 1000),
      };
    }).filter(Boolean) as Array<{ slotId: string; date: Date; dateStr: string; hour: number; timestamp: number }>;

    // Sort by date and hour
    parsedSlots.sort((a, b) => a.timestamp - b.timestamp);

    // Group into contiguous date ranges
    const ranges: Array<{
      startDate: Date;
      endDate: Date;
      startDateDisplay: string;
      endDateDisplay: string;
      slotCount: number;
      slotIds: string[];
      isSameDay: boolean;
    }> = [];

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const formatDateDisplay = (date: Date) => {
      return `${date.getDate()} ${monthNames[date.getMonth()]} ${date.getFullYear()}`;
    };

    let currentRange = {
      startDate: parsedSlots[0].date,
      endDate: parsedSlots[0].date,
      slotIds: [parsedSlots[0].slotId],
      lastDateStr: parsedSlots[0].dateStr,
    };

    for (let i = 1; i < parsedSlots.length; i++) {
      const currentSlot = parsedSlots[i];
      const prevSlot = parsedSlots[i - 1];

      // Check if this date is the same or next day after the previous
      const currentDate = new Date(currentSlot.dateStr);
      const prevDate = new Date(prevSlot.dateStr);
      const daysDiff = Math.floor((currentDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));

      // If same date or consecutive day, extend current range
      if (daysDiff <= 1) {
        currentRange.endDate = currentSlot.date;
        currentRange.slotIds.push(currentSlot.slotId);
        currentRange.lastDateStr = currentSlot.dateStr;
      } else {
        // Gap detected - save current range and start new one
        ranges.push({
          startDate: currentRange.startDate,
          endDate: currentRange.endDate,
          startDateDisplay: formatDateDisplay(currentRange.startDate),
          endDateDisplay: formatDateDisplay(currentRange.endDate),
          slotCount: currentRange.slotIds.length,
          slotIds: currentRange.slotIds,
          isSameDay: currentRange.startDate.toDateString() === currentRange.endDate.toDateString(),
        });

        // Start new range
        currentRange = {
          startDate: currentSlot.date,
          endDate: currentSlot.date,
          slotIds: [currentSlot.slotId],
          lastDateStr: currentSlot.dateStr,
        };
      }
    }

    // Push the last range
    ranges.push({
      startDate: currentRange.startDate,
      endDate: currentRange.endDate,
      startDateDisplay: formatDateDisplay(currentRange.startDate),
      endDateDisplay: formatDateDisplay(currentRange.endDate),
      slotCount: currentRange.slotIds.length,
      slotIds: currentRange.slotIds,
      isSameDay: currentRange.startDate.toDateString() === currentRange.endDate.toDateString(),
    });

    return ranges;
  };

  // Clear all slots for a specific date
  const handleClearDate = (slotIds: string[]) => {
    slotIds.forEach((slotId) => {
      onSlotToggle(slotId);
    });
  };

  // Format date for display
  const formatDateDisplay = (date: Date | null): string => {
    if (!date) return "Select Date";
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${date.getDate()} ${monthNames[date.getMonth()]} ${date.getFullYear()}`;
  };

  return (
    <div className="backdrop-blur-lg rounded-2xl p-6 transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border-primary)' }}>
      {/* DATE RANGE SELECTOR - STEP 1 */}
      <div className="mb-4 p-4 rounded-xl border-2 border-dashed transition-colors duration-300" style={{ borderColor: fromDate && toDate ? 'var(--border-primary)' : '#a78bfa', backgroundColor: fromDate && toDate ? 'var(--bg-card)' : 'rgba(167, 139, 250, 0.1)' }}>
        <div className="flex items-center gap-2 mb-3">
          <CalendarRange className="w-5 h-5 text-purple-400" />
          <h3 className="text-lg font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
            Step 1: Select Date Range
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* FROM DATE */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
              From Date
            </label>
            <Popover open={fromDatePickerOpen} onOpenChange={setFromDatePickerOpen}>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "w-full flex items-center justify-between px-4 py-3 rounded-lg border-2 transition-all duration-300",
                    fromDate
                      ? "border-purple-500 bg-purple-500/10"
                      : "border-dashed hover:border-purple-400"
                  )}
                  style={!fromDate ? { borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-card)', color: 'var(--text-tertiary)' } : {}}
                >
                  <div className="flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4" />
                    <span className={cn("font-medium", fromDate ? "text-purple-300" : "")} style={!fromDate ? { color: 'var(--text-tertiary)' } : {}}>
                      {formatDateDisplay(fromDate)}
                    </span>
                  </div>
                  {fromDate && (
                    <X
                      className="w-4 h-4 text-red-400 hover:text-red-300"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFromDate(null);
                        setToDate(null);
                      }}
                    />
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 transition-colors duration-300" style={{ backgroundColor: 'var(--bg-primary)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border-primary)' }} align="start">
                <Calendar
                  mode="single"
                  selected={fromDate || undefined}
                  onSelect={handleFromDateSelect}
                  disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                  className="transition-colors duration-300"
                  style={{ color: 'var(--text-primary)' }}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* TO DATE */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
              To Date
            </label>
            <Popover open={toDatePickerOpen} onOpenChange={setToDatePickerOpen}>
              <PopoverTrigger asChild>
                <button
                  disabled={!fromDate}
                  className={cn(
                    "w-full flex items-center justify-between px-4 py-3 rounded-lg border-2 transition-all duration-300",
                    toDate
                      ? "border-purple-500 bg-purple-500/10"
                      : "border-dashed hover:border-purple-400",
                    !fromDate && "opacity-50 cursor-not-allowed"
                  )}
                  style={!toDate ? { borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-card)', color: 'var(--text-tertiary)' } : {}}
                >
                  <div className="flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4" />
                    <span className={cn("font-medium", toDate ? "text-purple-300" : "")} style={!toDate ? { color: 'var(--text-tertiary)' } : {}}>
                      {formatDateDisplay(toDate)}
                    </span>
                  </div>
                  {toDate && (
                    <X
                      className="w-4 h-4 text-red-400 hover:text-red-300"
                      onClick={(e) => {
                        e.stopPropagation();
                        setToDate(null);
                      }}
                    />
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 transition-colors duration-300" style={{ backgroundColor: 'var(--bg-primary)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border-primary)' }} align="start">
                <Calendar
                  mode="single"
                  selected={toDate || undefined}
                  onSelect={handleToDateSelect}
                  disabled={(date) => {
                    const minDate = fromDate || new Date(new Date().setHours(0, 0, 0, 0));
                    return date < minDate;
                  }}
                  className="transition-colors duration-300"
                  style={{ color: 'var(--text-primary)' }}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Date Range Summary */}
        {fromDate && toDate && (
          <div className="mt-3 p-2.5 bg-purple-500/10 border border-purple-500/30 rounded-lg">
            <p className="text-sm text-purple-300">
              Selected Range: <span className="font-semibold">{formatDateDisplay(fromDate)}</span> → <span className="font-semibold">{formatDateDisplay(toDate)}</span>
              <span className="ml-2 text-xs opacity-75">
                ({Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1} days)
              </span>
            </p>
          </div>
        )}

        {/* Empty state message */}
        {!fromDate && !toDate && (
          <p className="mt-2.5 text-sm text-center transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
            Please select your campaign start and end dates to view available time slots
          </p>
        )}
      </div>

      {/* TIME SLOTS SECTION - STEP 2 (Only show when date range is selected) */}
      {fromDate && toDate && weekSlots.length > 0 ? (
        <>
          <div className="flex items-center gap-2 mb-3 mt-4">
            <Clock className="w-5 h-5 text-purple-400" />
            <h3 className="text-lg font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
              Step 2: Select Time Slots
            </h3>
          </div>

          {/* Day Navigation */}
      <div className="mb-4">
        <div className="flex gap-2 overflow-x-auto pb-2">
          {weekSlots.map((day) => {
          const allSelected = areAllDateSlotsSelected(day.date);
          // Check if any slots are selected for this date
          const hasSelectedSlots = day.slots.some((slot) => selectedSlots.has(slot.id));
          return (
            <div key={day.date} className="relative">
              <button
                onClick={() => setSelectedDay(day.date)}
                className={`px-4 py-3 rounded-lg font-medium whitespace-nowrap transition-all flex flex-col items-center relative ${
                  selectedDay === day.date
                    ? "bg-purple-500"
                    : allSelected
                    ? "bg-purple-500 border-2 border-purple-400"
                    : hasSelectedSlots
                    ? "border-2 border-purple-400"
                    : ""
                }`}
                style={
                  selectedDay === day.date || allSelected
                    ? { color: 'var(--text-primary)' }
                    : hasSelectedSlots
                    ? { backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: '#a78bfa' }
                    : { backgroundColor: 'var(--bg-card)', color: 'var(--text-secondary)' }
                }
              >
                <span className="text-xs font-semibold">{day.dayName}</span>
                <span className="text-sm">{day.dateDisplay}</span>
                {/* Indicator dot when slots are selected */}
                {hasSelectedSlots && !allSelected && (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-purple-400 rounded-full"></span>
                )}
                {/* "All selected" indicator */}
                {allSelected && (
                  <span className="absolute -top-1 -right-1 bg-purple-600 text-white text-[8px] px-1 rounded-full font-bold">ALL</span>
                )}
              </button>
            </div>
          );
        })}
        </div>
      </div>

      {/* Time Slots */}
      <div className="space-y-3">
        {currentDaySlots.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
            {currentDaySlots.map((slot) => {
              const isSelected = selectedSlots.has(slot.id);
              // Check if this time slot exists across all days
              const slotExistsInAllDays = weekSlots.every(day =>
                day.slots.some(s => s.start === slot.start)
              );
              // Check if this time slot is selected in all days
              const isSelectedInAllDays = slotExistsInAllDays && isSlotSelectedInAllDays(slot.start);

              return (
                <div key={slot.id} className="relative group">
                  <button
                    onClick={() => onSlotToggle(slot.id)}
                    className={`w-full p-3 rounded-xl border-2 transition-all duration-300 text-left relative cursor-pointer ${
                      isSelected
                        ? "border-purple-500 bg-purple-500/20"
                        : ""
                    }`}
                    style={!isSelected ? { borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-card)' } : {}}
                  >
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
                      <span className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                        {slot.start} - {slot.end}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>{slot.duration} min</span>
                      {/* Badge showing if applied to all days */}
                      {isSelectedInAllDays && (
                        <span className="text-[9px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded-full font-semibold border border-blue-500/30">
                          ALL
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Apply/Unapply to all days button - only show if slot exists in all days and there's more than 1 day */}
                  {slotExistsInAllDays && weekSlots.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isSelectedInAllDays) {
                          handleDeselectSlotForAllDays(slot.start);
                        } else {
                          handleSelectSlotForAllDays(slot.start);
                        }
                      }}
                      className={`absolute -bottom-2 left-1/2 -translate-x-1/2 px-2 py-1 rounded-full text-[10px] font-semibold text-white opacity-0 group-hover:opacity-100 transition-all whitespace-nowrap shadow-lg ${
                        isSelectedInAllDays
                          ? 'bg-red-500 hover:bg-red-600'
                          : 'bg-blue-500 hover:bg-blue-600'
                      }`}
                      title={isSelectedInAllDays
                        ? `Remove ${slot.start} - ${slot.end} from all ${weekSlots.length} days`
                        : `Select ${slot.start} - ${slot.end} for all ${weekSlots.length} days`
                      }
                    >
                      {isSelectedInAllDays ? 'Unapply from All Days' : 'Apply to All Days'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-center py-8 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>No slots available for this day</p>
        )}
      </div>

      {/* Selected Slots Summary */}
      {selectedSlots.size > 0 && (
        <div className="mt-4 p-3 bg-purple-500/10 border border-purple-500/30 rounded-xl transition-colors duration-300">
          <div className="mb-2.5">
            <p className="text-sm font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
              {selectedSlots.size} slot{selectedSlots.size > 1 ? "s" : ""} selected
            </p>
          </div>
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {getGroupedSelectedSlots().map((range, index) => (
              <div
                key={`range-${index}`}
                className="p-2.5 bg-purple-500/20 border border-purple-500/30 rounded-lg transition-colors duration-300"
              >
                <p className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                  {range.isSameDay ? (
                    range.startDateDisplay
                  ) : (
                    <>
                      {range.startDateDisplay} <span className="text-purple-400">→</span> {range.endDateDisplay}
                    </>
                  )}
                </p>
                <p className="text-xs transition-colors duration-300 mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                  {range.slotCount} slot{range.slotCount > 1 ? "s" : ""} selected
                  {!range.isSameDay && ` across ${Math.ceil((range.endDate.getTime() - range.startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1} days`}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
        </>
      ) : null}
    </div>
  );
};

