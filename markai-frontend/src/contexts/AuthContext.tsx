'use client';
import React, { createContext, useContext, useState, useEffect } from 'react';
import Cookies from 'js-cookie';
import { LoginResponse, RegisterResponse } from '@/services/authService';

interface User {
  _id: string;
  name: string;
  email: string;
  section: string;
}

interface AuthContextType {
  user: User | null;
  fullUserData: LoginResponse['user'] | null;
  token: string | null;
  login: (response: LoginResponse | RegisterResponse) => void;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [fullUserData, setFullUserData] = useState<LoginResponse['user'] | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for existing session on mount
    const savedUser = Cookies.get('user');
    const savedFullUserData = Cookies.get('fullUserData');
    const savedToken = Cookies.get('token');

    if (savedUser && savedToken) {
      try {
        setUser(JSON.parse(savedUser));
        setToken(savedToken);
        if (savedFullUserData) {
          setFullUserData(JSON.parse(savedFullUserData));
        }
      } catch (error) {
        console.error('Error parsing saved user data:', error);
        Cookies.remove('user');
        Cookies.remove('fullUserData');
        Cookies.remove('token');
      }
    }
    setIsLoading(false);
  }, []);

  const login = (response: LoginResponse | RegisterResponse) => {
    // Determine section based on boolean flags
    let section = 'advertiser';
    if (response.user.is_admin) {
      section = 'admin';
    } else if (response.user.is_screen_owner) {
      section = 'screen_owner';
    } else if (response.user.is_advertiser) {
      section = 'advertiser';
    } else if (response.user.user_type) {
      // Fallback to user_type if boolean flags are not present
      section = response.user.user_type;
    }
    
    const userData: User = {
      _id: response.user._id,
      name: response.user.full_name,
      email: response.user.email,
      section: section,
    };
    
    setUser(userData);
    setFullUserData(response.user);
    setToken(response.token);
    
    // Save to cookies
    Cookies.set('user', JSON.stringify(userData), { expires: 7 });
    Cookies.set('fullUserData', JSON.stringify(response.user), { expires: 7 });
    Cookies.set('token', response.token, { expires: 7 });
  };

  const logout = () => {
    setUser(null);
    setFullUserData(null);
    setToken(null);
    // Clear all auth-related cookies
    Cookies.remove('user');
    Cookies.remove('fullUserData');
    Cookies.remove('token');
  };

  return (
    <AuthContext.Provider value={{ user, fullUserData, token, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};