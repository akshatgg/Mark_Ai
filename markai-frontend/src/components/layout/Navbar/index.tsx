"use client";
import React, { useState, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Menu, LogOut, LayoutDashboard, Sun, Moon } from "lucide-react";
import toast from "react-hot-toast";

const navMenuList = [
    { id: 1, title: "Home", href: "/" },
    { id: 2, title: "About", href: "/about" },
    { id: 3, title: "Browse Screens", href: "/browse-screens" },
    { id: 4, title: "Contact", href: "/contact" },
];

const NavbarMainSection = () => {
    const router = useRouter();
    const pathname = usePathname();
    const { user, logout } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const [isScrolled, setIsScrolled] = useState(false);
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        const handleScroll = () => setIsScrolled(window.scrollY > 20);
        handleScroll();
        window.addEventListener("scroll", handleScroll, { passive: true });
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    // Hide navbar on dashboard routes
    if (pathname?.startsWith('/dashboard')) {
        return null;
    }

    const handleLogout = () => {
        logout();
        toast.success("Logged out successfully");
        setIsOpen(false);
        router.push("/");
    };

    const getInitials = (name: string) =>
        name
            .split(" ")
            .map((n) => n[0])
            .join("")
            .toUpperCase()
            .slice(0, 2);

    const isActive = (href: string) =>
        href === "/" ? pathname === "/" : pathname?.startsWith(href);

    return (
        <header className="fixed inset-x-0 top-0 z-50 flex justify-center px-3 sm:px-5 pointer-events-none">
            <nav
                className={cn(
                    "pointer-events-auto flex w-full max-w-6xl items-center justify-between gap-3 rounded-full pl-3 pr-2 sm:pl-5 sm:pr-3",
                    "glass-panel transition-all duration-300 ease-out",
                    isScrolled ? "mt-2 py-1.5 max-w-5xl" : "mt-4 py-2"
                )}
                style={{ isolation: "isolate" }}
            >
                {/* Brand */}
                <Link
                    href="/"
                    className="flex shrink-0 items-center gap-2 rounded-full pr-2 transition-opacity hover:opacity-90"
                    aria-label="Mark AI home"
                >
                    <Image
                        src="/mark_ai_logo2-removebg-preview.png"
                        alt="Mark AI"
                        width={44}
                        height={44}
                        priority
                        className="h-9 w-9 object-contain md:h-10 md:w-10"
                    />
                    <span className="hidden text-lg font-extrabold uppercase tracking-tight brand-gradient-text sm:inline-block md:text-xl">
                        Mark&nbsp;AI
                    </span>
                </Link>

                {/* Desktop links (centered) */}
                <div className="hidden flex-1 items-center justify-center gap-1 md:flex">
                    {navMenuList.map((item) => {
                        const active = isActive(item.href);
                        return (
                            <Link
                                key={item.id}
                                href={item.href}
                                className={cn(
                                    "rounded-full px-4 py-2 text-sm font-semibold transition-all duration-200",
                                    active ? "brand-gradient-text" : "hover:bg-[var(--bg-accent)]"
                                )}
                                style={{ color: active ? undefined : "var(--text-secondary)" }}
                            >
                                {item.title}
                            </Link>
                        );
                    })}
                </div>

                {/* Right cluster */}
                <div className="flex shrink-0 items-center gap-2">
                    {/* Theme toggle */}
                    <button
                        onClick={toggleTheme}
                        className="flex h-9 w-9 items-center justify-center rounded-full border transition-all duration-200 hover:scale-105"
                        style={{
                            backgroundColor: "var(--bg-card)",
                            borderColor: "var(--border-primary)",
                            color: "var(--brand-blue)",
                        }}
                        aria-label="Toggle theme"
                    >
                        {theme === "dark" ? <Moon className="h-[18px] w-[18px]" /> : <Sun className="h-[18px] w-[18px]" />}
                    </button>

                    {/* Desktop auth */}
                    <div className="hidden items-center gap-2 md:flex">
                        {user ? (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        className="flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 transition-colors"
                                        style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-primary)" }}
                                    >
                                        <Avatar className="h-7 w-7">
                                            <AvatarFallback className="brand-gradient-bg text-xs font-bold">
                                                {getInitials(user.name)}
                                            </AvatarFallback>
                                        </Avatar>
                                        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                                            {user.name.split(" ")[0]}
                                        </span>
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                    align="end"
                                    className="w-56 rounded-2xl"
                                    style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-primary)", color: "var(--text-primary)" }}
                                >
                                    <DropdownMenuItem asChild className="cursor-pointer rounded-lg" style={{ color: "var(--text-primary)" }}>
                                        <Link href="/dashboard" className="flex w-full items-center gap-2">
                                            <LayoutDashboard className="h-4 w-4" />
                                            My Dashboard
                                        </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={handleLogout} className="flex cursor-pointer items-center gap-2 rounded-lg" style={{ color: "#ef4444" }}>
                                        <LogOut className="h-4 w-4" />
                                        Logout
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        ) : (
                            <>
                                <Link
                                    href="/auth/login"
                                    className="rounded-full border px-5 py-2 text-sm font-semibold transition-all duration-200 hover:bg-[var(--bg-accent)]"
                                    style={{ borderColor: "var(--border-primary)", color: "var(--text-primary)" }}
                                >
                                    Login
                                </Link>
                                <Link
                                    href="/auth/signup"
                                    className="brand-gradient-bg rounded-full px-5 py-2 text-sm font-semibold shadow-md transition-all duration-200 hover:scale-105 hover:shadow-lg"
                                >
                                    Sign up
                                </Link>
                            </>
                        )}
                    </div>

                    {/* Mobile menu */}
                    <Sheet open={isOpen} onOpenChange={setIsOpen}>
                        <SheetTrigger asChild className="md:hidden">
                            <button
                                className="flex h-9 w-9 items-center justify-center rounded-full border transition-all duration-200"
                                style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-primary)" }}
                                aria-label="Open menu"
                            >
                                <Menu className="h-5 w-5" style={{ color: "var(--text-primary)" }} />
                            </button>
                        </SheetTrigger>
                        <SheetContent
                            side="right"
                            className="w-[300px] sm:w-[380px]"
                            style={{ backgroundColor: "var(--bg-primary)", borderColor: "var(--border-primary)" }}
                        >
                            <SheetHeader>
                                <SheetTitle className="flex items-center gap-2 text-left">
                                    <Image src="/mark_ai_logo2-removebg-preview.png" alt="Mark AI" width={32} height={32} className="h-8 w-8 object-contain" />
                                    <span className="text-lg font-extrabold uppercase tracking-tight brand-gradient-text">Mark&nbsp;AI</span>
                                </SheetTitle>
                            </SheetHeader>
                            <div className="mt-8 flex flex-col gap-6 px-1">
                                <nav className="flex flex-col gap-1">
                                    {navMenuList.map((item) => {
                                        const active = isActive(item.href);
                                        return (
                                            <Link
                                                key={item.id}
                                                href={item.href}
                                                onClick={() => setIsOpen(false)}
                                                className="rounded-xl px-4 py-3 text-base font-semibold transition-all duration-200"
                                                style={{
                                                    backgroundColor: active ? "var(--bg-accent)" : "transparent",
                                                    color: active ? "var(--brand-blue)" : "var(--text-secondary)",
                                                }}
                                            >
                                                {item.title}
                                            </Link>
                                        );
                                    })}
                                </nav>

                                <Separator style={{ backgroundColor: "var(--border-primary)" }} />

                                {user ? (
                                    <>
                                        <div
                                            className="flex items-center gap-3 rounded-2xl border px-4 py-3"
                                            style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-primary)" }}
                                        >
                                            <Avatar className="h-10 w-10">
                                                <AvatarFallback className="brand-gradient-bg text-sm font-bold">{getInitials(user.name)}</AvatarFallback>
                                            </Avatar>
                                            <div className="min-w-0">
                                                <p className="truncate font-semibold" style={{ color: "var(--text-primary)" }}>{user.name}</p>
                                                <p className="truncate text-sm" style={{ color: "var(--text-tertiary)" }}>{user.email}</p>
                                            </div>
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <Button
                                                onClick={() => { router.push("/dashboard"); setIsOpen(false); }}
                                                className="brand-gradient-bg w-full justify-start gap-2 rounded-xl"
                                            >
                                                <LayoutDashboard className="h-5 w-5" />
                                                My Dashboard
                                            </Button>
                                            <Button
                                                onClick={handleLogout}
                                                variant="outline"
                                                className="w-full justify-start gap-2 rounded-xl border-red-500/30 bg-red-500/10 text-red-500 hover:bg-red-500/20"
                                            >
                                                <LogOut className="h-5 w-5" />
                                                Logout
                                            </Button>
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex flex-col gap-2">
                                        <Button
                                            onClick={() => { router.push("/auth/login"); setIsOpen(false); }}
                                            variant="outline"
                                            className="w-full rounded-xl"
                                            style={{ borderColor: "var(--border-primary)", color: "var(--text-primary)" }}
                                        >
                                            Login
                                        </Button>
                                        <Button
                                            onClick={() => { router.push("/auth/signup"); setIsOpen(false); }}
                                            className="brand-gradient-bg w-full rounded-xl"
                                        >
                                            Sign up
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </SheetContent>
                    </Sheet>
                </div>
            </nav>
        </header>
    );
};

export default NavbarMainSection;
