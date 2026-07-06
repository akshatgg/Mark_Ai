"use client";
import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, TrendingUp, Eye, MousePointerClick } from "lucide-react";

const AnalyticsPage = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Analytics</h1>
        <p className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
          Track your campaign performance and insights
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
              Total Impressions
            </CardTitle>
            <Eye className="h-4 w-4 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>1.2M</div>
            <p className="text-xs text-green-400 mt-1">+28.4% from last month</p>
          </CardContent>
        </Card>

        <Card className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
              Click-Through Rate
            </CardTitle>
            <MousePointerClick className="h-4 w-4 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>3.2%</div>
            <p className="text-xs text-green-400 mt-1">+0.5% from last month</p>
          </CardContent>
        </Card>

        <Card className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
              Active Campaigns
            </CardTitle>
            <BarChart3 className="h-4 w-4 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>23</div>
            <p className="text-xs text-green-400 mt-1">+5 new campaigns</p>
          </CardContent>
        </Card>

        <Card className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
              Revenue
            </CardTitle>
            <TrendingUp className="h-4 w-4 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>₹45,678</div>
            <p className="text-xs text-green-400 mt-1">+12.3% from last month</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
          <CardHeader>
            <CardTitle className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Campaign Performance</CardTitle>
            <CardDescription className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
              Top performing campaigns this month
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg transition-colors duration-300" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                <div>
                  <p className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Summer Sale Campaign</p>
                  <p className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>156 screens</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>125K views</p>
                  <p className="text-xs text-green-400">+15%</p>
                </div>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg transition-colors duration-300" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                <div>
                  <p className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Product Launch</p>
                  <p className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>89 screens</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>98K views</p>
                  <p className="text-xs text-green-400">+22%</p>
                </div>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg transition-colors duration-300" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                <div>
                  <p className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Brand Awareness</p>
                  <p className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>67 screens</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>76K views</p>
                  <p className="text-xs text-green-400">+8%</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
          <CardHeader>
            <CardTitle className="transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Geographic Distribution</CardTitle>
            <CardDescription className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
              Impressions by location
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>Mumbai</span>
                <div className="flex items-center gap-2">
                  <div className="w-32 h-2 rounded-full overflow-hidden transition-colors duration-300" style={{ backgroundColor: 'rgba(255, 255, 255, 0.1)' }}>
                    <div className="h-full bg-purple-500 rounded-full" style={{ width: "75%" }}></div>
                  </div>
                  <span className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>45%</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>Delhi</span>
                <div className="flex items-center gap-2">
                  <div className="w-32 h-2 rounded-full overflow-hidden transition-colors duration-300" style={{ backgroundColor: 'rgba(255, 255, 255, 0.1)' }}>
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: "30%" }}></div>
                  </div>
                  <span className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>18%</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>Chennai</span>
                <div className="flex items-center gap-2">
                  <div className="w-32 h-2 rounded-full overflow-hidden transition-colors duration-300" style={{ backgroundColor: 'rgba(255, 255, 255, 0.1)' }}>
                    <div className="h-full bg-green-500 rounded-full" style={{ width: "20%" }}></div>
                  </div>
                  <span className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>12%</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>Bangalore</span>
                <div className="flex items-center gap-2">
                  <div className="w-32 h-2 rounded-full overflow-hidden transition-colors duration-300" style={{ backgroundColor: 'rgba(255, 255, 255, 0.1)' }}>
                    <div className="h-full bg-yellow-500 rounded-full" style={{ width: "15%" }}></div>
                  </div>
                  <span className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>9%</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AnalyticsPage;
