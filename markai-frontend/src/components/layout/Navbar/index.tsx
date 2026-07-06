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

const NavbarMainSection = () => {
    const router = useRouter();
    const pathname = usePathname();
    const { user, logout } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const [isScrolled, setIsScrolled] = useState(false);
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 20);
        };

        window.addEventListener("scroll", handleScroll);
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

    const getInitials = (name: string) => {
        return name
            .split(" ")
            .map((n) => n[0])
            .join("")
            .toUpperCase()
            .slice(0, 2);
    };

    const navMenuList = [
        { id: 1, title: "Home", href: "/" },
        { id: 2, title: "About", href: "/about" },
        { id: 3, title: "Browse Screens", href: "/browse-screens" },
        { id: 4, title: "Contact", href: "/contact" },
    ];

    return (
        <div
            className={cn(
                "fixed top-0 left-0 z-50 w-full transition-all duration-300 border-b",
                "backdrop-blur-md"
            )}
            style={{
                isolation: 'isolate',
                backgroundColor: isScrolled
                    ? 'var(--bg-card)'
                    : theme === 'dark'
                    ? 'rgba(10, 10, 10, 0.6)'
                    : 'rgba(255, 255, 255, 0.6)',
                borderColor: isScrolled ? 'var(--border-primary)' : 'transparent'
            }}
        >
            <div className="w-full mx-auto flex justify-between items-center px-4 md:px-6 py-2">
                <Link href="/" className="hover:opacity-80 transition-opacity cursor-pointer">
                    <Image
                        src="/mark_ai_logo2-removebg-preview.png"
                        alt="logo"
                        width={120}
                        height={80}
                        className='h-10 md:h-14 object-contain'
                    />
                </Link>

                {/* Desktop Navigation */}
                <div className='hidden md:flex justify-between items-center gap-10'>
                    {navMenuList.map((item) => (
                        <Link
                            key={item.id}
                            href={item.href}
                            className='text-xl font-medium transition-colors duration-200'
                            style={{ color: 'var(--text-primary)' }}
                            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent-blue)'}
                            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                        >
                            {item.title}
                        </Link>
                    ))}
                </div>

                <div className='flex items-center gap-2'>
                    {/* Theme Toggle - Visible on all screens */}
                    <button
                        onClick={toggleTheme}
                        className="flex items-center justify-center p-2 rounded-lg transition-all duration-200"
                        style={{
                            backgroundColor: 'var(--bg-card)',
                            borderColor: 'var(--border-primary)',
                            border: '1px solid'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-accent)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-card)'}
                        aria-label="Toggle theme"
                    >
                        {theme === 'dark' ? <Moon className="w-5 h-5" style={{ color: 'var(--accent-blue)' }} /> : <Sun className="w-5 h-5" style={{ color: 'var(--accent-blue)' }} />}
                    </button>

                    {/* Desktop User Section */}
                    <div className="hidden md:block">
                        {user ? (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors"
                                        style={{ backgroundColor: 'transparent' }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-accent)'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                    >
                                        <Avatar className="w-8 h-8" style={{ borderColor: 'var(--border-primary)', border: '1px solid' }}>
                                            <AvatarFallback className="text-sm font-semibold" style={{ backgroundColor: 'var(--bg-accent)', color: 'var(--text-primary)' }}>
                                                {getInitials(user.name)}
                                            </AvatarFallback>
                                        </Avatar>
                                        <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                                            {user.name.split(" ")[0]}
                                        </span>
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-56" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>
                                    <DropdownMenuItem asChild className="cursor-pointer" style={{ color: 'var(--text-primary)' }}>
                                        <Link href="/dashboard" className="flex items-center gap-2 w-full">
                                            <LayoutDashboard className="w-4 h-4" />
                                            My Dashboard
                                        </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={handleLogout} className="flex items-center gap-2 cursor-pointer" style={{ color: '#ef4444' }}>
                                        <LogOut className="w-4 h-4" />
                                        Logout
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        ) : (
                            <Link
                                href="/auth/login"
                                className="px-4 py-2 rounded-lg font-semibold text-base border-2 hover:scale-110 transition-all duration-200"
                                style={{
                                    backgroundColor: 'var(--text-primary)',
                                    color: 'var(--text-inverse)',
                                    borderColor: 'var(--border-primary)'
                                }}
                            >
                                Login
                            </Link>
                        )}
                    </div>

                    {/* Mobile Menu Sheet */}
                    <Sheet open={isOpen} onOpenChange={setIsOpen}>
                        <SheetTrigger asChild className="md:hidden">
                            <button
                                className="p-2 rounded-lg transition-all duration-200"
                                style={{
                                    backgroundColor: 'var(--bg-card)',
                                    borderColor: 'var(--border-primary)',
                                    border: '1px solid'
                                }}
                                aria-label="Open menu"
                            >
                                <Menu className="w-6 h-6" style={{ color: 'var(--text-primary)' }} />
                            </button>
                        </SheetTrigger>
                        <SheetContent side="right" className="w-[300px] sm:w-[400px]" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}>
                            <SheetHeader>
                                <SheetTitle className="text-left heading-font" style={{ color: 'var(--text-primary)' }}>Menu</SheetTitle>
                            </SheetHeader>
                            <div className="flex flex-col gap-6 mt-8">
                                {/* Navigation Links */}
                                <nav className="flex flex-col gap-2">
                                    {navMenuList.map((item) => (
                                        <Link
                                            key={item.id}
                                            href={item.href}
                                            onClick={() => setIsOpen(false)}
                                            className="px-4 py-3 rounded-lg text-lg font-medium transition-all duration-200"
                                            style={{
                                                backgroundColor: pathname === item.href ? 'var(--bg-accent)' : 'transparent',
                                                color: pathname === item.href ? 'var(--text-primary)' : 'var(--text-secondary)'
                                            }}
                                            onMouseEnter={(e) => {
                                                if (pathname !== item.href) e.currentTarget.style.backgroundColor = 'var(--bg-card)';
                                            }}
                                            onMouseLeave={(e) => {
                                                if (pathname !== item.href) e.currentTarget.style.backgroundColor = 'transparent';
                                            }}
                                        >
                                            {item.title}
                                        </Link>
                                    ))}
                                </nav>

                                <Separator style={{ backgroundColor: 'var(--border-primary)' }} />

                                {/* User Section */}
                                {user ? (
                                    <>
                                        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border transition-all duration-200" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
                                            <Avatar className="w-10 h-10" style={{ borderColor: 'var(--border-primary)', border: '1px solid' }}>
                                                <AvatarFallback className="text-sm font-semibold" style={{ backgroundColor: 'var(--bg-accent)', color: 'var(--text-primary)' }}>
                                                    {getInitials(user.name)}
                                                </AvatarFallback>
                                            </Avatar>
                                            <div>
                                                <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{user.name}</p>
                                                <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>{user.email}</p>
                                            </div>
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <Button
                                                onClick={() => { router.push('/dashboard'); setIsOpen(false); }}
                                                className="w-full justify-start gap-2 transition-all duration-200"
                                                style={{
                                                    backgroundColor: 'var(--text-primary)',
                                                    color: 'var(--text-inverse)'
                                                }}
                                            >
                                                <LayoutDashboard className="w-5 h-5" />
                                                My Dashboard
                                            </Button>
                                            <Button
                                                onClick={handleLogout}
                                                variant="outline"
                                                className="w-full justify-start gap-2 bg-red-500/10 text-red-500 border-red-500/30 hover:bg-red-500/20"
                                            >
                                                <LogOut className="w-5 h-5" />
                                                Logout
                                            </Button>
                                        </div>
                                    </>
                                ) : (
                                    <Button
                                        onClick={() => { router.push('/auth/login'); setIsOpen(false); }}
                                        className="w-full transition-all duration-200"
                                        style={{
                                            backgroundColor: 'var(--text-primary)',
                                            color: 'var(--text-inverse)'
                                        }}
                                    >
                                        Login
                                    </Button>
                                )}
                            </div>
                        </SheetContent>
                    </Sheet>
                </div>
            </div>
        </div>
    )
}

export default NavbarMainSection;